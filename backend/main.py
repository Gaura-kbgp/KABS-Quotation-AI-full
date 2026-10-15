import os
import sys
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Add current directory to path so 'app' can be found
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
load_dotenv()

# Disable system proxies to prevent httpx 'proxy' argument bug
os.environ['HTTP_PROXY'] = ''
os.environ['HTTPS_PROXY'] = ''
os.environ['http_proxy'] = ''
os.environ['https_proxy'] = ''
os.environ['NO_PROXY'] = '*'

from app.api.pricing import router as pricing_router
from app.api.agent import router as agent_router
from app.api.labor import router as labor_router
from app.api.catalog import router as catalog_router
from app.api.elevate import router as elevate_router
from app.api.blueprint import router as blueprint_router
from app.core.auth import get_current_user
from app.core.rate_limit import ai_rate_limit
from app.core.ip_rate_limit import IPRateLimitMiddleware

IS_PRODUCTION = os.getenv("ENV", "development").lower() == "production"

# Interactive docs (/docs, /redoc) and the raw OpenAPI schema disclose every
# endpoint shape and internal field name — harmless in dev, unnecessary
# information disclosure once deployed. The routers themselves still require
# auth either way; this only hides the map of what to attack.
app = FastAPI(
    title="KABS Pricing AI Backend",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

# IP-based rate limiting — runs before auth and CORS so floods are dropped early
app.add_middleware(IPRateLimitMiddleware)

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    # Defense-in-depth headers for an API that returns browser-consumed JSON
    # and, via /docs when enabled, an actual HTML page.
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


# Include routes. agent_router and blueprint_router are the AI-calling
# (GPT-4o Vision) routes — rate-limited per user on top of auth, since auth
# alone doesn't bound how many times a logged-in user can loop-call an
# expensive AI endpoint and run up the OpenAI bill.
app.include_router(pricing_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(agent_router, prefix="/api", dependencies=[Depends(ai_rate_limit())])
app.include_router(labor_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(catalog_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(elevate_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(blueprint_router, prefix="/api", dependencies=[Depends(ai_rate_limit())])

@app.get("/")
async def root():
    return {
        "status": "online",
        "message": "KABS Pricing AI Backend is running",
        "version": "1.0.0"
    }


@app.get("/health")
async def health():
    """Unauthenticated liveness check — no DB round-trip, no internal detail,
    safe to expose to a load balancer / uptime monitor."""
    return {"status": "ok"}


if __name__ == "__main__":
    # Only reachable via `python main.py` directly — the actual deployed
    # entrypoint (start.sh) invokes uvicorn without --reload. Guarded by
    # IS_PRODUCTION anyway so a stray `python main.py` in prod can't
    # accidentally enable live code reload.
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=not IS_PRODUCTION)
