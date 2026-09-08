"""Emergency triage ESI prediction - clinical decision support.

Contract (see ml/README.md section 15):

    GET   /api/emergency/triage/health          - subsystem status
    POST  /api/emergency/triage/predict         - stateless prediction
    POST  /api/emergency/triage                 - persist a prediction (+ optional
                                                  human final ESI in one call)
    GET   /api/emergency/triage                 - caller's saved predictions
    GET   /api/emergency/triage/{id}            - one saved prediction
    PATCH /api/emergency/triage/{id}            - record the human override

The model prediction and the human decision are stored side by side and the
model columns are never overwritten.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from app.db import supabase
from app.deps import AuthContext, require_auth
from app.helpers import err_message, single_row, utc_now_iso
from app.ml import TriageUnavailableError, triage_service

# TriageInput is the validated feature contract - reused, not redefined.
from ml.inference.schemas import TriageInput

logger = logging.getLogger("careconnect.triage")

router = APIRouter(prefix="/api/emergency/triage", tags=["triage"])

TABLE = "triage_predictions"


class PersistTriageBody(BaseModel):
    features: TriageInput
    emergency_id: str | None = None
    human_final_esi: int | None = Field(None, ge=1, le=5)
    override_reason: str | None = None


class OverrideBody(BaseModel):
    human_final_esi: int = Field(..., ge=1, le=5)
    override_reason: str | None = None


def _missing_table(exc: APIError) -> bool:
    msg = err_message(exc).lower()
    return "does not exist" in msg or "could not find the table" in msg or "42p01" in msg


def _db_error(exc: APIError) -> HTTPException:
    if _missing_table(exc):
        return HTTPException(
            status_code=503,
            detail=(
                "Triage prediction storage is not available "
                "(run the triage_predictions migration). "
                "Prediction still works; it was not saved."
            ),
        )
    return HTTPException(status_code=500, detail=err_message(exc))


def _row_from_result(
    result: dict[str, Any],
    features: dict[str, Any],
    auth: AuthContext,
    *,
    emergency_id: str | None,
) -> dict[str, Any]:
    return {
        "user_id": auth.user.id,
        "emergency_id": emergency_id,
        "model_name": result["model"]["name"],
        "model_version": result["model"]["version"],
        "model_type": result["model"]["type"],
        "predicted_esi": result["prediction"]["esi"],
        "prediction_probabilities": result["probabilities"],
        "confidence": result["confidence"],
        "explanation": result["explanation"],
        "input_features": features,
        "requires_human_review": True,
    }


@router.get("/health")
def triage_health() -> dict[str, Any]:
    """Subsystem status. Safe to call without ML configured."""
    return triage_service.health()


@router.post("/predict")
def predict_triage(
    body: TriageInput,
    _auth: Annotated[AuthContext, Depends(require_auth)],
):
    """Stateless ESI prediction. Nothing is written to the database."""
    try:
        return triage_service.predict(body.to_feature_dict())
    except TriageUnavailableError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("")
def create_triage_prediction(
    body: PersistTriageBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    """Run a prediction and persist it. Optionally record the clinician's final
    ESI in the same call (Accept -> equal value; Override -> different value)."""
    features = body.features.to_feature_dict()
    try:
        result = triage_service.predict(features)
    except TriageUnavailableError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    row = _row_from_result(result, features, auth, emergency_id=body.emergency_id)
    if body.human_final_esi is not None:
        row["human_final_esi"] = body.human_final_esi
        row["was_overridden"] = body.human_final_esi != result["prediction"]["esi"]
        row["override_reason"] = body.override_reason
        row["reviewed_by"] = auth.user.id

    try:
        resp = supabase.table(TABLE).insert([row]).select().execute()
    except APIError as exc:
        raise _db_error(exc) from exc

    saved = single_row(resp)
    return JSONResponse(status_code=201, content={"prediction": result, "record": saved})


@router.get("")
def list_triage_predictions(auth: Annotated[AuthContext, Depends(require_auth)]):
    try:
        resp = (
            supabase.table(TABLE)
            .select("*")
            .eq("user_id", auth.user.id)
            .order("created_at", desc=True)
            .execute()
        )
        return resp.data or []
    except APIError as exc:
        raise _db_error(exc) from exc


@router.get("/{prediction_id}")
def get_triage_prediction(
    prediction_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    try:
        resp = (
            supabase.table(TABLE)
            .select("*")
            .eq("id", prediction_id)
            .eq("user_id", auth.user.id)
            .maybe_single()
            .execute()
        )
    except APIError as exc:
        raise _db_error(exc) from exc
    row = resp.data if resp else None
    if not row:
        raise HTTPException(status_code=404, detail="Triage prediction not found")
    return row


@router.patch("/{prediction_id}")
def override_triage_prediction(
    prediction_id: str,
    body: OverrideBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    """Record the human triage decision. The model columns are left untouched so
    both values are always retained."""
    try:
        existing_resp = (
            supabase.table(TABLE)
            .select("id, predicted_esi")
            .eq("id", prediction_id)
            .eq("user_id", auth.user.id)
            .maybe_single()
            .execute()
        )
    except APIError as exc:
        raise _db_error(exc) from exc

    existing = existing_resp.data if existing_resp else None
    if not existing:
        raise HTTPException(status_code=404, detail="Triage prediction not found")

    patch = {
        "human_final_esi": body.human_final_esi,
        "was_overridden": body.human_final_esi != existing["predicted_esi"],
        "override_reason": body.override_reason,
        "reviewed_by": auth.user.id,
        "updated_at": utc_now_iso(),
    }
    try:
        resp = (
            supabase.table(TABLE)
            .update(patch)
            .eq("id", prediction_id)
            .eq("user_id", auth.user.id)
            .select()
            .execute()
        )
    except APIError as exc:
        raise _db_error(exc) from exc

    return single_row(resp)
