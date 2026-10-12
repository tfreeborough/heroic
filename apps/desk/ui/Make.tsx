import { Player } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Batch, type Clip, type GameApi, type GameInfo, type Job, type ScriptSummary, type VoiceSummary, asClips, clipPath, fmtDate, fmtSeconds, thumbOf } from "./api";
import { editOf, go } from "./App";
import { ClipPicker } from "./ClipPicker";
import { SchemaForm, VariantList, freshDefaults, listOf, takePreset } from "./form";
import type { DeskTemplate as Template } from "../game";
import { loadTemplates } from "./games";
import { GAMES } from "../games";
import { TikTokOverlay } from "./TikTokOverlay";
import { Gallery } from "./Gallery";
type Format = string;

/**
 * Pick a clip, pick a template, fill the form, watch the real thing in the
 * preview, render the formats you want. Re-open a finished batch here to
 * tweak and re-render it — every format it had comes back ticked.
 */
export const Make: React.FC<{ game: GameInfo; api: GameApi; file?: string; batch?: string }> = ({ game, api, file, batch }) => {
  // A channel without footage (Autosave) has no clips to pick or timelines to start.
  const noFootage = GAMES.find((g) => g.id === game.id)?.hideTabs?.includes("clips") ?? false;
  const FORMATS = game.formats;
  const FPS = game.fps;
  const formatIds = Object.keys(FORMATS);
  const [TEMPLATES, setTemplates] = useState<Template[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [voices, setVoices] = useState<VoiceSummary[]>([]);
  // The scripts, so an edit made from one says which (and can be ticked off from here once it's rendered).
  const [ideas, setIdeas] = useState<ScriptSummary[]>([]);
  const [picking, setPicking] = useState(false);
  const [starting, setStarting] = useState(false);
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
    // Edits first: they're what you'd most likely make a video from.
    void Promise.all([api.sequences().catch(() => []), api.clips()]).then(([edits, recs]) => setClips([...asClips(api, game, edits), ...recs]));
    void api.batches().then(setBatches);
    void api.voices().then(setVoices).catch(() => {});
    void api.scripts().then((r) => setIdeas(r.list)).catch(() => {});
    void loadTemplates(game.id).then((ts) => {
      setTemplates(ts);
      if (ts[0]) {
        setTemplateState(ts[0]);
        setProps({ ...freshDefaults(ts[0]), ...takePreset(game.id) });
        if (!batch) freshFrom(ts[0]);
      }
    });
  }, [api, game.id]);
  const clip = clips.find((c) => c.file === clipFile);
  const idea = clip?.idea ? ideas.find((i) => i.id === clip.idea) : undefined;
  // A gallery field's values some render has used (they move to its Made tab).
  const madeValues = useMemo(() => {
    const key = template?.gallery?.key;
    return new Set(key ? batches.filter((b) => b.template === template!.id).flatMap((b) => b.renders.map((r) => String(r.props[key] ?? ""))) : []);
  }, [batches, template]);
  // A fresh form starts on something not made yet (a reopened batch keeps its own).
  useEffect(() => {
    const g = template?.gallery;
    if (!g || batch || !madeValues.has(String(props[g.key] ?? ""))) return;
    const next = g.items.find((i) => !madeValues.has(i.value));
    if (next) setProps((p) => ({ ...p, [g.key]: next.value, ...template!.linked?.(g.key, next.value) }));
  }, [madeValues, template]);
  // Which clips a render has used, and how many batches: any prop pointing into the footage or at an edit counts.
  const renderedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of batches) {
      const used = new Set(b.renders.flatMap((r) => Object.values(r.props)).flatMap((v) => (typeof v === "string" ? [fileOfPath(v)].filter((x): x is string => Boolean(x)) : [])));
      for (const f of used) m.set(f, (m.get(f) ?? 0) + 1);
    }
    return m;
  }, [batches]);
  const setTemplate = (t: Template) => setTemplateState(t);
  /** A template's server-side fresh props (Autosave's next hints) land over the form when they come. */
  function freshFrom(t: Template) {
    void t.fresh?.().then((f) => setProps((p) => ({ ...p, ...f }))).catch(() => {});
  }
  /** A clip prop → the library entry it names: a recording's file, or `seq:<id>` for an edit. */
  function fileOfPath(v: string): string | undefined {
    if (v.startsWith(`${game.footagePublic}/`)) return v.slice(game.footagePublic.length + 1);
    const edit = /^sequences\/(.+)\.json$/.exec(v)?.[1];
    return edit ? `seq:${edit}` : undefined;
  }
  /** Where a library entry is edited. */
  const editRoute = (c: Clip) => (c.path ? { name: "edit" as const, id: c.file.slice(4) } : editOf(c, clips));
  /** A new, empty edit, straight into the timeline editor. Done there comes back here with it chosen. */
  const startTimeline = async () => {
    setStarting(true);
    try {
      const s = await api.newSequence();
      go({ name: "edit", id: s.id });
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
      setStarting(false);
    }
  };

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
      setClipFile(fileOfPath(String(r.props[t.clipKey] ?? "")));
      setName(b.name);
    });
  }, [batch, TEMPLATES, api]);

  // Switching template or clip seeds the clip-derived props; the rest keeps what you typed where names overlap.
  const chooseTemplate = (t: Template) => {
    setTemplate(t);
    setProps((p) => ({ ...freshDefaults(t), ...pick(p, Object.keys(t.defaults)), ...(clip ? t.clipProps(clipPath(game, clip), clip.facts.seconds, clip.facts) : {}) }));
    freshFrom(t);
  };
  const chooseClip = (f: string) => {
    setClipFile(f);
    const c = clips.find((x) => x.file === f);
    if (c && template) {
      // A plain recording you'd voiced before edits carried their own voice brings its voice-over with it; an edit's voice is in the edit.
      const spoken = template.voice ? { voice: c.path ? "" : (voices.find((v) => v.clip === c.file && v.pieces > 0)?.path ?? "") } : {};
      setProps((p) => ({ ...p, ...template.clipProps(clipPath(game, c), c.facts.seconds, c.facts), cropTop: c.cropTop, cropBottom: c.cropBottom, muted: c.muted, ...(c.title && !p.title && !template.noClipFill?.includes("title") ? { title: c.title } : {}), ...(c.line && !p.line && !template.noClipFill?.includes("line") ? { line: c.line } : {}), ...spoken }));
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

  // The voice-overs recorded over a plain recording, as the `voice` field's choices. An edit's voice is in the edit: no field.
  const voiceOptions = useMemo(() => (clip?.path ? [] : voices.filter((v) => v.clip === clipFile && v.pieces > 0).map((v) => ({ value: v.path, label: `${v.id} (${fmtSeconds(v.seconds)})` }))), [voices, clipFile, clip?.path]);
  useEffect(() => {
    if (!template?.voice || batch || !voiceOptions.length) return;
    setProps((p) => (p.voice ? p : { ...p, voice: voiceOptions[0]!.value }));
  }, [voiceOptions, template, batch]);
  // Fields the chosen edit settles itself: its voice, and its music bed when it has one.
  const settled = useMemo(() => [...(clip?.path ? ["voice"] : []), ...(clip?.music ? ["music", "musicFrom", "musicVolume"] : [])], [clip?.path, clip?.music]);

  const seconds = useMemo(() => {
    try {
      const s = template ? template.seconds(withVariant(effective, 0)) : 10;
      return Number.isFinite(s) ? Math.max(1, s) : 10;
    } catch {
      return 10;
    }
  }, [template, effective]);
  // A template's files for these props (Autosave's music): asked for once
  // the form settles; what comes back lands in the form (only if it changed).
  useEffect(() => {
    if (!template?.prepare) return;
    let alive = true;
    const id = setTimeout(() => {
      void template.prepare!(effective)
        .then((r) => alive && setProps((p) => (Object.entries(r).some(([k, v]) => p[k] !== v) ? { ...p, ...r } : p)))
        // Say so: a Desk started before the game's route existed fails here, and a silent preview hides it.
        .catch((e) => alive && setMsg(`✖ the preview's files didn't make: ${(e as Error).message} (restart the Desk if the game's server code changed)`));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [template, effective]);
  /** The props with the template's files made (awaited before a render or still). */
  const prepared = async () => {
    if (!template?.prepare) return effective;
    setMsg("making what the video needs (the music)…");
    return { ...effective, ...(await template.prepare(effective)) };
  };

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

  // A blank Name falls back to the template's own (worked out from the props), then "video".
  const named = (fallback: string) => name.trim() || template.name?.(effective) || fallback;
  const render = async () => {
    if (!formats.length) return setMsg("tick at least one format");
    setMsg("");
    try {
      const ready = await prepared();
      if (template.variants && variants.length > 1) {
        // One batch per alternative, so each lands in the library as its own card.
        for (let i = 0; i < variants.length; i++) {
          await api.render({ template: template.id, props: withVariant(ready, i), formats, name: `${named("video")}-${template.variants.suffix}${i + 1}` });
        }
        setMsg(`rendering ${variants.length} ${template.variants.suffix} variants × ${formats.length} format${formats.length === 1 ? "" : "s"} — watch the progress below, then find them under Renders`);
      } else {
        await api.render({ template: template.id, props: withVariant(ready, 0), formats, name: named("video") });
        setMsg(`rendering ${formats.length} format${formats.length === 1 ? "" : "s"} — watch the progress below, then find it under Renders`);
      }
      void Promise.resolve(template.rendered?.(ready, named("video"))).catch(() => {});
    } catch (e) {
      setMsg(`✖ ${(e as Error).message}`);
    }
  };
  const still = async () => {
    const frame = playerRef.current?.getCurrentFrame() ?? 0;
    try {
      const ready = await prepared();
      setMsg("rendering the still…");
      const r = await api.still({ template: template.id, props: withVariant(ready, variant), format: previewFormat, frame, name: named("still") });
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
        <div className="row" style={noFootage ? { display: "none" } : undefined}>
          {clip ? (
            <button className="ghost small" onClick={() => go(editRoute(clip))}>
              {clip.path ? "Open the timeline" : "Edit this recording"}
            </button>
          ) : null}
          <button className="small" disabled={starting} onClick={() => void startTimeline()} title="An empty timeline: add footage, arrange it on tracks, record your voice over it, lay a song under it. Done brings you back here with it chosen.">
            {starting ? "starting…" : "Start a timeline"}
          </button>
        </div>
      </div>
      <div className="split">
        <div className="stack" style={{ gap: 18 }}>
          <div className="panel stack">
            <div className="field" style={noFootage ? { display: "none" } : undefined}>
              <label>Clip</label>
              {clip ? (
                <div className="clip-chosen">
                  <img src={thumbOf(api, clip)} alt="" />
                  <div className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                    <strong>{clip.title || clip.file.replace(/\.[^.]+$/, "")}</strong>
                    <span className="small muted mono">{clip.path ? `edit · ${clip.shots} shot${clip.shots === 1 ? "" : "s"}` : clip.file}</span>
                    <span className="small muted">
                      {fmtSeconds(clip.facts.seconds)} · {fmtDate(clip.facts.recordedAt)}
                      {renderedCount.has(clip.file) ? " · already rendered" : ""}
                    </span>
                    {idea ? (
                      <span className="small muted">
                        script: {idea.done ? <s>{idea.title}</s> : idea.title}
                        {" · "}
                        <button className="link small" onClick={() => void api.updateScript(idea.id, { done: !idea.done }).then(() => api.scripts()).then((r) => setIdeas(r.list)).catch(() => {})}>
                          {idea.done ? "not made after all" : "tick it off: made"}
                        </button>
                      </span>
                    ) : null}
                  </div>
                  <button className="ghost small" onClick={() => setPicking(true)}>
                    Change…
                  </button>
                </div>
              ) : (
                <div className="row">
                  <button className="ghost" onClick={() => setPicking(true)}>
                    Pick a clip…
                  </button>
                  <span className="small muted">an edit from the timeline editor, or a plain recording</span>
                </div>
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
          {template.gallery ? (
            <div className="panel stack">
              <Gallery
                label={template.gallery.label}
                items={template.gallery.items}
                value={String(props[template.gallery.key] ?? "")}
                made={madeValues}
                base={`/g/${game.id}`}
                onPick={(v) => setProps((p) => ({ ...p, [template.gallery!.key]: v, ...template.linked?.(template.gallery!.key, v) }))}
              />
            </div>
          ) : null}
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
            {(template.lists ?? []).map((l) => (
              <VariantList
                key={l.key}
                label={l.label}
                rows={listOf(props[l.key])}
                placeholder={l.placeholder}
                onChange={(next) => setProps((p) => ({ ...p, [l.key]: next }))}
                list={{ hint: l.hint, number: l.number ? (i, n) => l.number!(i, n, props) : undefined }}
              />
            ))}
            <SchemaForm schema={template.schema} value={props} onChange={setProps} hide={[...(template.hide ?? []), ...(template.gallery ? [template.gallery.key] : []), ...settled, ...(template.variants ? [template.variants.key] : []), ...(template.lists ?? []).map((l) => l.key)]} options={template.voice ? { ...template.options, voice: voiceOptions } : template.options} reroll={template.reroll} long={template.long} linked={template.linked} />
            {template.voice && clip ? (
              <div className="small muted">
                {clip.path ? (clip.voiced ? "The edit's voice and captions come with it. " : "No voice on this edit yet. ") : voiceOptions.length ? (props.voice ? "This clip's voice-over is on. " : "This clip has a voice-over: pick it under voice. ") : "No voice-over for this recording yet. "}
                {clip.music ? "Its music bed plays under the video (the music fields are the edit's). " : ""}
                <button className="link small" onClick={() => go(editRoute(clip))}>
                  {clip.path ? (clip.voiced ? "Change it in the timeline" : "Record it in the timeline") : voiceOptions.length ? "Edit it in the editor" : "Record one in the editor"}
                </button>
              </div>
            ) : null}
            {template.uncapped && clip ? (
              <div className="small muted">
                {props[template.uncapped.durationKey] === undefined || props[template.uncapped.durationKey] === "" ? "No duration set: " : "Duration capped at the clip: "}
                the cut runs {fmtSeconds(Number(effective[template.uncapped.startKey]))} → {fmtSeconds(Number(effective[template.uncapped.startKey]) + Number(effective[template.uncapped.durationKey]))} of {fmtSeconds(clip.facts.seconds)}.
              </div>
            ) : null}
            {template.info?.(effective) ? <div className="small muted" style={{ whiteSpace: "pre-line" }}>{template.info(effective)}</div> : null}
            {template.warn?.(effective, props, clip) ? <div className="small warn">{template.warn(effective, props, clip)}</div> : null}
          </div>
          <div className="panel stack">
            <h3>Render</h3>
            <div className="field">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={template.name?.(effective) || "harpoon-triple"} />
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
                    <span className="small muted">{j.state === "done" ? <button className="link small" onClick={() => go({ name: "renders" })}>open</button> : `${Math.round(j.progress * 100)}%`}</span>
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
                // The attention experiment plays six stems at once; the Player's default cap is five <Audio> tags.
                numberOfSharedAudioTags={12}
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
