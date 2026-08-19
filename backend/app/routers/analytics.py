import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from app.config import TWO_HOURS_MS
from app.db import supabase
from app.deps import AuthContext, require_auth
from app.helpers import (
    err_message,
    is_open_emergency_status,
    is_optional_column_schema_error,
    is_pending_request_status,
    is_row_visible,
)

router = APIRouter(tags=["analytics"])


@router.get("/api/analytics/summary")
def analytics_summary(auth: Annotated[AuthContext, Depends(require_auth)]):
    user_id = auth.user.id
    try:
        now = int(time.time() * 1000)

        try:
            em_resp = (
                supabase.table("emergency_requests")
                .select("status, visible_until, created_at")
                .eq("user_id", user_id)
                .execute()
            )
            my_emergencies = em_resp.data or []
        except APIError as em_err:
            if is_optional_column_schema_error(em_err):
                em_resp = (
                    supabase.table("emergency_requests")
                    .select("status, created_at")
                    .eq("user_id", user_id)
                    .execute()
                )
                my_emergencies = em_resp.data or []
            else:
                raise HTTPException(
                    status_code=500, detail=err_message(em_err)
                ) from em_err

        my_open = sum(
            1
            for e in my_emergencies
            if is_open_emergency_status(e.get("status"))
            and is_row_visible(e, now, TWO_HOURS_MS)
        )

        req_resp = (
            supabase.table("service_requests")
            .select("status, eta_minutes, request_time")
            .eq("user_id", user_id)
            .execute()
        )
        my_requests = req_resp.data or []

        total_requests = len(my_requests)
        completed = sum(
            1
            for r in my_requests
            if str(r.get("status") or "").lower() == "completed"
        )
        pending = sum(
            1 for r in my_requests if is_pending_request_status(r.get("status"))
        )
        etas = [
            r["eta_minutes"]
            for r in my_requests
            if is_pending_request_status(r.get("status"))
            and r.get("eta_minutes") is not None
        ]
        avg_eta = round(sum(etas) / len(etas)) if etas else None

        platform_resp = (
            supabase.table("service_requests")
            .select("*", count="exact", head=True)
            .execute()
        )
        verified_resp = (
            supabase.table("healthcare_providers")
            .select("*", count="exact", head=True)
            .eq("verified", True)
            .execute()
        )

        return {
            "user": {
                "open_emergencies": my_open,
                "total_requests": total_requests,
                "completed_requests": completed,
                "pending_requests": pending,
                "avg_eta_minutes": avg_eta,
            },
            "platform": {
                "total_service_requests": platform_resp.count or 0,
                "verified_providers": verified_resp.count or 0,
            },
            "sla_note": (
                "ETA averages are calculated from pending requests and "
                "active emergencies only."
            ),
        }
    except HTTPException:
        raise
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
