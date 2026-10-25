#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/backend"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
command -v ffmpeg >/dev/null || echo "WARNING: ffmpeg not found. Link import and mp4 files need it."
echo "Tip: for real Demucs + Basic Pitch transcription, run: pip install -r requirements-demucs.txt -r requirements-basicpitch.txt (large, one-time download)"
uvicorn main:app --port 8000 &
BACK=$!
trap "kill $BACK" EXIT
cd ../frontend
[ -d node_modules ] || npm install
npm run dev -- --open
