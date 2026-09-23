import { Player } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Clip, type GameApi, type GameInfo, type Job, fmtSeconds } from "./api";
import { go } from "./App";
import { SchemaForm } from "./form";
import type { DeskTemplate as Template } from "../game";
import { loadTemplates } from "./games";
type Format = string;

/**
 * Pick a clip, pick a template, fill the form, watch the real thing in the
 * preview, render the formats you want. Re-open a finished batch here to
 * tweak and re-render it — every format it had comes back ticked.
 */
export const Make: React.FC<{ game: GameInfo; api: GameApi; file?: string; batch?: string }> = ({ game, api, file, batch }) => {
  const FORMATS = game.formats;
  const FPS = game.fps;
  const formatIds = Object.keys(FORMATS);
  const [TEMPLATES, setTemplates] = useState<Template[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [template, setTemplateState] = useState<Template | null>(null);
  const [clipFile, setClipFile] = useState<string | undefined>(file);
  const [props, setProps] = useState<Record<string, unknown>>({});
  const [formats, setFormats] = useState<Format[]>(["vertical"]);
  const [previewFormat, setPreviewFormat] = useState<Format>("vertical");
  const [name, setName] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState("");
  const playerRef = useRef<{ getCurrentFrame: () => number } | null>(null);

  useEffect(() => {
    void api.clips().then(setClips);
    void loadTemplates(game.id).then((ts) => {
      setTemplates(ts);
      if (ts[0]) {
        setTemplateState(ts[0]);
        setProps(ts[0].defaults);
      }
    });
  }, [api, game.id]);
  const clip = clips.find((c) => c.file === clipFile);
  const setTemplate = (t: Template) => setTemplateState(t);

  // What the preview and the render actually get: a blank duration means
  // "to the end of the clip", and any duration is capped at what's left
  // after the start point. The form keeps showing what you typed.
  const effective = useMemo(() => {
    const p: Record<string, unknown> = { ...props };
    const u = template?.uncapped;
    if (u && clip) {
      const start = Math.max(0, Number(p[u.startKey]) || 0);
      const left = Math.max(1, clip.facts.seconds - start);
      const typed = Number(p[u.durationKey]);
      p[u.durationKey] = p[u.durationKey] === undefined || p[u.durationKey] === "" || !Number.isFinite(typed) || typed <= 0 ? left : Math.min(typed, left);
      p[u.startKey] = start;
    }
    return p;
  }, [props, template, clip]);

  // A finished batch re-opened: restore its template + props, and tick every format it had.
  useEffect(() => {
    if (!batch) return;
    if (!TEMPLATES.length) return;
    api.batches().then((bs) => {
      const b = bs.find((x) => x.id === batch);
      const r = b?.renders[0];
      const t = r && TEMPLATES.find((x) => x.id === r.template);
      if (!b || !r || !t) return;
      setTemplate(t);
      setProps(r.props);
      setFormats(b.renders.map((x) => x.format as Format));
      setPreviewFormat(r.format as Format);
      const c = String(r.props[t.clipKey] ?? "");
      setClipFile(c.startsWith("footage/") ? c.slice(8) : undefined);
      setName(b.name);
    });
  }, [batch, TEMPLATES, api]);

  // Switching template or clip seeds the clip-derived props; the rest keeps what you typed where names overlap.
  const chooseTemplate = (t: Template) => {
    setTemplate(t);
    setProps((p) => ({ ...t.defaults, ...pick(p, Object.keys(t.defaults)), ...(clip ? t.clipProps(`footage/${clip.file}`, clip.facts.seconds, clip.facts) : {}) }));
  };
  const chooseClip = (f: string) => {
    setClipFile(f);
    const c = clips.find((x) => x.file === f);
    if (c && template) {
      setProps((p) => ({ ...p, ...template.clipProps(`footage/${c.file}`, c.facts.seconds, c.facts), cropTop: c.cropTop, cropBottom: c.cropBottom, muted: c.muted, ...(c.title && !p.title ? { title: c.title } : {}), ...(c.line && !p.line ? { line: c.line } : {}) }));
      if (!name) setName(c.title || c.file.replace(/\.[^.]+$/, ""));
    }
  };
  useEffect(() => {
    if (file && clips.length && template && !props[template.clipKey]) chooseClip(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, file, template]);

  const seconds = useMemo(() => {
    try {
      const s = template ? template.seconds(effective) : 10;
      return Number.isFinite(s) ? Math.max(1, s) : 10;
    } catch {
      return 10;
    }
  }, [template, effective]);
  const size = FORMATS[previewFormat] ?? FORMATS[formatIds[0]!]!;
  const inputProps = { ...effective, format: previewFormat };

  // Poll jobs while any run.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const j = await api.jobs().catch(() => []);
      if (alive) setJobs(j);
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [api]);

  if (!template) return <div className="muted">loading templates…</div>;

  const render = async () => {
    if (!formats.length) return setMsg("tick at least one format");
    setMsg("");
    try {
      await api.render({ template: template.id, props: effective, formats, name: name || "video" });
      setMsg(`rendering ${formats.length} format${formats.length === 1 ? "" : "s"} — watch the progress below, then find it under Renders`);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    }
  };
  const still = async () => {
    const frame = playerRef.current?.getCurrentFrame() ?? 0;
    setMsg("rendering the still…");
    try {
      const r = await api.still({ template: template.id, props: effective, format: previewFormat, frame, name: name || "still" });
      setMsg(`✔ out/desk/${r.file}`);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <h2>Make a video</h2>
        {clip ? (
          <button className="ghost small" onClick={() => go({ name: "clean", file: clip.file })}>
            Clean this clip up first
          </button>
        ) : null}
      </div>
      <div className="split">
        <div className="stack" style={{ gap: 18 }}>
          <div className="panel stack">
            <div className="field">
              <label>Clip</label>
              <select value={clipFile ?? ""} onChange={(e) => chooseClip(e.target.value)}>
                <option value="">— pick a recording —</option>
                {clips.map((c) => (
                  <option key={c.file} value={c.file}>
                    {c.title ? `${c.title} · ` : ""}
                    {c.file} ({fmtSeconds(c.facts.seconds)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Template</label>
              <select value={template.id} onChange={(e) => chooseTemplate(TEMPLATES.find((t) => t.id === e.target.value)!)}>
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <div className="hint">{template.blurb}</div>
            </div>
          </div>
          <div className="panel stack">
            <h3>Props</h3>
            <SchemaForm schema={template.schema} value={props} onChange={setProps} hide={template.hide} options={template.options} />
            {template.uncapped && clip ? (
              <div className="small muted">
                {props[template.uncapped.durationKey] === undefined || props[template.uncapped.durationKey] === "" ? "No duration set: " : "Duration capped at the clip: "}
                the cut runs {fmtSeconds(Number(effective[template.uncapped.startKey]))} → {fmtSeconds(Number(effective[template.uncapped.startKey]) + Number(effective[template.uncapped.durationKey]))} of {fmtSeconds(clip.facts.seconds)}.
              </div>
            ) : null}
          </div>
          <div className="panel stack">
            <h3>Render</h3>
            <div className="field">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="harpoon-triple" />
            </div>
            <div className="field">
              <label>Formats</label>
              {formatIds.map((f) => (
                <div className="field inline" key={f}>
                  <input type="checkbox" checked={formats.includes(f)} onChange={(e) => setFormats((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))} />
                  <label>
                    {f} <span className="muted small">{FORMATS[f]!.label}</span>
                  </label>
                </div>
              ))}
            </div>
            <div className="row">
              <button disabled={!props[template.clipKey] && template.id === "GameplayClip"} onClick={() => void render()}>
                Render {formats.length > 1 ? `${formats.length} formats` : ""}
              </button>
              <button className="ghost" onClick={() => void still()}>
                Still of this frame
              </button>
              <span className="small muted">{msg}</span>
            </div>
            {jobs.length ? (
              <div className="jobs">
                {jobs.slice(0, 6).map((j) => (
                  <div className="job" key={j.id}>
                    <span className="mono">
                      {j.slug} <span className="muted">{j.state === "failed" ? `✖ ${j.error}` : j.state}</span>
                    </span>
                    <div className="progress">
                      <div style={{ width: `${Math.round(j.progress * 100)}%`, background: j.state === "failed" ? "#a32c22" : undefined }} />
                    </div>
                    <span className="small muted">{j.state === "done" ? <a href="#renders">open</a> : `${Math.round(j.progress * 100)}%`}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="preview">
          <div className="row" style={{ gap: 6 }}>
            {formatIds.map((f) => (
              <button key={f} className={`small ${previewFormat === f ? "" : "ghost"}`} onClick={() => setPreviewFormat(f)}>
                {f}
              </button>
            ))}
            <span className="small muted" style={{ marginLeft: 8 }}>
              {size.width}×{size.height} · {fmtSeconds(seconds)}
            </span>
          </div>
          <div className="frame">
            <Player
              ref={playerRef as never}
              component={template.component}
              inputProps={inputProps}
              durationInFrames={Math.round(seconds * FPS)}
              fps={FPS}
              compositionWidth={size.width}
              compositionHeight={size.height}
              controls
              loop
              style={{ width: previewFormat === "landscape" ? "100%" : previewFormat === "square" ? "min(100%, 560px)" : "min(100%, 400px)", aspectRatio: `${size.width} / ${size.height}` }}
            />
          </div>
          <div className="small muted">This preview runs the exact template code the render uses — what you see is what you get.</div>
        </div>
      </div>
    </div>
  );
};

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
