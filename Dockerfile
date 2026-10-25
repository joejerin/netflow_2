# NoteFlow: single-container deploy (frontend build + FastAPI backend + Demucs + Basic Pitch).
# Builds the React frontend, then serves it and the API from one Python/uvicorn process.
# Target: Hugging Face Spaces (Docker SDK, free CPU tier) or any Docker host (Render, Railway, Fly.io).

FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements-demucs.txt backend/requirements-basicpitch.txt ./backend/
# CPU-only torch keeps the image smaller and matches the free CPU tier (no GPU assumed).
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r backend/requirements.txt \
                                -r backend/requirements-demucs.txt \
                                -r backend/requirements-basicpitch.txt
COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist

ENV NOTEFLOW_SEPARATE=auto
EXPOSE 7860
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
