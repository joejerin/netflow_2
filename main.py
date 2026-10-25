import ipaddress, importlib.util, json, os, re, shutil, socket, subprocess, sys, threading, uuid
from urllib.parse import urlparse
from pathlib import Path
import numpy as np, librosa
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

DATA = Path(__file__).parent / "data"; DATA.mkdir(exist_ok=True)
MAX = 100 * 1024 * 1024
EXT = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".mp4", ".webm", ".mkv", ".mov"}
VIDEO_EXT = {".mp4", ".webm", ".mkv", ".mov"}
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
app = FastAPI(title="NoteFlow")
jobs: dict = {}

# Serve the built frontend when deployed as one combined service (e.g. Hugging Face Spaces / Docker).
# In local dev (vite's "npm run dev") this directory doesn't exist, so it's skipped and nothing changes.
_dist = Path(__file__).parent.parent / "frontend" / "dist"

def has(mod): return importlib.util.find_spec(mod) is not None
def ffmpeg_ok(): return shutil.which("ffmpeg") is not None

def sdir(sid):
    if not re.fullmatch(r"[0-9a-f]{32}", sid) or not (DATA / sid).is_dir():
        raise HTTPException(404, "Song not found")
    return DATA / sid

# ---------- audio decoding ----------
def to_wav(path: Path) -> Path:
    """Video files and odd containers are pre-extracted with ffmpeg rather than left to librosa's
    best-effort decoder, which is unreliable for mkv/webm. Raises RuntimeError with a clear cause."""
    if path.suffix.lower() not in VIDEO_EXT:
        return path
    if not ffmpeg_ok():
        raise RuntimeError("ffmpeg is not installed or not on PATH; required to read video files")
    out = path.with_suffix(".extracted.wav")
    r = subprocess.run(["ffmpeg", "-y", "-i", str(path), "-ac", "1", "-ar", "22050", str(out)],
                        capture_output=True, timeout=600)
    if r.returncode != 0 or not out.exists():
        raise RuntimeError(f"ffmpeg could not extract audio from this file: {r.stderr.decode(errors='ignore')[:200]}")
    return out

# ---------- Demucs 6-source separation (vocals, drums, bass, guitar, piano, other) ----------
def run_demucs(path: Path, outdir: Path, j: dict):
    if not has("demucs"):
        return None, "Demucs is not installed (pip install -r requirements-demucs.txt)"
    err = None
    for model in ("htdemucs_6s", "htdemucs"):  # 6-source model first; falls back to the 4-source model
        try:
            r = subprocess.run([sys.executable, "-m", "demucs", "-n", model, "-o", str(outdir), str(path)],
                                capture_output=True, timeout=1800)
            if r.returncode != 0:
                err = r.stderr.decode(errors="ignore")[-300:]; continue
            base = next((p for p in (outdir / model).glob("*") if p.is_dir()), None)
            if base:
                return {f.stem: f for f in base.glob("*.wav")}, model
        except subprocess.TimeoutExpired:
            return None, f"Demucs timed out after 30 minutes (model {model})"
        except Exception as e:
            err = str(e)[:200]
    return None, f"Demucs failed: {err or 'unknown error'}"

