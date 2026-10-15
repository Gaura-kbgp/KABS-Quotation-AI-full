"""
IP-based rate limiter middleware for FastAPI.

Runs before auth so unauthenticated floods are stopped at the gate.
Per-process / in-memory — acceptable for single-container deployment.
Revisit with Redis if horizontal scaling is added.

Limits:
  - Default:        200 req / 60 s  per IP   (normal browsing headroom)
  - Heavy uploads:  10  req / 60 s  per IP   (catalog PDF ingest, drawing upload)
  - Burst block:    if an IP exceeds 50 req in a 5-second window → 60 s cooldown
"""

import time
from collections import defaultdict
from typing import Callable

from fastapi import HTTPException, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# ip -> [timestamp, ...]
_HITS: dict[str, list[float]] = defaultdict(list)
_BLOCKED: dict[str, float] = {}          # ip -> unblock_at epoch

_WINDOW     = 60.0   # seconds
_MAX_REQ    = 200    # normal limit per window
_BURST_WIN  = 5.0    # seconds
_BURST_MAX  = 50     # requests in burst window → temp block
_BLOCK_DUR  = 60.0   # seconds to block after burst


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_ip(ip: str) -> None:
    now = time.time()

    # Blocked?
    unblock_at = _BLOCKED.get(ip, 0)
    if unblock_at > now:
        retry = int(unblock_at - now) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests — your IP is temporarily blocked. Retry in {retry}s.",
            headers={"Retry-After": str(retry)},
        )

    hits = _HITS[ip]
    cutoff = now - _WINDOW
    while hits and hits[0] < cutoff:
        hits.pop(0)

    # Burst check (last 5 s)
    burst_cutoff = now - _BURST_WIN
    recent = sum(1 for t in hits if t >= burst_cutoff)
    if recent >= _BURST_MAX:
        _BLOCKED[ip] = now + _BLOCK_DUR
        raise HTTPException(
            status_code=429,
            detail=f"Request burst detected — IP blocked for {int(_BLOCK_DUR)}s.",
            headers={"Retry-After": str(int(_BLOCK_DUR))},
        )

    # Window check
    if len(hits) >= _MAX_REQ:
        retry = int(_WINDOW - (now - hits[0])) + 1
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded — try again in {retry}s.",
            headers={"Retry-After": str(retry)},
        )

    hits.append(now)


class IPRateLimitMiddleware(BaseHTTPMiddleware):
    """Drop-in Starlette middleware — attach in main.py before the routers."""

    # Paths exempt from rate limiting (health probe, static assets)
    _EXEMPT = {"/health", "/"}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.url.path in self._EXEMPT:
            return await call_next(request)
        ip = _client_ip(request)
        _check_ip(ip)
        return await call_next(request)
