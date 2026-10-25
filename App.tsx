import { useEffect, useMemo, useRef, useState } from "react";
type Note = { t: number; d: number; midi: number; name: string; octave: number };
type Analysis = { bpm: number; key: string; duration: number; notes: Note[]; chords: { t: number; d: number; name: string }[]; demo?: boolean;
  keyboard_notes?: Note[]; engine?: { guitar: string; keyboard: string }; warnings?: string[]; midi?: { guitar: boolean; keyboard: boolean } };
type Pos = { s: number; f: number } | null;
const NN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const TUNINGS: Record<string, number[]> = {
  "Standard (E A D G B E)": [40, 45, 50, 55, 59, 64], "Drop D": [38, 45, 50, 55, 59, 64],
  "Half-step down": [39, 44, 49, 54, 58, 63], "DADGAD": [38, 45, 50, 55, 57, 62] };
const btn = "px-3 py-1.5 rounded-lg text-sm bg-white/10 hover:bg-white/20 transition";
const hot = "px-3 py-1.5 rounded-lg text-sm bg-gradient-to-r from-violet-600 to-blue-600 hover:brightness-110";

// Pick the string/fret closest to the previous hand position (real mapping from detected MIDI pitch).
function mapNotes(notes: Note[], tun: number[]): Pos[] {
  let pf = 5;
  return notes.map((n) => {
    let best = null as Pos, bc = 1e9;
    tun.forEach((o, s) => { const f = n.midi - o; if (f < 0 || f > 22) return;
      const c = Math.abs(f - pf) + (f === 0 ? 2 : 0) + (22 - f) * 0.01; if (c < bc) { bc = c; best = { s, f }; } });
    const b = best as Pos; if (b) pf = Math.max(b.f, 1); return b; });
}
function wav(notes: Note[], sr = 22050) { // synthesizes the DEMO phrase only
  const L = notes[notes.length - 1], n = Math.ceil((L.t + L.d + 0.3) * sr), pcm = new Int16Array(n);
  for (const x of notes) { const f = 440 * 2 ** ((x.midi - 69) / 12), s = Math.floor(x.t * sr);
    for (let i = s; i < Math.floor((x.t + x.d) * sr) && i < n; i++) { const t = (i - s) / sr, e = Math.min(1, t * 60) * Math.exp(-t * 2.5);
      pcm[i] = Math.sin(2 * Math.PI * f * t) * e * 9000 + Math.sin(4 * Math.PI * f * t) * e * 3000; } }
  const b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  new Int16Array(b, 44).set(pcm); return new Blob([b], { type: "audio/wav" });
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Fretboard({ tun, cur, nxt, curN, nxtN, label }: { tun: number[]; cur: Pos; nxt: Pos; curN?: Note; nxtN?: Note; label: string }) {
  const W = 1000, L = 44, N = 22, sc = 1 - 2 ** (-N / 12);
  const fx = (f: number) => L + (W - L - 10) * (1 - 2 ** (-f / 12)) / sc, sy = (s: number) => 20 + (5 - s) * 26;
  const cx = (f: number) => (f === 0 ? L - 20 : (fx(f - 1) + fx(f)) / 2);
  const dot = (p: Pos, n: Note | undefined, main: boolean) => p && n && (<g key={main ? "c" : "n"}>
    <circle cx={cx(p.f)} cy={sy(p.s)} r={main ? 12 : 11} fill={main ? "#8b5cf6" : "none"} stroke={main ? "#fff" : "#3b82f6"} strokeWidth={2} strokeDasharray={main ? "" : "3"} />
    {main && <text x={cx(p.f)} y={sy(p.s) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{label === "note" ? n.name : p.f}</text>}</g>);
  return (<svg viewBox={`0 0 ${W} 180`} className="w-full rounded-xl" style={{ background: "linear-gradient(#2a1d14,#1c130d)" }}>
    {[3, 5, 7, 9, 15, 17, 19, 21].map((f) => <circle key={f} cx={cx(f)} cy={85} r={5} fill="#ffffff22" />)}
    {[12].map((f) => <g key={f}><circle cx={cx(f)} cy={60} r={5} fill="#ffffff22" /><circle cx={cx(f)} cy={110} r={5} fill="#ffffff22" /></g>)}
    {Array.from({ length: N + 1 }, (_, f) => <g key={f}><line x1={fx(f)} x2={fx(f)} y1={sy(5)} y2={sy(0)} stroke={f === 0 ? "#ddd" : "#8a8a95"} strokeWidth={f === 0 ? 4 : 2} />
      {f > 0 && <text x={cx(f)} y={172} textAnchor="middle" fontSize="10" fill="#9ca3af">{f}</text>}</g>)}
    {tun.map((o, s) => <g key={s}><line x1={L - 30} x2={W - 10} y1={sy(s)} y2={sy(s)} stroke="#d4d4d8" strokeWidth={1 + (5 - s) * 0.35} />
      <text x={6} y={sy(s) + 4} fontSize="11" fill="#a78bfa">{NN[o % 12]}</text></g>)}
    {dot(nxt, nxtN, false)}{dot(cur, curN, true)}</svg>);
}
function Keys({ cur, nxt }: { cur?: Note; nxt?: Note }) {
  const ws: number[] = []; for (let m = 36; m <= 84; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) ws.push(m);
  const x = (m: number) => ws.indexOf(m) * 24, fill = (m: number, d: string) => (cur?.midi === m ? "#8b5cf6" : nxt?.midi === m ? "#3b82f6" : d);
  return (<div className="overflow-x-auto"><svg viewBox={`0 0 ${ws.length * 24} 130`} style={{ minWidth: 700 }} className="w-full">
    {ws.map((m) => <rect key={m} x={x(m)} y={0} width={23} height={130} rx={3} fill={fill(m, "#f4f4f5")} />)}
    {ws.filter((m) => m % 12 === 0).map((m) => <text key={m} x={x(m) + 4} y={124} fontSize="10" fill="#444">C{m / 12 - 1}</text>)}
    {Array.from({ length: 49 }, (_, i) => 36 + i).filter((m) => [1, 3, 6, 8, 10].includes(m % 12)).map((m) => <rect key={m} x={x(m - 1) + 16} y={0} width={15} height={80} rx={2} fill={fill(m, "#18181b")} />)}</svg></div>);
}
function Wave({ url, dur, time, loop, seek }: { url: string; dur: number; time: number; loop: { a: number; b: number; on: boolean }; seek: (t: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null), [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => { let dead = false; setPeaks([]);
    fetch(url).then((r) => r.arrayBuffer()).then((b) => new AudioContext().decodeAudioData(b)).then((buf) => { if (dead) return;
      const d = buf.getChannelData(0), k = Math.floor(d.length / 800) || 1; setPeaks(Array.from({ length: 800 }, (_, i) => { let m = 0; for (let j = 0; j < k; j += 8) m = Math.max(m, Math.abs(d[i * k + j] || 0)); return m; })); }).catch(() => {});
    return () => { dead = true; }; }, [url]);
  useEffect(() => { const c = ref.current!, g = c.getContext("2d")!; g.clearRect(0, 0, 800, 70);
    if (loop.b > loop.a) { g.fillStyle = loop.on ? "#3b82f666" : "#ffffff22"; g.fillRect(loop.a / dur * 800, 0, (loop.b - loop.a) / dur * 800, 70); }
    g.fillStyle = "#8b5cf6"; peaks.forEach((p, i) => g.fillRect(i, 35 - p * 33, 1, p * 66 + 1));
    g.fillStyle = "#fff"; g.fillRect(time / dur * 800, 0, 2, 70); }, [peaks, time, loop, dur]);
  return <canvas ref={ref} width={800} height={70} className="w-full h-[70px] bg-black/30 rounded-lg cursor-pointer"
    onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * dur); }} />;
}

