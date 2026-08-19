from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.db import supabase
from app.deps import AuthContext, require_auth
from app.helpers import err_message, single_row

router = APIRouter(tags=["profile"])


class ProfileUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    address: str | None = None


@router.get("/api/me/profile")
def get_profile(auth: Annotated[AuthContext, Depends(require_auth)]):
    try:
        resp = (
            supabase.table("profiles")
            .select("*")
            .eq("user_id", auth.user.id)
            .maybe_single()
            .execute()
        )
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
    if not resp.data:
        raise HTTPException(
            status_code=404, detail="Profile not found; complete signup."
        )
    return resp.data


@router.put("/api/me/profile")
def update_profile(
    body: ProfileUpdate,
    auth: Annotated[AuthContext, Depends(require_auth)],
):
    patch: dict[str, Any] = {}
    if body.name is not None:
        patch["name"] = body.name
    if body.phone is not None:
        patch["phone"] = body.phone
    if body.address is not None:
        patch["address"] = body.address
    try:
        resp = (
            supabase.table("profiles")
            .update(patch)
            .eq("user_id", auth.user.id)
            .select()
            .execute()
        )
        return single_row(resp)
    except APIError as e:
        raise HTTPException(status_code=500, detail=err_message(e)) from e
