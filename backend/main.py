import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Add current directory to path so 'app' can be found
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
load_dotenv()

from app.api.pricing import router as pricing_router

app = FastAPI(title="KABS Quotation AI Backend")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(pricing_router, prefix="/api")

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
