from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict

from app.constants import ADMIN_TABLES
from app.db import supabase
from app.deps import AuthContext, require_admin
from app.helpers import err_message, logger
from app.routers.emergency import sweep_expired_emergencies

router = APIRouter(tags=["admin"])


def _log_admin_change(
    admin_user_id: str,
    action: str,
    table_name: str,
    row_pk: str,
    before: dict | None,
    after: dict | None,
) -> None:
    """Best-effort audit trail for admin mutations. Never blocks the request
    on a logging failure — write failures are surfaced via `logger` instead."""
    try:
        supabase.table("admin_audit_log").insert(
            [
                {
                    "admin_user_id": admin_user_id,
                    "action": action,
                    "table_name": table_name,
                    "row_pk": str(row_pk),
                    "before": before,
                    "after": after,
                }
            ]
        ).execute()
    except APIError as e:
        logger.error("admin_audit_log insert failed: %s", err_message(e))


class CreateUserBody(BaseModel):
    email: str | None = None
    password: str | None = None
    full_name: str | None = None
    role: str | None = None


class RoleBody(BaseModel):
    role: str | None = None


class ProviderBody(BaseModel):
    name: str | None = None
    specialization: str | None = None
    license_number: str | None = None
    verified: bool | None = None


class ServiceTypeBody(BaseModel):
    service_name: str | None = None
    base_price: float | None = None
    duration_minutes: float | None = None


