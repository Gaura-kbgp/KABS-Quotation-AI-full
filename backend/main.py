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

app = FastAPI(title="KABS Quotation AI Backend")
# Force reload v3

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(pricing_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(agent_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(labor_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(catalog_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(elevate_router, prefix="/api", dependencies=[Depends(get_current_user)])
app.include_router(blueprint_router, prefix="/api", dependencies=[Depends(get_current_user)])

@app.get("/")
async def root():
    return {
        "status": "online",
        "message": "KABS Quotation AI Backend is running",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    import uvicorn
    # Use port 8000 as expected by the frontend proxy
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
