import random
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.config import TWO_HOURS_MS
from app.db import supabase
from app.deps import AuthContext, require_auth
from app.helpers import (
    err_message,
    is_open_emergency_status,
    is_optional_column_schema_error,
    is_row_visible,
    single_row,
    visible_until_iso,
)

router = APIRouter(tags=["emergency"])


class EmergencyBody(BaseModel):
    severity: str | None = None
    location: str | None = None
    notes: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None


def sweep_expired_emergencies(user_id: str | None = None) -> int:
    """Flip stale 'open'/'dispatched' rows to 'resolved' once their
    visibility window has passed, so `status` reflects reality for anyone
    reading the table directly (e.g. the admin data view) instead of only
    for callers that separately re-derive visibility from `visible_until`.
    Scoped to `user_id` when given; sweeps globally otherwise.
    """
    now = int(time.time() * 1000)
    query = (
        supabase.table("emergency_requests")
        .select("emergency_id, status, created_at, visible_until")
        .in_("status", ["open", "dispatched"])
    )
    if user_id:
        query = query.eq("user_id", user_id)
    try:
        active_resp = query.execute()
        active_rows = active_resp.data or []
    except APIError as e:
        if not is_optional_column_schema_error(e):
            raise HTTPException(status_code=500, detail=err_message(e)) from e
        fallback = (
            supabase.table("emergency_requests")
            .select("emergency_id, status, created_at")
            .in_("status", ["open", "dispatched"])
        )
        if user_id:
            fallback = fallback.eq("user_id", user_id)
        active_resp = fallback.execute()
        active_rows = active_resp.data or []

    expired_ids = [
        row["emergency_id"]
        for row in active_rows
        if is_open_emergency_status(row.get("status"))
        and not is_row_visible(row, now, TWO_HOURS_MS)
    ]
    if expired_ids:
        try:
            supabase.table("emergency_requests").update({"status": "resolved"}).in_(
                "emergency_id", expired_ids
            ).execute()
        except APIError as e:
            raise HTTPException(status_code=500, detail=err_message(e)) from e
    return len(expired_ids)


@router.post("/api/emergency")
def create_emergency(
    body: EmergencyBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    sev = body.severity or "high"

    # Resolve the caller's own still-active emergencies (filing a new one
    # supersedes prior ones) as well as any that have simply expired.
    try:
        supabase.table("emergency_requests").update({"status": "resolved"}).eq(
            "user_id", auth.user.id
        ).in_("status", ["open", "dispatched"]).execute()
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    row: dict[str, Any] = {
        "user_id": auth.user.id,
        "severity": sev,
        "status": "dispatched",
        "location": body.location or "GPS pending",
        "notes": body.notes,
        "location_lat": body.location_lat,
        "location_lng": body.location_lng,
        "response_eta_minutes": 7 + random.randint(0, 11),
        "visible_until": visible_until_iso(TWO_HOURS_MS),
    }
    try:
        resp = (
            supabase.table("emergency_requests")
            .insert([row])
            .select()
            .execute()
        )
        return JSONResponse(status_code=201, content=single_row(resp))
    except APIError as e:
        if is_optional_column_schema_error(e):
            minimal = {k: v for k, v in row.items() if k != "visible_until"}
            try:
                resp = (
                    supabase.table("emergency_requests")
                    .insert([minimal])
                    .select()
                    .execute()
                )
                return JSONResponse(status_code=201, content=single_row(resp))
            except APIError as e2:
                raise HTTPException(status_code=500, detail=err_message(e2)) from e2
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.get("/api/me/emergencies")
def my_emergencies(auth: Annotated[AuthContext, Depends(require_auth)]):
    sweep_expired_emergencies(auth.user.id)
    try:
        resp = (
            supabase.table("emergency_requests")
            .select("*")
            .eq("user_id", auth.user.id)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
