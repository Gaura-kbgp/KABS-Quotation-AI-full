"""
Minimal in-memory rate limiter for AI-calling endpoints (GPT-4o Vision /
manufacturer detection / blueprint parsing). Without this, any authenticated
user could loop-call these in a tight script and run up a large OpenAI bill
with no cap — auth alone doesn't bound cost.

Deliberately dependency-free (no slowapi/redis) to match the existing
in-memory limiter already used on the frontend (frontend/src/lib/rate-limit.ts)
and avoid adding a new runtime dependency for this. Same caveat as that one:
per-process only, resets on restart, not shared across horizontally-scaled
instances — acceptable for the current single-container deployment; revisit
with a shared store (Redis) if this ever scales to multiple backend instances.
"""
import time
from collections import defaultdict

from fastapi import Depends, HTTPException, Request

from app.core.auth import CurrentUser, get_current_user

# user_id -> list of request timestamps within the current window
_HITS: dict[str, list[float]] = defaultdict(list)


def _check(key: str, max_requests: int, window_s: float) -> None:
    now = time.time()
    hits = _HITS[key]
    cutoff = now - window_s
    # Drop expired timestamps so the list doesn't grow unbounded
    while hits and hits[0] < cutoff:
        hits.pop(0)
    if len(hits) >= max_requests:
        retry_after = int(window_s - (now - hits[0])) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Too many AI requests — please wait {retry_after}s and try again.",
            headers={"Retry-After": str(retry_after)},
        )
    hits.append(now)


def ai_rate_limit(max_requests: int = 20, window_s: float = 60.0):
    """FastAPI dependency factory: caps AI-calling requests per user per window.
    Default 20/min per user — generous for normal use, bounds a runaway loop."""
    async def _dep(request: Request, user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        _check(f"user:{user.uid}", max_requests, window_s)
        return user
    return _dep