export default function App() {
  const [tab, setTab] = useState("home"), [an, setAn] = useState<Analysis | null>(null), [url, setUrl] = useState(""), [name, setName] = useState("");
  const [busy, setBusy] = useState<any>(null), [err, setErr] = useState(""), [time, setTime] = useState(0), [rate, setRate] = useState(1), [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState({ a: 0, b: 0, on: false }), [tuning, setTuning] = useState("Standard (E A D G B E)"), [label, setLabel] = useState("fret");
  const [songs, setSongs] = useState<any[]>([]), [yt, setYt] = useState(""), aud = useRef<HTMLAudioElement>(null), file = useRef<HTMLInputElement>(null);
  const tun = TUNINGS[tuning], notes = an?.notes ?? [], pos = useMemo(() => mapNotes(notes, tun), [an, tuning]);
  const knotes = an?.keyboard_notes ?? [];

  useEffect(() => { let r = 0; const tick = () => { const a = aud.current; if (a) { setTime(a.currentTime);
      if (loop.on && loop.b > loop.a && a.currentTime >= loop.b) a.currentTime = loop.a; } r = requestAnimationFrame(tick); };
    r = requestAnimationFrame(tick); return () => cancelAnimationFrame(r); }, [loop]);
  useEffect(() => { if (aud.current) aud.current.playbackRate = rate; }, [rate, url]);
  useEffect(() => { if (tab === "songs") fetch("/api/songs").then((r) => r.json()).then(setSongs); }, [tab]);

  let idx = -1; { let lo = 0, hi = notes.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (notes[m].t <= time + 0.03) { idx = m; lo = m + 1; } else hi = m - 1; } }
  const live = idx >= 0 && time < notes[idx].t + notes[idx].d + 0.15, ci = live ? idx : -1, ni = live ? idx + 1 : idx + 1;
  const chord = an?.chords.find((c) => time >= c.t && time < c.t + c.d)?.name;
  let kidx = -1; { let lo = 0, hi = knotes.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (knotes[m].t <= time + 0.03) { kidx = m; lo = m + 1; } else hi = m - 1; } }
  const klive = kidx >= 0 && time < knotes[kidx].t + knotes[kidx].d + 0.15, kci = klive ? kidx : -1, kni = klive ? kidx + 1 : kidx + 1;

  async function open(id: string, n: string) {
    const a = await (await fetch(`/api/songs/${id}/analysis`)).json(); setAn(a); setName(n); setUrl(`/api/songs/${id}/audio`); setLoop({ a: 0, b: 0, on: false }); setTab("guitar"); }
  async function start(req: Promise<Response>) {
    setErr(""); setBusy({ progress: 0, stage: "Uploading" });
    try { const r = await req; if (!r.ok) throw new Error((await r.json()).detail || "Request failed");
      const { id, name } = await r.json();
      for (;;) { const j = await (await fetch(`/api/jobs/${id}`)).json(); setBusy(j); if (j.status === "error") throw new Error(j.error); if (j.status === "done") break; await new Promise((x) => setTimeout(x, 700)); }
      await open(id, name);
    } catch (e: any) { setErr(e.message === "Failed to fetch" ? "Cannot reach backend. Is it running on port 8000?" : e.message); } finally { setBusy(null); } }
  const upload = (f: File) => { const fd = new FormData(); fd.append("file", f); start(fetch("/api/songs", { method: "POST", body: fd })); };
  function demo() { const seq = [64, 67, 69, 71, 74, 71, 69, 67, 64, 67, 71, 74, 76, 74, 71, 69];
    const ns = seq.map((m, i) => ({ t: 0.3 + i * 0.4, d: 0.38, midi: m, name: NN[m % 12], octave: Math.floor(m / 12) - 1 }));
    setAn({ bpm: 150, key: "E minor (demo)", duration: 7, notes: ns, chords: [], demo: true, keyboard_notes: ns, engine: { guitar: "demo", keyboard: "demo" }, warnings: [], midi: { guitar: false, keyboard: false } }); setName("DEMO phrase"); setUrl(URL.createObjectURL(wav(ns))); setTab("guitar"); }
  const seek = (t: number) => { if (aud.current) aud.current.currentTime = t; };
  const toggle = () => { const a = aud.current!; a.paused ? a.play() : a.pause(); };
  const tabChunks = () => { if (!notes.length) return null; const per = 8, cc = Math.floor(Math.max(ci, ni - 1, 0) / per), out = [];
    for (let c = Math.max(0, cc - 1); c <= Math.min(cc + 1, Math.floor((notes.length - 1) / per)); c++) { const idxs = notes.slice(c * per, c * per + per).map((_, i) => c * per + i);
      out.push(<pre key={c} className="text-sm leading-5 font-mono overflow-x-auto mb-3">{[5, 4, 3, 2, 1, 0].map((s) => <div key={s}>
        <span className="text-violet-300">{s === 5 ? NN[tun[s] % 12].toLowerCase() : NN[tun[s] % 12]}</span>|{idxs.map((i) => { const p = pos[i]; const on = p?.s === s;
          return <span key={i} className={i === ci ? "bg-violet-600 text-white" : on ? "text-blue-300" : "text-gray-600"}>{"-" + (on ? String(p!.f).padEnd(2, "-") : "--") + "-"}</span>; })}|</div>)}</pre>); }
    return out; };

  const nav = [["home", "Home"], ["guitar", "Guitar Notes"], ["keys", "Keyboard Notes"], ["songs", "My Songs"], ["settings", "Settings"]];
  const cur = notes[ci], nxt = notes[ni];
  return (<div className="min-h-screen max-w-5xl mx-auto p-3 sm:p-6 space-y-4">
    <header className="flex flex-wrap items-center gap-2 justify-between">
      <h1 className="text-2xl font-extrabold bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">NoteFlow</h1>
      <nav className="flex flex-wrap gap-1">{nav.map(([k, v]) => <button key={k} onClick={() => setTab(k)} className={tab === k ? hot : btn}>{v}</button>)}</nav></header>

    <section className="bg-white/5 rounded-2xl p-4 space-y-3">
      {url ? <>
        <div className="flex justify-between text-sm"><b>{name}</b><span className="text-gray-400">{an && `${an.key} · ${an.bpm} BPM`}{chord && ` · Chord ${chord}`}{an?.engine && ` · ${an.separated ? "Demucs-separated" : "mixed track"}`}{an?.warnings && an.warnings.length > 0 && ` · ${an.warnings.length} note${an.warnings.length > 1 ? "s" : ""}`}</span></div>
        {an?.demo && <div className="text-xs text-amber-300 bg-amber-500/10 rounded p-2">DEMO MODE: a synthesized example phrase, NOT detected from a real song.</div>}
        {an?.warnings && an.warnings.length > 0 && <div className="text-xs text-amber-300 bg-amber-500/10 rounded p-2">{an.warnings.join(" ")}</div>}
        <audio ref={aud} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />
        <Wave url={url} dur={an?.duration || aud.current?.duration || 1} time={time} loop={loop} seek={seek} />
        <div className="flex flex-wrap items-center gap-2">
          <button className={hot} onClick={toggle}>{playing ? "⏸ Pause" : "▶ Play"}</button>
          <span className="text-sm tabular-nums">{fmt(time)} / {fmt(an?.duration || 0)}</span>
          <span className="ml-2 text-xs text-gray-400">Speed</span>{[0.5, 0.75, 1].map((r) => <button key={r} className={rate === r ? hot : btn} onClick={() => setRate(r)}>{r}x</button>)}
          <span className="ml-2 text-xs text-gray-400">Loop</span>
          <button className={btn} onClick={() => setLoop({ ...loop, a: time, on: loop.b > time })}>Set A</button>
          <button className={btn} onClick={() => setLoop({ ...loop, b: time, on: time > loop.a })}>Set B</button>
          <button className={loop.on ? hot : btn} onClick={() => setLoop({ ...loop, on: !loop.on })} disabled={loop.b <= loop.a}>{loop.on ? "Loop on" : "Loop off"}</button>
          <button className={btn} onClick={() => setLoop({ a: 0, b: 0, on: false })}>Clear</button></div></>
        : <p className="text-gray-400 text-sm">No song loaded. Go to Home to upload a song or try demo mode.</p>}</section>

    {tab === "home" && <section className="bg-white/5 rounded-2xl p-4 space-y-4">
      <h2 className="font-bold">Analyze a song</h2>
      <input ref={file} type="file" accept="audio/*,video/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <div className="flex flex-wrap gap-2"><button className={hot} onClick={() => file.current?.click()} disabled={!!busy}>Upload audio / video</button><button className={btn} onClick={demo}>Try demo mode</button></div>
      <div className="flex gap-2"><input value={yt} onChange={(e) => setYt(e.target.value)} placeholder="Paste a YouTube or Instagram link (video or Reel), or another audio link. Only content you may use" className="flex-1 bg-black/30 rounded-lg px-3 py-2 text-sm" />
        <button className={btn} disabled={!yt || !!busy} onClick={() => start(fetch("/api/youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: yt }) }))}>Fetch & Detect Notes</button></div>
      {busy && <div><div className="text-sm mb-1">{busy.stage}… {Math.round(busy.progress)}%</div><div className="h-2 bg-white/10 rounded"><div className="h-2 rounded bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${busy.progress}%` }} /></div></div>}
      {err && <div className="text-red-300 bg-red-500/10 rounded p-2 text-sm">{err}</div>}
      <p className="text-xs text-gray-500">Detection tracks the strongest single pitch (pYIN), so it works best on clean lead or solo recordings. Dense mixes and vocals can produce wrong notes. Results always come from analysis of your audio.</p></section>}

    {tab === "guitar" && <section className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={tuning} onChange={(e) => setTuning(e.target.value)} className="bg-black/40 rounded-lg px-2 py-1.5 text-sm">{Object.keys(TUNINGS).map((t) => <option key={t}>{t}</option>)}</select>
        <button className={label === "fret" ? hot : btn} onClick={() => setLabel("fret")}>Fret numbers</button><button className={label === "note" ? hot : btn} onClick={() => setLabel("note")}>Note names</button></div>
      <div className="bg-white/5 rounded-2xl p-3"><Fretboard tun={tun} cur={ci >= 0 ? pos[ci] : null} nxt={ni < notes.length ? pos[ni] : null} curN={cur} nxtN={nxt} label={label} />
        <div className="text-center text-lg mt-2 h-7">{cur ? <b>{cur.name}{cur.octave}{pos[ci] && <span className="text-gray-400 text-sm"> · string {6 - pos[ci]!.s} fret {pos[ci]!.f}</span>}</b> : <span className="text-gray-500 text-sm">Press play</span>}</div></div>
      <div className="bg-white/5 rounded-2xl p-3"><h3 className="font-bold mb-2">Guitar tab</h3>{notes.length ? tabChunks() : <p className="text-sm text-gray-500">{name ? "No clear single-note melody was detected in this song (vocals, drums and chords confuse the detector). Try a clean guitar-only lead or solo." : "Load or analyze a song first."}</p>}</div>
      <div className="bg-white/5 rounded-2xl p-3"><div className="flex items-center justify-between flex-wrap gap-2"><h3 className="font-bold">Detected notes ({notes.length})</h3>{an?.midi?.guitar && url && <a className={btn} href={url.replace(/\/audio$/, "/midi/guitar")} download>Download guitar MIDI</a>}</div>
        <div className="max-h-56 overflow-y-auto grid grid-cols-2 sm:grid-cols-4 gap-1 text-sm">{notes.map((n, i) => <button key={i} onClick={() => seek(n.t)} className={`text-left px-2 py-1 rounded ${i === ci ? "bg-violet-600" : "bg-white/5 hover:bg-white/10"}`}>
          {fmt(n.t)}.{String(Math.round((n.t % 1) * 10))} · {n.name}{n.octave}{pos[i] ? ` (s${6 - pos[i]!.s} f${pos[i]!.f})` : " (out of range)"}</button>)}</div></div></section>}

    {tab === "keys" && <section className="bg-white/5 rounded-2xl p-3 space-y-3"><Keys cur={knotes[kci]} nxt={knotes[kni]} />
      <div className="flex items-center justify-between"><div className="text-center h-7 flex-1">{knotes[kci] ? <b>{knotes[kci].name}{knotes[kci].octave}</b> : <span className="text-gray-500 text-sm">{knotes.length ? "Press play" : (name ? "No separate keyboard/piano part was found in this song." : "Load or analyze a song first.")}</span>}</div>{an?.midi?.keyboard && url && <a className={btn} href={url.replace(/\/audio$/, "/midi/keyboard")} download>Download keyboard MIDI</a>}</div>
      <div className="max-h-48 overflow-y-auto flex flex-wrap gap-1 text-sm">{knotes.map((n, i) => <button key={i} onClick={() => seek(n.t)} className={`px-2 py-1 rounded ${i === kci ? "bg-violet-600" : "bg-white/5"}`}>{n.name}{n.octave}</button>)}</div></section>}

    {tab === "songs" && <section className="bg-white/5 rounded-2xl p-4 space-y-2"><h2 className="font-bold">My Songs</h2>{songs.length === 0 && <p className="text-sm text-gray-500">Nothing saved yet.</p>}
      {songs.map((s) => <div key={s.id} className="flex items-center justify-between bg-black/20 rounded-lg p-2 text-sm"><span>{s.name}{!s.analyzed && " (not analyzed)"}</span>
        <span className="flex gap-2">{s.analyzed && <button className={hot} onClick={() => open(s.id, s.name)}>Open</button>}
          <button className={btn} onClick={async () => { await fetch(`/api/songs/${s.id}`, { method: "DELETE" }); setSongs(songs.filter((x) => x.id !== s.id)); }}>Delete</button></span></div>)}</section>}

    {tab === "settings" && <section className="bg-white/5 rounded-2xl p-4 space-y-3 text-sm"><h2 className="font-bold">Settings</h2>
      <label className="block">Tuning <select value={tuning} onChange={(e) => setTuning(e.target.value)} className="ml-2 bg-black/40 rounded px-2 py-1">{Object.keys(TUNINGS).map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="block">Fretboard labels <select value={label} onChange={(e) => setLabel(e.target.value)} className="ml-2 bg-black/40 rounded px-2 py-1"><option value="fret">Fret numbers</option><option value="note">Note names</option></select></label></section>}
  </div>);
}
