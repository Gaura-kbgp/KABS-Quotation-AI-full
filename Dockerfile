# Stage 1: Build Frontend (Next.js)
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# We set this to true for standalone output
ENV NEXT_OUTPUT=standalone
RUN npm run build

# Stage 2: Build Backend (FastAPI) and Final Image
FROM python:3.11-slim AS final
WORKDIR /app

# Install system dependencies (including node and git)
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy Backend files and install dependencies
COPY backend/ /app/backend
WORKDIR /app/backend
RUN pip install --no-cache-dir -r requirements.txt

# Copy Frontend standalone build from first stage
COPY --from=frontend-builder /app/frontend/.next/standalone /app/frontend
COPY --from=frontend-builder /app/frontend/public /app/frontend/public
COPY --from=frontend-builder /app/frontend/.next/static /app/frontend/.next/static

# Setup Startup Script
WORKDIR /app
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Expose ports (Render will use $PORT for public face)
EXPOSE 8000
EXPOSE 10000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=10000

# Start command
CMD ["/app/start.sh"]
