# Optional: Demucs + Basic Pitch pipeline

By default NoteFlow runs on `requirements.txt` only, using a single pitch-tracker
(pYIN) on the harmonic content of the mixed track. This works but is inaccurate on
full-band recordings with vocals and multiple instruments.

Installing the two packages below upgrades every analysis automatically (no code
or UI change needed) to:
1. Demucs 6-source separation (`htdemucs_6s`): splits the track into vocals, drums,
   bass, guitar, piano and other.
2. Spotify Basic Pitch: transcribes the isolated guitar and piano stems into real
   polyphonic MIDI notes, instead of a single-pitch estimate.

## Install

    pip install -r requirements-demucs.txt
    pip install -r requirements-basicpitch.txt

Both pull in PyTorch/TensorFlow, a multi-GB download, and both run on CPU by
default (no GPU required, but a CPU run is slow: Demucs alone can take several
minutes per song, and Basic Pitch adds more on top). Set the environment
variable `NOTEFLOW_SEPARATE=off` to skip Demucs and use the fast pYIN-only path.

## What you get back from `/api/songs/{id}/analysis`

- `notes`: guitar notes (same shape as before — the existing frontend already
  reads this for the fretboard).
- `keyboard_notes`: piano/keyboard notes, same shape.
- `engine.guitar` / `engine.keyboard`: which pipeline actually produced each
  instrument's notes, e.g. `"demucs(htdemucs_6s)+basic-pitch"` or
  `"pyin-only (mixed track, no separation)"` if neither tool was installed.
- `warnings`: plain-language list of anything that fell back or failed —
  check this before trusting the notes on a given song.
- `midi.guitar` / `midi.keyboard`: true/false — whether a downloadable MIDI
  file was produced (requires `pretty_midi`). Download from
  `GET /api/songs/{id}/midi/guitar` or `.../midi/keyboard`.

## Known limitations (not fixed by installing these)

- Demucs' `other` stem (used when a model has no explicit guitar stem) can mix
  in synths or other non-guitar sound.
- Basic Pitch is not run with a timeout in-process; a very long song can take a
  long time on CPU. Trim long uploads if analysis seems stuck.
- Guitar string/fret positions are still estimated heuristically from pitch —
  neither tool detects which physical string was played.
