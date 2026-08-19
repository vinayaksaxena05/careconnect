from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.db import supabase
from app.deps import AuthContext, require_auth
from app.helpers import err_message

router = APIRouter(tags=["provider"])


class ProviderRegisterBody(BaseModel):
    email: str | None = None
    password: str | None = None
    full_name: str | None = None
    phone: str | None = None
    address: str | None = None
    specialization: str | None = None
    license_number: str | None = None


@router.post("/api/provider/register")
def register_provider(body: ProviderRegisterBody):
    if (
        not body.email
        or not body.password
        or not body.full_name
        or not body.specialization
        or not body.license_number
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "email, password, full_name, specialization, and "
                "license_number are required"
            ),
        )
    email_trim = str(body.email).strip()
    full_name = str(body.full_name).strip()
    try:
        created = supabase.auth.admin.create_user(
            {
                "email": email_trim,
                "password": str(body.password),
                "email_confirm": True,
                "user_metadata": {"full_name": full_name, "name": full_name},
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    uid = created.user.id

    def _rollback() -> None:
        try:
            supabase.auth.admin.delete_user(uid)
        except Exception:
            pass

    try:
        supabase.table("profiles").update(
            {
                "name": full_name,
                "phone": str(body.phone).strip() if body.phone else None,
                "address": str(body.address).strip() if body.address else None,
                "role": "provider",
            }
        ).eq("user_id", uid).execute()
    except APIError as e:
        _rollback()
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    try:
        hp = (
            supabase.table("healthcare_providers")
            .insert(
                [
                    {
                        "name": full_name,
                        "specialization": str(body.specialization).strip(),
                        "license_number": str(body.license_number).strip(),
                        "verified": False,
                        "provider_user_id": uid,
                        "phone": str(body.phone).strip() if body.phone else None,
                        "address": str(body.address).strip() if body.address else None,
                        "email": email_trim,
                    }
                ]
            )
            .select()
            .single()
            .execute()
        )
        return JSONResponse(
            status_code=201,
            content={"provider_id": hp.data["provider_id"], "user_id": uid},
        )
    except APIError as e:
        _rollback()
        raise HTTPException(status_code=400, detail=err_message(e)) from e


@router.get("/api/me/provider")
def my_provider(auth: Annotated[AuthContext, Depends(require_auth)]):
    try:
        resp = (
            supabase.table("healthcare_providers")
            .select("*")
            .eq("provider_user_id", auth.user.id)
            .maybe_single()
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
    if not resp.data:
        raise HTTPException(
            status_code=404, detail="No provider profile for this account"
        )
    return resp.data


@router.get("/api/me/provider/requests")
def my_provider_requests(auth: Annotated[AuthContext, Depends(require_auth)]):
    try:
        hp = (
            supabase.table("healthcare_providers")
            .select("provider_id")
            .eq("provider_user_id", auth.user.id)
            .maybe_single()
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
    if not hp.data:
        raise HTTPException(
            status_code=404, detail="No provider profile for this account"
        )

    try:
        resp = (
            supabase.table("service_requests")
            .select("*, service_types (service_name, base_price)")
            .eq("provider_id", hp.data["provider_id"])
            .order("request_time", desc=True)
            .execute()
        )
        return resp.data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
