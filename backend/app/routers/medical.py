from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.db import supabase
from app.deps import AuthContext, require_auth
from app.helpers import err_message, single_row

router = APIRouter(tags=["medical-records"])


class MedicalRecordBody(BaseModel):
    diagnosis: str | None = None
    notes: str | None = None
    record_date: str | None = None


@router.get("/api/me/medical-records")
def list_records(auth: Annotated[AuthContext, Depends(require_auth)]):
    try:
        resp = (
            supabase.table("medical_records")
            .select("*")
            .eq("user_id", auth.user.id)
            .order("record_date", desc=True)
            .execute()
        )
        return resp.data
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e


@router.post("/api/me/medical-records")
def create_record(
    body: MedicalRecordBody,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    if not body.diagnosis:
        raise HTTPException(status_code=400, detail="diagnosis required")
    try:
        resp = (
            supabase.table("medical_records")
            .insert(
                [
                    {
                        "user_id": auth.user.id,
                        "diagnosis": body.diagnosis,
                        "notes": body.notes,
                        "record_date": body.record_date or date.today().isoformat(),
                    }
                ]
            )
            .select()
            .execute()
        )
        return JSONResponse(status_code=201, content=single_row(resp))
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
