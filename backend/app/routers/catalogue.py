from fastapi import APIRouter, HTTPException, Query
from postgrest.exceptions import APIError

from app.db import supabase
from app.helpers import err_message, round1

router = APIRouter(tags=["catalogue"])


@router.get("/api/health")
def health():
    return {"ok": True, "service": "CareConnect API"}


def fetch_providers_with_ratings():
    try:
        providers_resp = (
            supabase.table("healthcare_providers").select("*").order("name").execute()
        )
        providers = providers_resp.data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    try:
        feedback_resp = (
            supabase.table("rating_feedback")
            .select("rating, service_requests!inner(provider_id)")
            .execute()
        )
        feedback_rows = feedback_resp.data or []
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    by_provider: dict = {}
    for row in feedback_rows:
        sr = row.get("service_requests") or {}
        pid = sr.get("provider_id") if isinstance(sr, dict) else None
        if not pid:
            continue
        if pid not in by_provider:
            by_provider[pid] = {"sum": 0, "n": 0}
        by_provider[pid]["sum"] += row["rating"]
        by_provider[pid]["n"] += 1

    result = []
    for p in providers:
        agg = by_provider.get(p["provider_id"])
        result.append(
            {
                **p,
                "avg_rating": round1(agg["sum"] / agg["n"]) if agg else None,
                "review_count": agg["n"] if agg else 0,
            }
        )
    return result


@router.get("/api/providers")
def list_providers():
    try:
        return fetch_providers_with_ratings()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/api/services")
def list_services():
    try:
        resp = (
            supabase.table("service_types").select("*").order("service_name").execute()
        )
        return resp.data
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.get("/api/availability")
def list_availability(
    provider_id: str | None = Query(None),
    date: str | None = Query(None),
):
    if not provider_id:
        raise HTTPException(status_code=400, detail="provider_id required")
    try:
        q = (
            supabase.table("provider_availability")
            .select("*")
            .eq("provider_id", provider_id)
            .eq("is_available", True)
            .order("date")
            .order("time_slot")
        )
        if date:
            q = q.eq("date", date)
        resp = q.execute()
        return resp.data
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
