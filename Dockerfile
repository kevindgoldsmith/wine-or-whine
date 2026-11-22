# --- Stage 1: build the web client ---
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY themes/ /themes/
RUN npm run build

# --- Stage 2: Python server ---
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY engine/ engine/
COPY server/ server/
COPY themes/ themes/
COPY config/ config/
COPY static/ static/
COPY --from=web /web/dist web/dist
EXPOSE 8000
# Shell form so $PORT expands. One worker: live room state is in memory (see DECISIONS.md).
CMD uvicorn server.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --ws-max-size 16384 --timeout-graceful-shutdown 5
