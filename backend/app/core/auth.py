"""
Authentication for the FastAPI backend.

The Next.js app signs the user in with Google and issues a signed session
token (HS256 JWT, cookie `kabs_session`). It forwards that token here as
`Authorization: Bearer <token>`. We verify it with the shared SESSION_SECRET,
then load role + company from the Supabase `profiles` table (the token's
subject is the profile id).

Every router must depend on `get_current_user`; never trust an org id from
the request: use `user.org_id`.
"""
import os
import time
from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request

from app.core.supabase_client import current_org_id, get_supabase_admin


@dataclass(frozen=True)
class CurrentUser:
    uid: str  # profile id
    email: str
    org_id: str
    org_name: str
    role: str  # 'super_admin' | 'dealer_admin'

    @property
    def is_super_admin(self) -> bool:
        return self.role == "super_admin"


def _secret() -> str:
    s = os.getenv("SESSION_SECRET", "")
    if len(s) < 32:
        raise HTTPException(
            status_code=503,
            detail="Authentication is not configured on the server (SESSION_SECRET).",
        )
    return s


def _verify(token: str) -> tuple[str, int]:
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return payload["sub"], int(payload.get("v", 0))


# (profile id, token version) -> (expires_at, CurrentUser). Short TTL keeps polling endpoints cheap
# while suspensions / role changes still take effect within a minute.
_PROFILE_CACHE: dict[tuple[str, int], tuple[float, CurrentUser]] = {}
_PROFILE_TTL = 60.0


def _load_profile(sub: str, version: int) -> CurrentUser:
    hit = _PROFILE_CACHE.get((sub, version))
    if hit and hit[0] > time.time():
        return hit[1]

    try:
        res = (
            get_supabase_admin()
            .table("profiles")
            .select("email, role, status, org_id, token_version, organizations(name, status)")
            .eq("id", sub)
            .limit(1)
            .execute()
        )
    except Exception as e:
        print(f"[auth] profile lookup failed: {e}")
        raise HTTPException(
            status_code=503,
            detail="Accounts database is not ready (run docs/multitenant_001_add_orgs.sql).",
        )
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=403, detail="No account for this user")
    p = rows[0]
    org = p.get("organizations")
    if isinstance(org, list):
        org = org[0] if org else None
    if p.get("status") == "disabled" or not org or org.get("status") != "active":
        raise HTTPException(status_code=403, detail="Account disabled or suspended")
    if int(p.get("token_version") or 0) != version:
        raise HTTPException(status_code=401, detail="Session expired, please sign in again")

    user = CurrentUser(uid=sub, email=p["email"], org_id=p["org_id"], org_name=org["name"], role=p["role"])
    _PROFILE_CACHE[(sub, version)] = (time.time() + _PROFILE_TTL, user)
    return user


def _bearer(request: Request) -> Optional[str]:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


async def get_current_user(request: Request) -> CurrentUser:
    token = _bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sub, version = _verify(token)
    user = _load_profile(sub, version)
    request.state.user = user
    current_org_id.set(user.org_id)  # scopes get_supabase() to this company for the request
    return user


async def require_super_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Super admin only")
    return user
