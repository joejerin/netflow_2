# Deploying NoteFlow so it has a real public URL

This repo can't run as a public website inside this chat (no internet, no exposed
port). The fastest free way to get an actual link you can open from any browser
is Hugging Face Spaces, using the Dockerfile already in this folder.

## Hugging Face Spaces (free CPU, persistent URL)

1. Go to huggingface.co, sign up/in, click **New Space**.
2. Pick an SDK of **Docker**, hardware **CPU basic (free)**, visibility your choice.
3. In the new Space, use "Upload files" (or `git push`, a Space is a git repo) to
   push the entire contents of this `noteflow` folder, Dockerfile included, to it.
4. The Space builds automatically. First build is slow (~10-20 min): it installs
   PyTorch, Demucs and Basic Pitch and their models.
5. When it finishes you get a URL like `https://huggingface.co/spaces/<you>/noteflow`
   — open it, and that's your website, fully working, with Demucs + Basic Pitch.

Free CPU tier: no GPU, so Demucs separation will take a few minutes per song.
That's a real constraint of free hosting, not a bug.

## Alternatives
- **Render.com** / **Railway.app**: both support "Deploy from Dockerfile" directly
  from a GitHub repo, with a free or low-cost tier. Push this folder to GitHub,
  then "New Web Service" → point at the repo → it detects the Dockerfile.
- **Your own computer**: `start.bat` / `start.sh`, as before — fastest, but only
  reachable from your own machine, not a public URL.

## Environment variables you can set on the host
- `NOTEFLOW_SEPARATE=off` — skip Demucs, instant analysis, lower accuracy.
- `NOTEFLOW_COOKIES=/path/to/cookies.txt` — needed for most Instagram links.
