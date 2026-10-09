import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Rect, bounds, union } from "../lib/geometry";
import { type Element, type FormatId, type Scene, type Style, type TextEl, DEFAULT_STYLE, FORMATS, isContent, seed, timeline, uid } from "../lib/scene";
import type { Stamp } from "../lib/stamps";
import type { SceneSummary } from "../lib/store";
import { type Brand, api } from "./api";
import { type Editing, type PendingStamp, type Tool, Board } from "./Board";
import { type Replay, ReplayPanel } from "./ReplayPanel";
import { StampDrawer } from "./StampDrawer";
import { StylePanel } from "./StylePanel";
import { Toolbar } from "./Toolbar";
import { loadFonts } from "./fonts";
import { History } from "./history";
import { type Camera, cameraFor, measureText } from "./render";

const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", p: "pen", r: "rect", o: "ellipse", d: "diamond", a: "arrow", l: "line", t: "text", f: "frame", e: "eraser" };
const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

export const App = () => {
  const [brand, setBrand] = useState<Brand>();
  const [fontsReady, setFontsReady] = useState(false);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [scene, setScene] = useState<Scene>();
  const elementsRef = useRef<Element[]>([]);
  const history = useRef(new History());
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [tool, setToolRaw] = useState<Tool>("select");
  // The tool stays after each draw (Tom: flicking back to select was annoying). Q turns that off.
  const [toolLocked, setToolLocked] = useState(true);
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [pendingStamp, setPendingStamp] = useState<PendingStamp>();
  const [frameFormat, setFrameFormat] = useState<FormatId>("vertical");
  const [present, setPresent] = useState(false);
  const [grid, setGrid] = useState(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [drawer, setDrawer] = useState<"stamps" | "replay" | null>(null);
  const [replay, setReplay] = useState<Replay>({ time: 0, playing: false, speed: 1, loop: false });
  const [saved, setSaved] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [error, setError] = useState<string>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardSize = () => ({ w: window.innerWidth, h: window.innerHeight });

  // ---- boot --------------------------------------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const games = await api.games();
        const g = games[0];
        if (!g) throw new Error("no games registered (games.ts)");
        setBrand(g);
        void loadFonts(g.id).then(() => setFontsReady(true));
        api.stamps(g.id).then(setStamps).catch(() => {});
        const list = await api.scenes(g.id);
        setScenes(list);
        const last = localStorage.getItem(`sand:${g.id}:scene`);
        const name = (last && list.some((s) => s.name === last) ? last : list[0]?.name) ?? "untitled";
        await open(g.id, name, list.length === 0);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const open = async (game: string, name: string, create = false) => {
    const s = create ? await api.createScene(game, name) : await api.scene(game, name);
    elementsRef.current = s.elements;
    history.current.clear();
    setScene(s);
    setCamera(s.camera ?? { x: 0, y: 0, zoom: 1 });
    setSelection(new Set());
    setEditing(null);
    setReplay((r) => ({ ...r, time: 0, playing: false }));
    localStorage.setItem(`sand:${game}:scene`, s.name);
    setScenes(await api.scenes(game));
  };

  // ---- elements + undo ---------------------------------------------------
  const update = useCallback((fn: (els: Element[]) => Element[]) => {
    const next = fn(elementsRef.current);
    elementsRef.current = next;
    setScene((s) => (s ? { ...s, elements: next } : s));
    setSaved("dirty");
  }, []);
  const current = useCallback(() => elementsRef.current, []);
  const commit = useCallback((before: Element[]) => {
    if (before !== elementsRef.current) history.current.push(before);
  }, []);
  const change = (fn: (els: Element[]) => Element[]) => {
    const before = elementsRef.current;
    update(fn);
    commit(before);
  };
  const undo = () => {
    const prev = history.current.undo(elementsRef.current);
    if (prev) { elementsRef.current = prev; setScene((s) => (s ? { ...s, elements: prev } : s)); setSaved("dirty"); setSelection(new Set()); }
  };
  const redo = () => {
    const next = history.current.redo(elementsRef.current);
    if (next) { elementsRef.current = next; setScene((s) => (s ? { ...s, elements: next } : s)); setSaved("dirty"); setSelection(new Set()); }
  };

  // ---- autosave ----------------------------------------------------------
  useEffect(() => {
    if (!scene || !brand || saved !== "dirty") return;
    const t = setTimeout(async () => {
      setSaved("saving");
      try {
        await api.saveScene(brand.id, { ...scene, elements: elementsRef.current, camera });
        setSaved((s) => (s === "saving" ? "saved" : s));
      } catch (e) {
        setSaved("error");
        setError((e as Error).message);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [scene, saved, brand, camera]);
  useEffect(() => { setSaved((s) => (s === "saved" ? "dirty" : s)); }, [camera]);

  // ---- selection helpers -------------------------------------------------
  const elements = scene?.elements ?? [];
  const selected = useMemo(() => elements.filter((e) => selection.has(e.id)), [elements, selection]);
  const setTool = (t: Tool) => {
    setToolRaw(t);
    if (t !== "stamp") setPendingStamp(undefined);
    if (t !== "select") setEditing(null);
  };

  const applyStyle = (patch: Partial<Style>) => {
    setStyle((s) => ({ ...s, ...patch }));
    if (editing) setEditing({ ...editing, el: remeasure({ ...editing.el, ...patch }) });
    if (!selection.size) return;
    change((els) => els.map((el) => (selection.has(el.id) ? (el.type === "text" ? remeasure({ ...el, ...patch }) : ({ ...el, ...patch } as Element)) : el)));
  };
  const remeasure = (el: TextEl): TextEl => ({ ...el, ...measureText(el.text, el.font, el.fontSize) });

  const deleteSelected = () => {
    if (!selection.size) return;
    change((els) => els.filter((e) => !selection.has(e.id)));
    setSelection(new Set());
  };
  const duplicate = () => {
    if (!selection.size) return;
    const ids = new Set<string>();
    change((els) => [...els, ...els.filter((e) => selection.has(e.id) && e.type !== "frame").map((e) => {
      const id = uid();
      ids.add(id);
      return { ...e, id, x: e.x + 24, y: e.y + 24, seed: seed(), t: Date.now() } as Element;
    })]);
    setSelection(ids);
  };
  const nudge = (dx: number, dy: number) => {
    if (!selection.size) return;
    change((els) => els.map((e) => (selection.has(e.id) ? { ...e, x: e.x + dx, y: e.y + dy } : e)));
  };
  const layer = (dir: "up" | "down" | "top" | "bottom") => {
    if (!selection.size) return;
    change((els) => {
      const sel = els.filter((e) => selection.has(e.id));
      const rest = els.filter((e) => !selection.has(e.id));
      if (dir === "top") return [...rest, ...sel];
      if (dir === "bottom") return [...sel, ...rest];
      const out = els.slice();
      const idx = out.map((e, i) => (selection.has(e.id) ? i : -1)).filter((i) => i >= 0);
      if (dir === "up") for (const i of idx.reverse()) if (i < out.length - 1 && !selection.has(out[i + 1]!.id)) [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
      if (dir === "down") for (const i of idx) if (i > 0 && !selection.has(out[i - 1]!.id)) [out[i], out[i - 1]] = [out[i - 1]!, out[i]!];
      return out;
    });
  };
  const restamp = () => {
    if (!selection.size) return;
    const now = Date.now();
    change((els) => els.map((e, i) => (selection.has(e.id) ? { ...e, t: now + i } : e)));
  };

  const placeFrame = () => {
    const { w, h } = boardSize();
    const f = FORMATS[frameFormat];
    const aspect = f.w / f.h;
    const fh = Math.min(h, w / aspect) * 0.8 / camera.zoom, fw = fh * aspect;
    const el: Element = { ...style, id: uid(), seed: seed(), t: 0, dur: 0, type: "frame", format: frameFormat, w: fw, h: fh, x: camera.x + w / camera.zoom / 2 - fw / 2, y: camera.y + h / camera.zoom / 2 - fh / 2 };
    change((els) => {
      const had = els.find((e) => e.type === "frame");
      // Keep an existing frame where it is; just re-shape it to the format.
      const placed = had ? { ...el, x: had.x, y: had.y, w: (had as { w: number }).w, h: (had as { w: number }).w / aspect } : el;
      return [...els.filter((e) => e.type !== "frame"), placed];
    });
    setSelection(new Set([el.id]));
  };
  const setFormat = (f: FormatId) => {
    setFrameFormat(f);
    const aspect = FORMATS[f].w / FORMATS[f].h;
    if (elements.some((e) => e.type === "frame")) change((els) => els.map((e) => (e.type === "frame" ? { ...e, format: f, h: e.w / aspect } : e)));
  };

  const zoomTo = (zoom: number, about?: [number, number]) => {
    const { w, h } = boardSize();
    const [sx, sy] = about ?? [w / 2, h / 2];
    setCamera((cam) => {
      const z = Math.min(8, Math.max(0.1, zoom));
      const wx = sx / cam.zoom + cam.x, wy = sy / cam.zoom + cam.y;
      return { zoom: z, x: wx - sx / z, y: wy - sy / z };
    });
  };
  const zoomToFit = () => {
    const r: Rect | undefined = union(elements.filter(isContent).map(bounds));
    const { w, h } = boardSize();
    setCamera(r && r.w > 0 && r.h > 0 ? cameraFor(r, w, h) : { x: 0, y: 0, zoom: 1 });
  };

  // ---- the replay clock ----------------------------------------------------
  const tl = useMemo(() => timeline(elements), [elements]);
  useEffect(() => {
    if (!replay.playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) * replay.speed;
      last = now;
      setReplay((r) => {
        const t = r.time + dt;
        if (t >= tl.total) return r.loop ? { ...r, time: 0 } : { ...r, time: tl.total, playing: false };
        return { ...r, time: t };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replay.playing, replay.speed, replay.loop, tl.total]);
  const replaying = drawer === "replay";

  // ---- keys --------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || editing) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod && k === "a") { e.preventDefault(); setSelection(new Set(elements.map((x) => x.id))); return; }
      if (mod && k === "d") { e.preventDefault(); duplicate(); return; }
      if (mod && k === "s") { e.preventDefault(); setSaved("dirty"); return; }
      if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomTo(camera.zoom * 1.2); return; }
      if (mod && k === "-") { e.preventDefault(); zoomTo(camera.zoom / 1.2); return; }
      if (mod && k === "0") { e.preventDefault(); zoomTo(1); return; }
      if (mod) return;
      if (e.key === "Tab") { e.preventDefault(); setPresent((p) => !p); return; }
      if (e.key === "Escape") {
        if (drawer) setDrawer(null);
        else if (tool !== "select") setTool("select");
        else setSelection(new Set());
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); deleteSelected(); return; }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
        return;
      }
      if (e.key === "Enter" && selected.length === 1 && selected[0]!.type === "text") { setEditing({ el: selected[0] as TextEl, isNew: false }); return; }
      if (k === "k") { setDrawer("replay"); setReplay((r) => ({ ...r, playing: !r.playing, time: r.time >= tl.total && !r.playing ? 0 : r.time })); return; }
      if (k === "s") { setDrawer((d) => (d === "stamps" ? null : "stamps")); return; }
      if (k === "g") { setGrid((g) => !g); return; }
      if (k === "q") { setToolLocked((l) => !l); return; }
      if (k === "[") { layer("down"); return; }
      if (k === "]") { layer("up"); return; }
      if (e.shiftKey && e.key === "!") { zoomToFit(); return; }
      if (k === "1" && e.shiftKey) { zoomToFit(); return; }
      const t = TOOL_KEYS[k];
      if (t) setTool(t);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => { document.body.classList.toggle("present", present); }, [present]);

  // ---- scenes bar ----------------------------------------------------------
  const newScene = async () => {
    if (!brand) return;
    const name = prompt("Name the scene", "")?.trim();
    if (!name) return;
    try { await open(brand.id, name, true); } catch (e) { setError((e as Error).message); }
  };
  const renameScene = async () => {
    if (!brand || !scene) return;
    const to = prompt("Rename the scene", scene.name)?.trim();
    if (!to || to === scene.name) return;
    try {
      const s = await api.renameScene(brand.id, scene.name, to);
      setScene((x) => (x ? { ...x, name: s.name } : x));
      localStorage.setItem(`sand:${brand.id}:scene`, s.name);
      setScenes(await api.scenes(brand.id));
    } catch (e) { setError((e as Error).message); }
  };
  const deleteScene = async () => {
    if (!brand || !scene) return;
    if (!confirm(`Delete the scene "${scene.name}"? There's no undo for this.`)) return;
    await api.deleteScene(brand.id, scene.name);
    const list = await api.scenes(brand.id);
    setScenes(list);
    await open(brand.id, list[0]?.name ?? "untitled", list.length === 0);
  };

  if (error && !scene) return <div className="page"><p className="warn">{error}</p></div>;
  if (!brand || !scene || !fontsReady) return <div className="page muted">Setting the table…</div>;

  const styleable = selected.filter((e) => e.type !== "frame");
  const showStyle = !present && (styleable.length > 0 || (tool !== "select" && tool !== "hand" && tool !== "eraser" && tool !== "frame"));

  return (
    <>
      <Board
        elements={elements} update={update} current={current} commit={commit}
        selection={selection} setSelection={setSelection}
        tool={tool} setTool={setTool} toolLocked={toolLocked}
        style={style} camera={camera} setCamera={setCamera}
        pendingStamp={pendingStamp} onStampPlaced={() => setPendingStamp(undefined)}
        frameFormat={frameFormat}
        replayTime={replaying ? replay.time : undefined} timeline={tl}
        present={present} grid={grid} background={brand.background}
        canvasRef={canvasRef} editing={editing} setEditing={setEditing}
      />
      <div className="top chrome">
        <div className="brand"><img src={`/game-icon/${brand.id}`} alt="" /> The Sand Table</div>
        <select value={scene.name} onChange={(e) => void open(brand.id, e.target.value)}>
          {scenes.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          {!scenes.some((s) => s.name === scene.name) && <option value={scene.name}>{scene.name}</option>}
        </select>
        <button className="ghost small" onClick={newScene}>New</button>
        <button className="ghost small" onClick={renameScene}>Rename</button>
        <button className="danger small" onClick={deleteScene}>Delete</button>
        <span className={`muted small ${saved}`}>{saved === "saved" ? "saved" : saved === "saving" ? "saving…" : saved === "error" ? "not saved" : "·"}</span>
        <div className="right">
          <button className={`ghost small ${drawer === "replay" ? "on" : ""}`} onClick={() => setDrawer((d) => (d === "replay" ? null : "replay"))}>Replay & clip <small>K</small></button>
          <button className="ghost small" onClick={() => setPresent(true)} title="Hide everything but the board, for a screen recording. Tab brings it back.">Present <small>Tab</small></button>
        </div>
      </div>
      <div className="chrome toolbar-wrap"><Toolbar tool={tool} setTool={setTool} locked={toolLocked} setLocked={setToolLocked} stampsOpen={drawer === "stamps"} toggleStamps={() => setDrawer((d) => (d === "stamps" ? null : "stamps"))} /></div>
      {showStyle && <div className="chrome panel left"><StylePanel brand={brand} style={style} apply={applyStyle} selected={styleable} onDelete={deleteSelected} onDuplicate={duplicate} onLayer={layer} onRestamp={restamp} /></div>}
      {drawer === "stamps" && !present && (
        <div className="chrome panel left wide">
          <StampDrawer brand={brand} stamps={stamps} pending={pendingStamp} stroke={style.stroke} pick={(s) => { setPendingStamp(s); setToolRaw("stamp"); }} />
        </div>
      )}
      {drawer === "replay" && (
        <div className="chrome panel right">
          <ReplayPanel brand={brand} sceneName={scene.name} elements={elements} replay={replay} setReplay={setReplay} format={frameFormat} setFormat={setFormat} placeFrame={placeFrame} canvasRef={canvasRef} onClose={() => { setDrawer(null); setReplay((r) => ({ ...r, playing: false })); }} />
        </div>
      )}
      <div className="chrome zoom">
        <button className="ghost small" onClick={() => zoomTo(camera.zoom / 1.2)}>−</button>
        <button className="ghost small mono" title="Reset (⌘0) · fit (⇧1)" onClick={() => zoomTo(1)}>{Math.round(camera.zoom * 100)}%</button>
        <button className="ghost small" onClick={() => zoomTo(camera.zoom * 1.2)}>+</button>
        <button className="ghost small" onClick={zoomToFit}>Fit</button>
        <button className={`ghost small ${grid ? "on" : ""}`} onClick={() => setGrid((g) => !g)}>Grid <small>G</small></button>
      </div>
      {error && <div className="chrome toast warn" onClick={() => setError(undefined)}>{error}</div>}
      {present && <div className="present-hint">Tab brings the panels back · K plays the replay</div>}
    </>
  );
};
