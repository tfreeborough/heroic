/**
 * The replay (watch the drawing draw itself), the clip out of it, a still,
 * a live recording of the board, and the pile of finished files.
 */
import { type RefObject, useEffect, useRef, useState } from "react";
import { type Element, type FormatId, FORMATS, timeline } from "../lib/scene";
import type { OutFile } from "../lib/store";
import { type Brand, api } from "./api";
import { exportClip, exportStill } from "./exporter";

export type Replay = { time: number; playing: boolean; speed: number; loop: boolean };

type Props = {
  brand: Brand;
  sceneName: string;
  elements: Element[];
  replay: Replay;
  setReplay: (r: Replay | ((r: Replay) => Replay)) => void;
  format: FormatId;
  setFormat: (f: FormatId) => void;
  placeFrame: () => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onClose: () => void;
};

const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

export const ReplayPanel = (p: Props) => {
  const tl = timeline(p.elements);
  const total = tl.total;
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState<string | undefined>();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [outs, setOuts] = useState<OutFile[]>([]);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = () => api.out(p.brand.id).then(setOuts).catch(() => {});
  useEffect(() => { void refresh(); }, [p.brand.id]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setError(undefined);
    setProgress(0);
    try {
      await fn();
      await refresh();
    } catch (e) {
      if ((e as Error).message !== "stopped") setError((e as Error).message);
    } finally {
      setBusy(undefined);
      abort.current = null;
    }
  };

  const doExport = () => run("Exporting clip", () => {
    abort.current = new AbortController();
    return exportClip({ game: p.brand.id, name: p.sceneName, elements: p.elements, format: p.format, fps: 30, transparent, background: p.brand.background, speed: p.replay.speed, signal: abort.current.signal, onProgress: (d, t) => setProgress(d / t) });
  });
  const doStill = () => run("Saving still", () => exportStill({ game: p.brand.id, name: p.sceneName, elements: p.elements, format: p.format, transparent, background: p.brand.background }));

  const toggleRecord = () => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    const c = p.canvasRef.current;
    if (!c) return;
    const stream = c.captureStream(60);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      setRecording(false);
      stream.getTracks().forEach((t) => t.stop());
      void run("Saving recording", async () => (await api.recording(p.brand.id, p.sceneName, new Blob(chunks, { type: "video/webm" }))).file);
    };
    rec.start(500);
    recorder.current = rec;
    setRecording(true);
  };

  const send = (f: OutFile) => run("Sending to the Desk", async () => { await api.sendToDesk(p.brand.id, f.file); return f.file; });
  const remove = (f: OutFile) => run("Deleting", async () => { await api.deleteOut(p.brand.id, f.file); return f.file; });

  return (
    <div className="replay">
      <div className="row between">
        <h3>Replay</h3>
        <button className="ghost small" onClick={p.onClose}>Close</button>
      </div>
      {total === 0 ? <p className="muted small">Nothing drawn yet.</p> : (
        <>
          <div className="row">
            <button className="small" onClick={() => p.setReplay((r) => ({ ...r, playing: !r.playing, time: r.time >= total && !r.playing ? 0 : r.time }))}>{p.replay.playing ? "Pause" : "Play"} <small>K</small></button>
            <button className="ghost small" onClick={() => p.setReplay((r) => ({ ...r, time: 0, playing: false }))}>⏮</button>
            <span className="mono">{fmtTime(Math.min(p.replay.time, total))} / {fmtTime(total)}</span>
          </div>
          <input type="range" min={0} max={total} step={16} value={Math.min(p.replay.time, total)} onChange={(e) => p.setReplay((r) => ({ ...r, time: Number(e.target.value), playing: false }))} />
          <div className="row">
            <label className="small muted">Speed</label>
            <div className="seg">
              {[0.5, 1, 1.5, 2, 3].map((s) => <button key={s} className={p.replay.speed === s ? "on" : ""} onClick={() => p.setReplay((r) => ({ ...r, speed: s }))}>{s}×</button>)}
            </div>
            <label className="small muted row"><input type="checkbox" checked={p.replay.loop} onChange={(e) => p.setReplay((r) => ({ ...r, loop: e.target.checked }))} /> loop</label>
          </div>
        </>
      )}

      <h3>Clip</h3>
      <div className="row">
        <select value={p.format} onChange={(e) => p.setFormat(e.target.value as FormatId)}>
          {(Object.keys(FORMATS) as FormatId[]).map((f) => <option key={f} value={f}>{FORMATS[f].label}</option>)}
        </select>
        <button className="ghost small" title="Put a frame on the board: the clip shows what's inside it. Without one, the clip fits the whole drawing." onClick={p.placeFrame}>Place frame <small>F</small></button>
      </div>
      <label className="small row"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> transparent background (a .mov with alpha, to lay over footage)</label>
      <div className="row">
        <button disabled={!!busy || total === 0} onClick={doExport}>Export clip</button>
        <button className="ghost" disabled={!!busy} onClick={doStill}>Save a still</button>
        <button className={recording ? "danger" : "ghost"} disabled={!!busy && !recording} onClick={toggleRecord} title="Record the board live as you draw (the canvas only, no panels)">{recording ? "■ Stop recording" : "● Record live"}</button>
      </div>
      <p className="muted small">Clip = the replay at {p.replay.speed}× over {fmtTime(total / p.replay.speed)}, 30 fps, {FORMATS[p.format].w}×{FORMATS[p.format].h}. Change the speed above to change the clip.</p>
      {busy && (
        <div className="stack">
          <div className="row between"><span className="small">{busy}…</span>{abort.current && <button className="ghost small" onClick={() => abort.current?.abort()}>Stop</button>}</div>
          <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>
        </div>
      )}
      {error && <p className="warn small">{error}</p>}

      {outs.length > 0 && (
        <>
          <h3>Made</h3>
          <div className="outs">
            {outs.map((f) => (
              <div key={f.file} className="out">
                {f.kind === "still" ? <img src={`/out/${p.brand.id}/${encodeURIComponent(f.file)}`} alt="" /> : <video src={`/out/${p.brand.id}/${encodeURIComponent(f.file)}`} muted loop playsInline onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />}
                <div className="body">
                  <div className="title" title={f.file}>{f.file}</div>
                  <div className="muted small">{f.kind} · {fmtBytes(f.bytes)}</div>
                  <div className="actions">
                    <a className="small" href={`/out/${p.brand.id}/${encodeURIComponent(f.file)}`} download>Download</a>
                    {p.brand.desk && f.kind !== "still" && <button className="ghost small" disabled={!!busy} onClick={() => send(f)}>To the Desk</button>}
                    <button className="danger small" disabled={!!busy} onClick={() => remove(f)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