class TableRowPatch(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.get("/api/admin/me")
def admin_me(auth: Annotated[AuthContext, Depends(require_admin)]):
    return {
        "user_id": auth.user.id,
        "email": auth.user.email,
        "name": (auth.admin_profile or {}).get("name"),
        "role": (auth.admin_profile or {}).get("role"),
    }


@router.get("/api/admin/stats")
def admin_stats(_auth: Annotated[AuthContext, Depends(require_admin)]):
    try:
        users = (
            supabase.table("profiles").select("*", count="exact", head=True).execute()
        )
        admins = (
            supabase.table("profiles")
            .select("*", count="exact", head=True)
            .eq("role", "admin")
            .execute()
        )
        providers = (
            supabase.table("healthcare_providers")
            .select("*", count="exact", head=True)
            .execute()
        )
        services = (
            supabase.table("service_types")
            .select("*", count="exact", head=True)
            .execute()
        )
        requests = (
            supabase.table("service_requests")
            .select("*", count="exact", head=True)
            .execute()
        )
        return {
            "profiles": users.count or 0,
            "admins": admins.count or 0,
            "healthcare_providers": providers.count or 0,
            "service_types": services.count or 0,
            "service_requests": requests.count or 0,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/api/admin/users")
def admin_users(_auth: Annotated[AuthContext, Depends(require_admin)]):
    try:
        listed = supabase.auth.admin.list_users(page=1, per_page=1000)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    try:
        profiles_resp = supabase.table("profiles").select("*").execute()
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    pmap = {p["user_id"]: p for p in (profiles_resp.data or [])}
    users = listed if isinstance(listed, list) else getattr(listed, "users", None) or []
    merged = []
    for u in users:
        uid = u.id if hasattr(u, "id") else u.get("id")
        pr = pmap.get(uid) or {}
        merged.append(
            {
                "id": uid,
                "email": u.email if hasattr(u, "email") else u.get("email"),
                "created_at": (
                    u.created_at if hasattr(u, "created_at") else u.get("created_at")
                ),
                "last_sign_in_at": (
                    u.last_sign_in_at
                    if hasattr(u, "last_sign_in_at")
                    else u.get("last_sign_in_at")
                ),
                "name": pr.get("name"),
                "phone": pr.get("phone"),
                "address": pr.get("address"),
                "role": pr.get("role") or "user",
            }
        )
    return merged


@router.post("/api/admin/users")
def admin_create_user(
    body: CreateUserBody,
    _auth: Annotated[AuthContext, Depends(require_admin)],
):
    if not body.email or not body.password:
        raise HTTPException(status_code=400, detail="email and password required")
    r = "user"
    if body.role == "admin":
        r = "admin"
    elif body.role == "provider":
        r = "provider"
    display_name = body.full_name or body.email.split("@")[0]
    try:
        data = supabase.auth.admin.create_user(
            {
                "email": str(body.email).strip(),
                "password": str(body.password),
                "email_confirm": True,
                "user_metadata": {
                    "full_name": display_name,
                    "name": display_name,
                },
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    uid = data.user.id
    try:
        supabase.table("profiles").upsert(
            {"user_id": uid, "name": display_name, "role": r},
            on_conflict="user_id",
        ).execute()
    except APIError as e:
        try:
            supabase.auth.admin.delete_user(uid)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    return JSONResponse(
        status_code=201,
        content={
            "id": uid,
            "email": data.user.email,
            "role": r,
            "name": display_name,
        },
    )


@router.patch("/api/admin/users/{user_id}/role")
def admin_set_role(
    user_id: str,
    body: RoleBody,
    auth: Annotated[AuthContext, Depends(require_admin)],
):
    if body.role not in ("admin", "user", "provider"):
        raise HTTPException(
            status_code=400, detail="role must be admin, user, or provider"
        )
    next_role = body.role
    try:
        target = (
            supabase.table("profiles")
            .select("role")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
    if not target.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    if target.data.get("role") == "admin" and next_role != "admin":
        try:
            count_resp = (
                supabase.table("profiles")
                .select("*", count="exact", head=True)
                .eq("role", "admin")
                .execute()
            )
        except APIError as e:
            raise HTTPException(status_code=500, detail=err_message(e)) from e
        if (count_resp.count or 0) <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot remove the last administrator account.",
            )

    try:
        resp = (
            supabase.table("profiles")
            .update({"role": next_role})
            .eq("user_id", user_id)
            .select()
            .single()
            .execute()
        )
        _log_admin_change(
            auth.user.id,
            "role_change",
            "profiles",
            user_id,
            before={"role": target.data.get("role")},
            after={"role": next_role},
        )
        return resp.data
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.get("/api/admin/providers")
def admin_list_providers(_auth: Annotated[AuthContext, Depends(require_admin)]):
    try:
        resp = (
            supabase.table("healthcare_providers").select("*").order("name").execute()
        )
        return resp.data
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.post("/api/admin/providers")
def admin_create_provider(
    body: ProviderBody,
    _auth: Annotated[AuthContext, Depends(require_admin)],
):
    if not body.name or not body.specialization or not body.license_number:
        raise HTTPException(
            status_code=400,
            detail="name, specialization, and license_number required",
        )
    try:
        resp = (
            supabase.table("healthcare_providers")
            .insert(
                [
                    {
                        "name": body.name,
                        "specialization": body.specialization,
                        "license_number": body.license_number,
                        "verified": bool(body.verified),
                    }
                ]
            )
            .select()
            .single()
            .execute()
        )
        return JSONResponse(status_code=201, content=resp.data)
    except APIError as e:
        raise HTTPException(status_code=400, detail=err_message(e)) from e


@router.patch("/api/admin/providers/{provider_id}")
def admin_update_provider(
    provider_id: str,
    body: ProviderBody,
    _auth: Annotated[AuthContext, Depends(require_admin)],
):
    patch: dict[str, Any] = {}
    if body.name is not None:
        patch["name"] = body.name
    if body.specialization is not None:
        patch["specialization"] = body.specialization
    if body.license_number is not None:
        patch["license_number"] = body.license_number
    if body.verified is not None:
        patch["verified"] = bool(body.verified)
    try:
        resp = (
            supabase.table("healthcare_providers")
            .update(patch)
            .eq("provider_id", provider_id)
            .select()
            .single()
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Not found")
        return resp.data
    except HTTPException:
        raise
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.get("/api/admin/service-types")
def admin_list_services(_auth: Annotated[AuthContext, Depends(require_admin)]):
    try:
        resp = (
            supabase.table("service_types").select("*").order("service_name").execute()
        )
        return resp.data
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.post("/api/admin/service-types")
def admin_create_service(
    body: ServiceTypeBody,
    _auth: Annotated[AuthContext, Depends(require_admin)],
):
    if body.service_name is None or body.base_price is None:
        raise HTTPException(
            status_code=400, detail="service_name and base_price required"
        )
    try:
        resp = (
            supabase.table("service_types")
            .insert(
                [
                    {
                        "service_name": body.service_name,
                        "base_price": float(body.base_price),
                        "duration_minutes": (
                            int(body.duration_minutes)
                            if body.duration_minutes is not None
                            else 30
                        ),
                    }
                ]
            )
            .select()
            .single()
            .execute()
        )
        return JSONResponse(status_code=201, content=resp.data)
    except APIError as e:
        raise HTTPException(status_code=400, detail=err_message(e)) from e


@router.patch("/api/admin/service-types/{service_id}")
def admin_update_service(
    service_id: str,
    body: ServiceTypeBody,
    _auth: Annotated[AuthContext, Depends(require_admin)],
):
    patch: dict[str, Any] = {}
    if body.service_name is not None:
        patch["service_name"] = body.service_name
    if body.base_price is not None:
        patch["base_price"] = float(body.base_price)
    if body.duration_minutes is not None:
        patch["duration_minutes"] = int(body.duration_minutes)
    try:
        resp = (
            supabase.table("service_types")
            .update(patch)
            .eq("service_id", service_id)
            .select()
            .single()
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Not found")
        return resp.data
    except HTTPException:
        raise
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.get("/api/admin/tables")
def admin_tables(_auth: Annotated[AuthContext, Depends(require_admin)]):
    return {"tables": list(ADMIN_TABLES.keys())}


@router.get("/api/admin/tables/{table}/rows")
def admin_table_rows(
    table: str,
    _auth: Annotated[AuthContext, Depends(require_admin)],
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    meta = ADMIN_TABLES.get(table)
    if not meta:
        raise HTTPException(status_code=404, detail="Unknown table")
    if table == "emergency_requests":
        # Reflect expired open/dispatched rows as resolved before listing,
        # so this raw view doesn't show stale rows forever (see analytics.py
        # / emergency.py, which already derive "open" from visible_until).
        sweep_expired_emergencies()
    try:
        resp = (
            supabase.table(table)
            .select("*", count="exact")
            .range(offset, offset + limit - 1)
            .execute()
        )
        total = resp.count or 0
        return {
            "rows": resp.data or [],
            "total": total,
            "offset": offset,
            "limit": limit,
            "has_more": offset + limit < total,
        }
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.patch("/api/admin/tables/{table}/rows")
def admin_table_patch(
    table: str,
    body: TableRowPatch,
    auth: Annotated[AuthContext, Depends(require_admin)],
):
    meta = ADMIN_TABLES.get(table)
    if not meta:
        raise HTTPException(status_code=404, detail="Unknown table")
    raw = body.model_dump()
    pk = meta["pk"]
    pk_val = raw.get(pk)
    if pk_val is None or pk_val == "":
        raise HTTPException(
            status_code=400, detail=f'Body must include primary key "{pk}"'
        )
    allowed = {k: raw[k] for k in meta["editable"] if k in raw}
    if not allowed:
        raise HTTPException(status_code=400, detail="No editable fields to update")
    if table == "profiles" and "role" in allowed:
        r = allowed["role"]
        if r not in ("admin", "user", "provider"):
            raise HTTPException(status_code=400, detail="Invalid role")
    try:
        before_resp = (
            supabase.table(table).select("*").eq(pk, pk_val).maybe_single().execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
    before_row = before_resp.data
    try:
        resp = (
            supabase.table(table)
            .update(allowed)
            .eq(pk, pk_val)
            .select()
            .single()
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Row not found")
        _log_admin_change(
            auth.user.id,
            "table_patch",
            table,
            pk_val,
            before={k: (before_row or {}).get(k) for k in allowed},
            after={k: allowed[k] for k in allowed},
        )
        return resp.data
    except HTTPException:
        raise
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