# ---------- Spotify Basic Pitch transcription ----------
def run_basic_pitch(audio_path: Path):
    if not has("basic_pitch"):
        return None, "Basic Pitch is not installed (pip install -r requirements-basicpitch.txt)"
    try:
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
        _, _, note_events = predict(str(audio_path), ICASSP_2022_MODEL_PATH)
        out = []
        for ev in note_events:
            start, end, midi = float(ev[0]), float(ev[1]), int(round(ev[2]))
            if end <= start or not (0 <= midi <= 127): continue
            out.append({"t": round(start, 3), "d": round(end - start, 3), "midi": midi,
                         "name": NAMES[midi % 12], "octave": midi // 12 - 1})
        out.sort(key=lambda n: n["t"])
        return out, None
    except Exception as e:
        return None, f"Basic Pitch failed: {str(e)[:200]}"

# ---------- pYIN fallback: monophonic pitch tracking (used when Basic Pitch is unavailable) ----------
def pyin_fallback(y: np.ndarray, sr: int):
    hop = 512
    f0, voiced, prob = librosa.pyin(y, fmin=librosa.note_to_hz("E2"), fmax=librosa.note_to_hz("E6"),
                                     sr=sr, frame_length=2048, hop_length=hop)
    ts = librosa.times_like(f0, sr=sr, hop_length=hop)
    midi = np.round(librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0)))
    def extract(th):
        good = voiced & (prob > th) & ~np.isnan(f0)
        notes, cur, gap = [], None, 0
        for t, m, ok in zip(ts, midi, good):
            if cur and ok and m == cur[0]: cur[2] = t; gap = 0; continue
            if cur and not ok and gap < 3: gap += 1; continue
            if cur: notes.append(cur); cur = None
            gap = 0
            if ok: cur = [m, t, t]
        if cur: notes.append(cur)
        dt = hop / sr
        return [{"t": round(float(s), 3), "d": round(float(e - s + dt), 3), "midi": int(m),
                 "name": NAMES[int(m) % 12], "octave": int(m) // 12 - 1} for m, s, e in notes if e - s >= 0.06]
    out = extract(0.6)
    if len(out) < 8: out = extract(0.3)
    return out

def save_midi(notes, path: Path) -> bool:
    if not has("pretty_midi") or not notes: return False
    try:
        import pretty_midi
        pm = pretty_midi.PrettyMIDI()
        inst = pretty_midi.Instrument(program=0)
        for n in notes:
            inst.notes.append(pretty_midi.Note(velocity=90, pitch=n["midi"], start=n["t"], end=n["t"] + max(n["d"], 0.05)))
        pm.instruments.append(inst); pm.write(str(path))
        return True
    except Exception:
        return False

# ---------- main pipeline ----------
def analyze(sid, path):
    j = jobs[sid]; warnings = []
    j.update(progress=3, stage="Decoding audio")
    try:
        path = to_wav(Path(path))
    except RuntimeError as e:
        warnings.append(str(e)); path = Path(path)  # let librosa try anyway and fail loudly below if it can't
    y, sr = librosa.load(str(path), sr=22050, mono=True)
    yh, _ = librosa.effects.hpss(y)  # harmonic content, used for key/chords and as the no-separation fallback

    j.update(progress=15, stage="Separating instruments with Demucs (can take several minutes on CPU)")
    stems, demucs_info = (None, "disabled (NOTEFLOW_SEPARATE=off)")
    if os.environ.get("NOTEFLOW_SEPARATE", "auto") != "off":
        stems, demucs_info = run_demucs(path, Path(path).parent / "stems", j)
    if not stems:
        warnings.append(f"Instrument separation unavailable ({demucs_info}); transcribing the mixed track instead.")

    j.update(progress=45, stage="Detecting tempo, key and chords")
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    chroma = librosa.feature.chroma_cqt(y=yh, sr=sr)
    prof = chroma.mean(1); best = (-2, 0, "major")
    for k in range(12):
        for mode, p in (("major", MAJ), ("minor", MIN)):
            c = np.corrcoef(prof, np.roll(p, k))[0, 1]
            if c > best[0]: best = (c, k, mode)
    tmpl, labels = [], []
    for k in range(12):
        for q, iv in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            v = np.zeros(12); v[[(k + i) % 12 for i in iv]] = 1; tmpl.append(v); labels.append(NAMES[k] + q)
    chords = []
    if len(beats) > 1:
        cs = librosa.util.sync(chroma, beats, aggregate=np.median)
        times = np.concatenate([[0], librosa.frames_to_time(beats, sr=sr), [len(y) / sr]])
        for i in range(cs.shape[1]):
            name = labels[int(np.argmax([np.dot(cs[:, i], t) for t in tmpl]))]
            if chords and chords[-1]["name"] == name: chords[-1]["d"] = round(times[i + 1] - chords[-1]["t"], 3)
            else: chords.append({"t": round(times[i], 3), "d": round(times[i + 1] - times[i], 3), "name": name})

    def transcribe(label, stem_key, progress):
        j.update(progress=progress, stage=f"Transcribing {label}")
        src = stems.get(stem_key) if stems else None
        if src and src.exists():
            notes, err = run_basic_pitch(src)
            if notes is not None:
                return notes, f"demucs({demucs_info})+basic-pitch"
            warnings.append(f"{label}: {err}; using fallback pitch tracking on the isolated {stem_key} stem.")
            ya, _ = librosa.load(str(src), sr=sr, mono=True)
            return pyin_fallback(ya, sr), f"demucs({demucs_info})+pyin-fallback"
        other = stems.get("other") if stems else None
        if other and other.exists() and stem_key == "guitar":
            # 4-source Demucs has no dedicated guitar stem; "other" is the closest substitute
            warnings.append(f"{label}: no dedicated stem from this Demucs model; using the combined 'other' stem.")
            notes, err = run_basic_pitch(other)
            if notes is not None: return notes, f"demucs({demucs_info},other)+basic-pitch"
            ya, _ = librosa.load(str(other), sr=sr, mono=True)
            return pyin_fallback(ya, sr), f"demucs({demucs_info},other)+pyin-fallback"
        warnings.append(f"{label}: no isolated stem available; detecting the strongest pitch in the full mix "
                         f"(vocals, drums or other instruments will cause wrong notes).")
        return pyin_fallback(yh, sr), "pyin-only (mixed track, no separation)"

    guitar_notes, g_engine = transcribe("Guitar", "guitar", 55)
    keyboard_notes, k_engine = transcribe("Keyboard/Piano", "piano", 75)

    j.update(progress=92, stage="Writing MIDI")
    has_g_midi = save_midi(guitar_notes, DATA / sid / "guitar.mid")
    has_k_midi = save_midi(keyboard_notes, DATA / sid / "keyboard.mid")
    if not has("pretty_midi"): warnings.append("MIDI export unavailable (pretty_midi not installed).")

    res = {"bpm": round(float(np.atleast_1d(tempo)[0]), 1), "key": f"{NAMES[best[1]]} {best[2]}",
           "duration": round(len(y) / sr, 2), "notes": guitar_notes, "chords": chords,
           "keyboard_notes": keyboard_notes, "separated": bool(stems),
           "engine": {"guitar": g_engine, "keyboard": k_engine},
           "midi": {"guitar": has_g_midi, "keyboard": has_k_midi}, "warnings": warnings}
    (DATA / sid / "analysis.json").write_text(json.dumps(res))

def run(sid, path):
    jobs[sid] = {"status": "running", "progress": 0, "stage": "Queued"}
    def work():
        try: analyze(sid, path); jobs[sid].update(status="done", progress=100, stage="Done")
        except Exception as e: jobs[sid].update(status="error", error=f"Analysis failed: {e}")
    threading.Thread(target=work, daemon=True).start()

@app.post("/api/songs")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in EXT: raise HTTPException(400, "Unsupported file type")
    sid = uuid.uuid4().hex; d = DATA / sid; d.mkdir(); p = d / f"audio{ext}"; size = 0
    f = open(p, "wb")
    while c := await file.read(1 << 20):
        size += len(c)
        if size > MAX:
            f.close(); shutil.rmtree(d, ignore_errors=True); raise HTTPException(413, "File too large (100 MB max)")
        f.write(c)
    f.close()
    name = Path(file.filename).stem[:80]
    (d / "meta.json").write_text(json.dumps({"name": name, "file": p.name}))
    run(sid, p); return {"id": sid, "name": name}

class Yt(BaseModel): url: str

def safe_url(u):  # only public http(s) links; blocks localhost/private network addresses
    p = urlparse(u.strip())
    if p.scheme not in ("http", "https") or not p.hostname: raise HTTPException(400, "Enter a valid http(s) link")
    try: infos = socket.getaddrinfo(p.hostname, None)
    except socket.gaierror: raise HTTPException(400, "Could not resolve that link")
    for i in infos:
        ip = ipaddress.ip_address(i[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(400, "That address is not allowed")
    return u.strip()

@app.post("/api/youtube")
def youtube(b: Yt):
    url = safe_url(b.url)
    try: import yt_dlp
    except ImportError: raise HTTPException(501, "Run: pip install yt-dlp (and install ffmpeg)")
    sid = uuid.uuid4().hex; d = DATA / sid; d.mkdir()
    host = (urlparse(url).hostname or "").lower()
    ig = host.endswith("instagram.com") or host.endswith("instagr.am")
    opts = {"format": "bestaudio/best", "outtmpl": str(d / "audio.%(ext)s"),
            "noplaylist": True, "quiet": True, "max_filesize": MAX}
    ck = os.environ.get("NOTEFLOW_COOKIES")  # optional cookies.txt, helps with Instagram / age-gated YouTube
    if ck and Path(ck).is_file(): opts["cookiefile"] = ck
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=True)
    except Exception as e:
        shutil.rmtree(d, ignore_errors=True)
        hint = (" Instagram usually needs a logged-in session: export your browser cookies to a cookies.txt file, "
                "set NOTEFLOW_COOKIES to its path, and restart the backend.") if ig else " Try again or upload the file instead."
        raise HTTPException(400, f"Could not fetch audio.{hint} ({str(e)[:150]})")
    p = next(d.glob("audio.*")); name = (info.get("title") or "YouTube audio")[:80]
    (d / "meta.json").write_text(json.dumps({"name": name, "file": p.name}))
    run(sid, p); return {"id": sid, "name": name}

@app.get("/api/jobs/{sid}")
def job(sid: str):
    sdir(sid); return jobs.get(sid, {"status": "done", "progress": 100, "stage": "Done"})

@app.get("/api/songs")
def songs():
    r = []
    for d in sorted(DATA.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if (d / "meta.json").exists():
            r.append({"id": d.name, "name": json.loads((d / "meta.json").read_text())["name"],
                      "analyzed": (d / "analysis.json").exists()})
    return r

@app.get("/api/songs/{sid}/analysis")
def analysis(sid: str):
    p = sdir(sid) / "analysis.json"
    if not p.exists(): raise HTTPException(404, "Not analyzed yet")
    return json.loads(p.read_text())

@app.get("/api/songs/{sid}/audio")
def audio(sid: str):
    d = sdir(sid); return FileResponse(d / json.loads((d / "meta.json").read_text())["file"])

@app.get("/api/songs/{sid}/midi/{inst}")
def midi(sid: str, inst: str):
    if inst not in ("guitar", "keyboard"): raise HTTPException(404, "inst must be 'guitar' or 'keyboard'")
    d = sdir(sid); p = d / f"{inst}.mid"
    if not p.exists():
        raise HTTPException(404, f"No MIDI file for {inst}. Either pretty_midi isn't installed, "
                                  f"or no notes were transcribed for this instrument.")
    return FileResponse(p, filename=f"{inst}.mid")

@app.delete("/api/songs/{sid}")
def delete(sid: str):
    shutil.rmtree(sdir(sid)); jobs.pop(sid, None); return {"ok": True}

if _dist.is_dir():
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse as _FR
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        f = _dist / full_path
        if full_path and f.is_file(): return _FR(f)
        return _FR(_dist / "index.html")  # client-side routing fallback
