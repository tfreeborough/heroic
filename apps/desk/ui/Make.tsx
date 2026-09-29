import { Player } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Batch, type Clip, type GameApi, type GameInfo, type Job, type VoiceSummary, fmtDate, fmtSeconds } from "./api";
import { editOf, go } from "./App";
import { ClipPicker } from "./ClipPicker";
import { SchemaForm, VariantList, listOf } from "./form";
import type { DeskTemplate as Template } from "../game";
import { loadTemplates } from "./games";
import { TikTokOverlay } from "./TikTokOverlay";
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
  const [batches, setBatches] = useState<Batch[]>([]);
  const [voices, setVoices] = useState<VoiceSummary[]>([]);
  const [picking, setPicking] = useState(false);
  const [template, setTemplateState] = useState<Template | null>(null);
  const [clipFile, setClipFile] = useState<string | undefined>(file);
  const [props, setProps] = useState<Record<string, unknown>>({});
  const [formats, setFormats] = useState<Format[]>(formatIds);
  const [previewFormat, setPreviewFormat] = useState<Format>("vertical");
  const [variant, setVariant] = useState(0);
  const [name, setName] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [msg, setMsg] = useState("");
  const playerRef = useRef<{ getCurrentFrame: () => number } | null>(null);

  useEffect(() => {
    void api.clips().then(setClips);
    void api.batches().then(setBatches);
    void api.voices().then(setVoices).catch(() => {});
    void loadTemplates(game.id).then((ts) => {
      setTemplates(ts);
      if (ts[0]) {
        setTemplateState(ts[0]);
        setProps(ts[0].defaults);
      }
    });
  }, [api, game.id]);
  const clip = clips.find((c) => c.file === clipFile);
  // Which clips a render has used, and how many batches: any prop pointing into footage/ counts.
  const renderedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of batches) {
      const used = new Set(b.renders.flatMap((r) => Object.values(r.props)).filter((v): v is string => typeof v === "string" && v.startsWith("footage/")));
      for (const f of used) m.set(f.slice(8), (m.get(f.slice(8)) ?? 0) + 1);
    }
    return m;
  }, [batches]);
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
      // A clip you've voiced brings its voice-over with it (the newest, if there are several).
      const spoken = template.voice ? { voice: voices.find((v) => v.clip === c.file && v.pieces > 0)?.path ?? "" } : {};
      setProps((p) => ({ ...p, ...template.clipProps(`footage/${c.file}`, c.facts.seconds, c.facts), cropTop: c.cropTop, cropBottom: c.cropBottom, muted: c.muted, ...(c.title && !p.title ? { title: c.title } : {}), ...(c.line && !p.line ? { line: c.line } : {}), ...spoken }));
      if (!name) setName(c.title || c.file.replace(/\.[^.]+$/, ""));
    }
  };
  useEffect(() => {
    if (file && clips.length && template && !props[template.clipKey]) chooseClip(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, file, template]);

  // A template with variants: the form keeps a list of alternatives (blank
  // rows are ones still being typed). The preview shows the chosen one; a
  // render makes a batch for each, and every render gets a single string.
  const rows = template?.variants ? listOf(props[template.variants.key]) : [];
  const variants = useMemo(() => rows.map((r) => r.trim()).filter(Boolean), [rows.join("\n")]);
  const withVariant = (p: Record<string, unknown>, i: number): Record<string, unknown> => {
    const v = template?.variants;
    return v ? { ...p, [v.key]: variants[i] ?? "" } : p;
  };
  // Typing in a row shows that hook in the preview.
  const focusRow = (i: number) => {
    if (rows[i]?.trim()) setVariant(rows.slice(0, i).filter((r) => r.trim()).length);
  };

  // The voice-overs recorded over this clip, as the `voice` field's choices.
  const voiceOptions = useMemo(() => voices.filter((v) => v.clip === clipFile && v.pieces > 0).map((v) => ({ value: v.path, label: `${v.id} (${fmtSeconds(v.seconds)})` })), [voices, clipFile]);
  // Voices load after the clip when the screen opens on one (Clips → Make): pick it up then.
  useEffect(() => {
    if (!template?.voice || batch || !voiceOptions.length) return;
    setProps((p) => (p.voice ? p : { ...p, voice: voiceOptions[0]!.value }));
  }, [voiceOptions, template, batch]);

  const seconds = useMemo(() => {
    try {
      const s = template ? template.seconds(withVariant(effective, 0)) : 10;
      return Number.isFinite(s) ? Math.max(1, s) : 10;
    } catch {
      return 10;
    }
  }, [template, effective]);
  const size = FORMATS[previewFormat] ?? FORMATS[formatIds[0]!]!;
  const inputProps = { ...withVariant(effective, Math.min(variant, Math.max(0, variants.length - 1))), format: previewFormat };

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

  // A render finishing moves its clip out of the picker's "not rendered" list.
  const doneJobs = jobs.filter((j) => j.state === "done").length;
  useEffect(() => void api.batches().then(setBatches), [api, doneJobs]);

  if (!template) return <div className="muted">loading templates…</div>;

  const render = async () => {
    if (!formats.length) return setMsg("tick at least one format");
    setMsg("");
    try {
      if (template.variants && variants.length > 1) {
        // One batch per alternative, so each lands in the library as its own card.
        for (let i = 0; i < variants.length; i++) {
          await api.render({ template: template.id, props: withVariant(effective, i), formats, name: `${name || "video"}-${template.variants.suffix}${i + 1}` });
        }
        setMsg(`rendering ${variants.length} ${template.variants.suffix} variants × ${formats.length} format${formats.length === 1 ? "" : "s"} — watch the progress below, then find them under Renders`);
      } else {
        await api.render({ template: template.id, props: withVariant(effective, 0), formats, name: name || "video" });
        setMsg(`rendering ${formats.length} format${formats.length === 1 ? "" : "s"} — watch the progress below, then find it under Renders`);
      }
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    }
  };
  const still = async () => {
    const frame = playerRef.current?.getCurrentFrame() ?? 0;
    setMsg("rendering the still…");
    try {
      const r = await api.still({ template: template.id, props: withVariant(effective, variant), format: previewFormat, frame, name: name || "still" });
      setMsg(`✔ out/desk/${r.file}`);
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      {picking ? (
        <ClipPicker
          api={api}
          clips={clips}
          renderedCount={renderedCount}
          current={clipFile}
          onPick={(f) => {
            chooseClip(f);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
      <div className="row between">
        <h2>Make a video</h2>
        {clip ? (
          <button className="ghost small" onClick={() => go(editOf(clip, clips))}>
            Edit this clip first
          </button>
        ) : null}
      </div>
      <div className="split">
        <div className="stack" style={{ gap: 18 }}>
          <div className="panel stack">
            <div className="field">
              <label>Clip</label>
              {clip ? (
                <div className="clip-chosen">
                  <img src={api.clipThumb(clip.file, Math.min(clip.facts.seconds * 0.3, 8))} alt="" />
                  <div className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                    <strong>{clip.title || clip.file.replace(/\.[^.]+$/, "")}</strong>
                    <span className="small muted mono">{clip.file}</span>
                    <span className="small muted">
                      {fmtSeconds(clip.facts.seconds)} · {fmtDate(clip.facts.recordedAt)}
                      {renderedCount.has(clip.file) ? " · already rendered" : ""}
                    </span>
                  </div>
                  <button className="ghost small" onClick={() => setPicking(true)}>
                    Change…
                  </button>
                </div>
              ) : (
                <button className="ghost" onClick={() => setPicking(true)}>
                  Pick a clip…
                </button>
              )}
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
            {template.variants ? (
              <VariantList
                label={`${template.variants.suffix}s`}
                rows={rows}
                placeholder={template.variants.placeholder}
                onChange={(next) => setProps((p) => ({ ...p, [template.variants!.key]: next }))}
                onFocusRow={focusRow}
              />
            ) : null}
            <SchemaForm schema={template.schema} value={props} onChange={setProps} hide={[...(template.hide ?? []), ...(template.variants ? [template.variants.key] : [])]} options={template.voice ? { ...template.options, voice: voiceOptions } : template.options} />
            {template.voice && clip ? (
              <div className="small muted">
                {voiceOptions.length ? (props.voice ? "This clip's voice-over is on. " : "This clip has a voice-over: pick it under voice. ") : "No voice-over for this clip yet. "}
                <button className="link small" onClick={() => go(editOf(clip, clips))}>
                  {voiceOptions.length ? "Edit it in the editor" : "Record one in the editor"}
                </button>
              </div>
            ) : null}
            {template.uncapped && clip ? (
              <div className="small muted">
                {props[template.uncapped.durationKey] === undefined || props[template.uncapped.durationKey] === "" ? "No duration set: " : "Duration capped at the clip: "}
                the cut runs {fmtSeconds(Number(effective[template.uncapped.startKey]))} → {fmtSeconds(Number(effective[template.uncapped.startKey]) + Number(effective[template.uncapped.durationKey]))} of {fmtSeconds(clip.facts.seconds)}.
              </div>
            ) : null}
            {template.warn?.(effective, props) ? <div className="small warn">{template.warn(effective, props)}</div> : null}
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
              <button disabled={!props[template.clipKey] && template.needsClip} onClick={() => void render()}>
                Render {variants.length > 1 ? `${variants.length} ${template.variants!.suffix}s` : ""}
                {formats.length > 1 ? ` ${variants.length > 1 ? "×" : ""} ${formats.length} formats` : ""}
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
          {variants.length > 1 ? (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="small muted">{template.variants!.suffix}</span>
              {variants.map((v, i) => (
                <button key={i} className={`small ${Math.min(variant, variants.length - 1) === i ? "" : "ghost"}`} title={v} onClick={() => setVariant(i)}>
                  {i + 1}
                </button>
              ))}
              <span className="small muted">{variants[Math.min(variant, variants.length - 1)]}</span>
            </div>
          ) : null}
          <div className="frame">
            <div style={{ position: "relative", width: previewFormat === "landscape" ? "100%" : previewFormat === "square" ? "min(100%, 560px)" : "min(100%, 400px)", containerType: "inline-size" }}>
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
                style={{ width: "100%", aspectRatio: `${size.width} / ${size.height}` }}
              />
              {previewFormat === "vertical" ? <TikTokOverlay /> : null}
            </div>
          </div>
          <div className="small muted">
            This preview runs the exact template code the render uses — what you see is what you get.
            {previewFormat === "vertical" ? " The TikTok UI on top is preview only; it never goes into the render." : ""}
          </div>
        </div>
      </div>
    </div>
  );
};

const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
