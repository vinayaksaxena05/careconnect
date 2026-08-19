import random
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
    is_optional_column_schema_error,
    logger,
    single_row,
    utc_now_iso,
    visible_until_iso,
)

router = APIRouter(tags=["requests"])

SELECT_REQ = """
      *,
      healthcare_providers (name, specialization),
      service_types (service_name, base_price, duration_minutes)
    """


class CreateRequestBody(BaseModel):
    provider_id: str | None = None
    service_id: str | None = None
    location: str | None = None
    request_time: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None


class StatusBody(BaseModel):
    status: str | None = None


@router.post("/api/requests")
def create_request(
    body: CreateRequestBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    if not body.service_id or not body.location:
        raise HTTPException(
            status_code=400, detail="service_id and location are required"
        )
    row: dict[str, Any] = {
        "user_id": auth.user.id,
        "provider_id": body.provider_id or None,
        "service_id": body.service_id,
        "location": body.location,
        "status": "requested",
        "request_time": body.request_time or utc_now_iso(),
        "location_lat": body.location_lat,
        "location_lng": body.location_lng,
        "eta_minutes": (
            12 + random.randint(0, 17) if body.provider_id else None
        ),
        "visible_until": visible_until_iso(TWO_HOURS_MS),
        "route_points": [],
    }
    try:
        resp = (
            supabase.table("service_requests")
            .insert([row])
            .select(SELECT_REQ)
            .execute()
        )
        return JSONResponse(status_code=201, content=single_row(resp))
    except APIError as e:
        if is_optional_column_schema_error(e):
            minimal = {
                k: v
                for k, v in row.items()
                if k not in ("visible_until", "route_points")
            }
            try:
                resp = (
                    supabase.table("service_requests")
                    .insert([minimal])
                    .select(SELECT_REQ)
                    .execute()
                )
                return JSONResponse(status_code=201, content=single_row(resp))
            except APIError as e2:
                logger.error("insert request failed (minimal payload): %s", e2)
                raise HTTPException(status_code=500, detail=err_message(e2)) from e2
        logger.error("insert request failed: %s", e)
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.get("/api/me/requests")
def my_requests(auth: Annotated[AuthContext, Depends(require_auth)]):
    try:
        resp = (
            supabase.table("service_requests")
            .select(
                """
      *,
      healthcare_providers (name, specialization),
      service_types (service_name, base_price, duration_minutes),
      payments (payment_id, amount, method, status),
      prescriptions (prescription_id, medicines, dosage),
      rating_feedback (feedback_id, rating, comments)
    """
            )
            .eq("user_id", auth.user.id)
            .order("request_time", desc=True)
            .execute()
        )
        return resp.data
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.get("/api/requests/{request_id}/track")
def track_request(
    request_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    try:
        resp = (
            supabase.table("service_requests")
            .select("*, payments (payment_id)")
            .eq("request_id", request_id)
            .eq("user_id", auth.user.id)
            .maybe_single()
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    req_row = resp.data
    if not req_row:
        raise HTTPException(status_code=404, detail="Request not found")

    pay = req_row.get("payments")
    has_payment = (
        len(pay) > 0
        if isinstance(pay, list)
        else pay is not None and isinstance(pay, dict)
    )
    if has_payment:
        return JSONResponse(
            status_code=410,
            content={
                "error": "Live tracking is no longer available after payment.",
                "tracking_closed": True,
            },
        )

    prev_updated_at = req_row.get("updated_at")
    dispatch_lat = req_row.get("dispatch_lat")
    dispatch_lng = req_row.get("dispatch_lng")
    eta_minutes = req_row.get("eta_minutes")
    location_lat = req_row.get("location_lat")
    location_lng = req_row.get("location_lng")
    route_points = req_row.get("route_points")
    status = req_row.get("status")

    dest_lat = location_lat if location_lat is not None else 13.0827
    dest_lng = location_lng if location_lng is not None else 80.2707

    if dispatch_lat is None or dispatch_lng is None:
        dispatch_lat = dest_lat + 0.04
        dispatch_lng = dest_lng + 0.04
    else:
        dispatch_lat += (dest_lat - dispatch_lat) * 0.22
        dispatch_lng += (dest_lng - dispatch_lng) * 0.22

    eta_minutes = max(2, (eta_minutes if eta_minutes is not None else 18) - (2 + random.randint(0, 2)))

    pts = list(route_points) if isinstance(route_points, list) else []
    pts.append({"lat": dispatch_lat, "lng": dispatch_lng, "t": utc_now_iso()})
    if len(pts) > 400:
        pts = pts[-400:]

    update_payload = {
        "dispatch_lat": dispatch_lat,
        "dispatch_lng": dispatch_lng,
        "eta_minutes": eta_minutes,
        "updated_at": utc_now_iso(),
        "route_points": pts,
    }

    # Optimistic concurrency: only apply if nobody else updated this row
    # since we read it (two concurrent polls would otherwise stomp on each
    # other's dispatch position / route history).
    def _apply(payload: dict) -> list:
        resp = (
            supabase.table("service_requests")
            .update(payload)
            .eq("request_id", request_id)
            .eq("updated_at", prev_updated_at)
            .select()
            .execute()
        )
        return resp.data or []

    try:
        updated_rows = _apply(update_payload)
    except APIError as e:
        if not is_optional_column_schema_error(e):
            raise HTTPException(status_code=500, detail=err_message(e)) from e
        updated_rows = _apply(
            {k: v for k, v in update_payload.items() if k != "route_points"}
        )

    if not updated_rows:
        # Lost the race to a concurrent poll on this same request; return
        # whatever the winner just wrote instead of our now-stale guess.
        latest = (
            supabase.table("service_requests")
            .select("dispatch_lat, dispatch_lng, eta_minutes, route_points, status")
            .eq("request_id", request_id)
            .maybe_single()
            .execute()
        ).data or {}
        dispatch_lat = latest.get("dispatch_lat", dispatch_lat)
        dispatch_lng = latest.get("dispatch_lng", dispatch_lng)
        eta_minutes = latest.get("eta_minutes", eta_minutes)
        status = latest.get("status", status)
        pts = latest.get("route_points") or pts

    return {
        "request_id": request_id,
        "status": status,
        "eta_minutes": eta_minutes,
        "destination": {"lat": dest_lat, "lng": dest_lng},
        "ambulance": {"lat": dispatch_lat, "lng": dispatch_lng},
        "route": [[p["lat"], p["lng"]] for p in pts],
        "tracking_closed": False,
        "updated_at": utc_now_iso(),
    }


@router.patch("/api/requests/{request_id}/status")
def update_status(
    request_id: str,
    body: StatusBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    if not body.status:
        raise HTTPException(status_code=400, detail="status required")
    next_status = str(body.status).lower()
    try:
        existing_resp = (
            supabase.table("service_requests")
            .select("request_id, status, payments(payment_id)")
            .eq("request_id", request_id)
            .eq("user_id", auth.user.id)
            .maybe_single()
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    existing = existing_resp.data
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")

    current = str(existing.get("status") or "").lower()
    p = existing.get("payments")
    paid = (
        len(p) > 0
        if isinstance(p, list)
        else p is not None and isinstance(p, dict) and len(p) > 0
    )

    if next_status == "cancelled":
        if current not in ("requested", "in_progress", "confirmed"):
            raise HTTPException(
                status_code=400,
                detail="This visit cannot be cancelled in its current state.",
            )
        if paid:
            raise HTTPException(
                status_code=400,
                detail="Cannot cancel after payment. Contact support if needed.",
            )

    try:
        resp = (
            supabase.table("service_requests")
            .update({"status": next_status, "updated_at": utc_now_iso()})
            .eq("request_id", request_id)
            .select()
            .execute()
        )
        return single_row(resp)
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
