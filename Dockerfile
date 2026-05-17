# مطاعم — نشر Railway: واجهة React + FastAPI + pyodbc (unixODBC)
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.*.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends unixodbc unixodbc-dev g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=frontend /app/ui/restaurant ./ui/restaurant

ENV MAT3AM_BASE_DIR=/data
WORKDIR /app/backend
CMD ["python", "api_server.py"]
