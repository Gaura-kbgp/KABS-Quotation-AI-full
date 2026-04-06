#!/bin/bash

# Start the Python FastAPI backend on port 8000 using Gunicorn for production stability
echo "Starting KABS Backend on port 8000..."
cd /app/backend && gunicorn -w 2 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:8000 --daemon

# Wait a moment for the backend to initialize
sleep 2

# Start the Next.js Frontend on the Render-provided $PORT
echo "Starting KABS Frontend on port $PORT..."
cd /app/frontend && exec node server.js
