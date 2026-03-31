#!/bin/bash

# Start the Python FastAPI backend on port 8000
echo "Starting KABS Backend on port 8000..."
cd /app/backend && uvicorn main:app --host 0.0.0.0 --port 8000 &

# Start the Next.js Frontend on the Render-provided $PORT
echo "Starting KABS Frontend on port $PORT..."
cd /app/frontend && exec node server.js
