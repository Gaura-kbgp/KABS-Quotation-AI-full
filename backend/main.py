import os
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.api import analyze, pricing
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

load_dotenv()

app = FastAPI(title="KABS Quotation AI Backend")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(analyze.router, prefix="/api", tags=["Analysis"])
app.include_router(pricing.router, prefix="/api", tags=["Pricing"])

@app.get("/")
async def root():
    return {
        "message": "KABS Quotation AI FastAPI Backend is running",
        "version": "1.0.1",
        "last_reloaded": "2026-03-16T21:15:00"
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
