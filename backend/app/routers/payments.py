from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.db import supabase
from app.deps import AuthContext, require_auth
from app.helpers import (
    api_error_code,
    err_message,
    is_optional_column_schema_error,
    single_row,
    utc_now_iso,
)

router = APIRouter(tags=["payments"])


class PaymentBody(BaseModel):
    request_id: str | None = None
    amount: float | None = None
    method: str | None = None


class PrescriptionBody(BaseModel):
    request_id: str | None = None
    medicines: str | None = None
    dosage: str | None = None


class FeedbackBody(BaseModel):
    request_id: str | None = None
    rating: float | None = None
    comments: str | None = None


def _own_request(request_id: str, user_id: str) -> bool:
    resp = (
        supabase.table("service_requests")
        .select("request_id")
        .eq("request_id", request_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return bool(resp.data)


def _expected_amount(request_id: str) -> float | None:
    """The service's catalogue price for a request, used to validate what
    the client claims to be paying instead of trusting it outright."""
    resp = (
        supabase.table("service_requests")
        .select("service_types (base_price)")
        .eq("request_id", request_id)
        .maybe_single()
        .execute()
    )
    service = (resp.data or {}).get("service_types") if resp.data else None
    if isinstance(service, list):
        service = service[0] if service else None
    if not service or service.get("base_price") is None:
        return None
    return float(service["base_price"])


@router.post("/api/payments")
def create_payment(
    body: PaymentBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    if not body.request_id or body.amount is None or not body.method:
        raise HTTPException(
            status_code=400, detail="request_id, amount, and method required"
        )
    if not _own_request(body.request_id, auth.user.id):
        raise HTTPException(status_code=404, detail="Service request not found")

    expected = _expected_amount(body.request_id)
    if expected is not None and round(float(body.amount), 2) != round(expected, 2):
        raise HTTPException(
            status_code=400,
            detail=f"Amount must match the service price ({expected:.2f})",
        )

    try:
        resp = (
            supabase.table("payments")
            .insert(
                [
                    {
                        "request_id": body.request_id,
                        "amount": body.amount,
                        "method": body.method,
                        "status": "completed",
                    }
                ]
            )
            .select()
            .execute()
        )
    except APIError as e:
        if api_error_code(e) == "23505":
            raise HTTPException(
                status_code=409, detail="Payment already exists for request"
            ) from e
        raise HTTPException(status_code=500, detail=err_message(e)) from e

    completed_patch: dict[str, Any] = {
        "status": "completed",
        "closed_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
    }
    try:
        supabase.table("service_requests").update(completed_patch).eq(
            "request_id", body.request_id
        ).execute()
    except APIError as up_err:
        if is_optional_column_schema_error(up_err):
            no_closed = {
                k: v for k, v in completed_patch.items() if k != "closed_at"
            }
            try:
                supabase.table("service_requests").update(no_closed).eq(
                    "request_id", body.request_id
                ).execute()
            except APIError as e2:
                raise HTTPException(status_code=500, detail=err_message(e2)) from e2
        else:
            raise HTTPException(status_code=500, detail=err_message(up_err)) from up_err

    return JSONResponse(status_code=201, content=single_row(resp))


@router.post("/api/prescriptions")
def create_prescription(
    body: PrescriptionBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    if not body.request_id or not body.medicines or not body.dosage:
        raise HTTPException(
            status_code=400, detail="request_id, medicines, dosage required"
        )
    if not _own_request(body.request_id, auth.user.id):
        raise HTTPException(status_code=404, detail="Service request not found")

    try:
        resp = (
            supabase.table("prescriptions")
            .insert(
                [
                    {
                        "request_id": body.request_id,
                        "medicines": body.medicines,
                        "dosage": body.dosage,
                    }
                ]
            )
            .select()
            .execute()
        )
        return JSONResponse(status_code=201, content=single_row(resp))
    except APIError as e:
        if api_error_code(e) == "23505":
            raise HTTPException(
                status_code=409, detail="Prescription already exists for request"
            ) from e
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.post("/api/feedback")
def create_feedback(
    body: FeedbackBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    if not body.request_id or body.rating is None:
        raise HTTPException(status_code=400, detail="request_id and rating required")
    if not (1 <= body.rating <= 5):
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5")
    if not _own_request(body.request_id, auth.user.id):
        raise HTTPException(status_code=404, detail="Service request not found")

    try:
        resp = (
            supabase.table("rating_feedback")
            .insert(
                [
                    {
                        "request_id": body.request_id,
                        "rating": int(body.rating),
                        "comments": body.comments,
                    }
                ]
            )
            .select()
            .execute()
        )
        return JSONResponse(status_code=201, content=single_row(resp))
    except APIError as e:
        if api_error_code(e) == "23505":
            raise HTTPException(
                status_code=409, detail="Feedback already submitted"
            ) from e
        raise HTTPException(status_code=500, detail=err_message(e)) from e
