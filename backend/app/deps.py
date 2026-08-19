from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException
from supabase_auth.types import User

from app.db import supabase


@dataclass
class AuthContext:
    user: User
    admin_profile: dict[str, Any] | None = None


async def get_bearer_user(
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization bearer token")
    token = authorization[7:]
    try:
        result = supabase.auth.get_user(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e) or "Invalid session") from e
    user = result.user if result else None
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")
    return user


async def require_auth(user: Annotated[User, Depends(get_bearer_user)]) -> AuthContext:
    return AuthContext(user=user)


async def require_admin(user: Annotated[User, Depends(get_bearer_user)]) -> AuthContext:
    try:
        resp = (
            supabase.table("profiles")
            .select("role, user_id, name")
            .eq("user_id", user.id)
            .maybe_single()
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(getattr(e, "message", None) or e)) from e

    profile = resp.data if resp else None
    if not profile or profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return AuthContext(user=user, admin_profile=profile)
