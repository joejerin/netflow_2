@echo off
cd /d "%~dp0backend"
if not exist .venv python -m venv .venv
call .venv\Scripts\activate
pip install -q -r requirements.txt
where ffmpeg >nul 2>&1 || echo WARNING: ffmpeg not found. Link import and mp4 files need it: https://ffmpeg.org/download.html
echo Tip: for real Demucs + Basic Pitch transcription, run: pip install -r requirements-demucs.txt -r requirements-basicpitch.txt (large, one-time download)
start "NoteFlow backend" cmd /k "cd /d %~dp0backend && call .venv\Scripts\activate && uvicorn main:app --port 8000"
cd /d "%~dp0frontend"
if not exist node_modules call npm install
start "NoteFlow frontend" cmd /k "npm run dev -- --open"
