import { useEffect, useMemo, useState } from "react";
import { type Binned, type Clip, type GameApi, type GameInfo, type ImportJob, type SavedSequence, clipCount, firstClipOf, fmtDate, fmtSeconds, isVoiced, kindOf, shelfLabel, sourceCount, usesRecording } from "./api";
import { editOf, go } from "./App";
import { ClipPicker } from "./ClipPicker";

const stem = (file: string) => file.replace(/\.[^.]+$/, "");
/** The shelf select's "make one" entry. */
const NEW_SHELF = "\u0000new";

/**
 * The clip library: edits up front (what you'd make a video from), then
 * the raw recordings on shelves. A shelf is a folder in the game's Drive
 * footage folder (B-ROLL, GAMEPLAY…): make one there, drop recordings in,
 * and the next sync files them on it; the top of the Drive folder is
 * "Unsorted". A card's shelf select moves it here too (until it moves on
 * Drive). Cuts the old one-recording editor saved are not footage any
 * more: they fold away at the bottom, each a click from becoming an edit.
 * Binned recordings stay binned across syncs.
 */
export const Clips: React.FC<{ game: GameInfo; api: GameApi }> = ({ game, api }) => {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [edits, setEdits] = useState<(SavedSequence & { seconds: number })[]>([]);
  // Recordings from the Mac: uploading (progress 0–1), then the server's convert jobs.
  const [uploads, setUploads] = useState<{ name: string; progress: number; error?: string }[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [dropping, setDropping] = useState(false);
  const [voiced, setVoiced] = useState<Set<string>>(new Set());
  const [binned, setBinned] = useState<Binned[]>([]);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCuts, setShowCuts] = useState(false);
  const [showBin, setShowBin] = useState(false);
  /** The shelf a drop / Import from this Mac lands on. */
  const [dropShelf, setDropShelf] = useState("");
  /** The card whose name is being typed, and the text so far. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const load = () =>
    Promise.all([
      api.clips().then(setClips),
      api
        .sequences()
        .then(setEdits)
        .catch(() => {}),
      api.bin().then(setBinned),
      api
        .voices()
        .then((v) => setVoiced(new Set(v.filter((x) => x.pieces > 0).map((x) => x.clip))))
        .catch(() => {}),
    ]).catch((e) => setLog(String(e)));
  useEffect(() => void load(), []);

  // While anything converts, watch it; when one lands, the library shows it.
  const converting = jobs.some((j) => j.state === "uploaded" || j.state === "converting");
  useEffect(() => {
    if (!converting) return;
    const timer = setInterval(() => {
      void api.imports().then((next) => {
        if (next.some((j) => j.state === "done" && jobs.find((o) => o.id === j.id)?.state !== "done")) void load();
        setJobs(next);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [converting, jobs, api]);
  const importFiles = async (files: File[]) => {
    const videos = files.filter((f) => f.type.startsWith("video/") || /\.(mov|mp4|m4v|mkv|webm)$/i.test(f.name));
    if (!videos.length) return setLog("✖ Those aren't videos. Drop a screen recording (.mov or .mp4).");
    setUploads((u) => [...u, ...videos.map((f) => ({ name: f.name, progress: 0 }))]);
    for (const f of videos) {
      try {
        await api.importFile(f, (p) => setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, progress: p } : x))), dropShelf);
        setUploads((u) => u.filter((x) => x.name !== f.name));
        setJobs(await api.imports());
      } catch (e) {
        setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, error: (e as Error).message } : x)));
      }
    }
  };
  const backupImports = async () => {
    setLog("copying the imports to Drive…");
    try {
      const r = await api.backupImports();
      setLog(`${r.ok ? "✔" : "✖"} ${r.log}`);
    } catch (e) {
      setLog(`✖ ${(e as Error).message}`);
    }
  };

  const { shelves, shelfNames, cuts, cutsOf } = useMemo(() => {
    const all = clips ?? [];
    const cutsOf = new Map<string, Clip[]>();
    for (const c of all) if (c.source) cutsOf.set(c.source, [...(cutsOf.get(c.source) ?? []), c]);
    const raws = all.filter((c) => !c.source);
    // Unsorted (the top of the Drive folder, where the phone's recordings land) first, then the folders A–Z.
    const byName = (a: string, b: string) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b));
    const names = [...new Set(raws.map((c) => c.shelf ?? ""))].sort(byName);
    return {
      shelves: names.map((name) => ({ name, clips: raws.filter((c) => (c.shelf ?? "") === name) })),
      shelfNames: [...new Set(all.map((c) => c.shelf ?? ""))].filter(Boolean).sort(byName),
      cuts: all.filter((c) => c.source),
      cutsOf,
    };
  }, [clips]);
  const editsFrom = (file: string) => edits.filter((e) => e.origin?.file === file || usesRecording(e, `${game.footagePublic}/${file}`));
  /** The edit an old cut turned into, if it has. */
  const editFromCut = (file: string) => edits.find((e) => e.origin?.from === file);
  const byFile = (file: string) => clips?.find((c) => c.file === file);

  /** A sidecar field saved and shown, no reload: the grid shouldn't jump. */
  const patch = async (c: Clip, fields: Partial<Clip>) => {
    try {
      const next = await api.saveClip(c.file, fields);
      setClips((cs) => (cs ?? []).map((x) => (x.file === c.file ? { ...x, ...next } : x)));
    } catch (e) {
      setLog(`✖ ${(e as Error).message}`);
    }
  };
  /** A shelf for a drop or a card: a name typed here is a new one (make the folder on Drive too, or it only exists in the Desk). */
  const askShelf = (): string | null => {
    const name = prompt("New shelf\n\nA name like B-ROLL or TALKING HEAD. Make a folder with the same name in the Drive footage folder and recordings dropped there land on it.");
    return name === null ? null : name.trim().replace(/^\/+|\/+$/g, "");
  };
  const moveTo = (c: Clip, pick: string) => {
    const shelf = pick === NEW_SHELF ? askShelf() : pick;
    if (shelf === null) return;
    void patch(c, { shelf });
  };
  const finishRename = (c: Clip) => {
    setRenaming(null);
    const title = draft.trim();
    if (title !== (c.title || "")) void patch(c, { title: title === stem(c.file) ? "" : title });
  };

  const sync = async (offline: boolean) => {
    setBusy(true);
    setLog(offline ? "re-probing…" : "checking the Drive folder…");
    try {
      const r = await api.sync(offline);
      setLog(r.log);
      await load();
    } catch (e) {
      setLog(`✖ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const bin = async (c: Clip) => {
    const cutsFrom = cutsOf.get(c.file) ?? [];
    const warn = cutsFrom.length ? `\n\n${cutsFrom.length} old cut${cutsFrom.length === 1 ? "" : "s"} came from it (${cutsFrom.map((x) => stem(x.file)).join(", ")}) — they keep working, but can't be re-cut.` : "";
    if (!confirm(`Bin ${c.file}?\n\nIt goes to ${game.footageDir}/.trash, not the void, and Sync won't bring it back from Drive.${warn}`)) return;
    await api.trashClip(c.file);
    await load();
  };
  const restore = async (b: Binned) => {
    const r = await api.restoreClip(b.file);
    setLog(r.onDisk ? `↩ ${b.file} is back in the library` : `↩ ${b.file} taken off the bin list — the next Sync from Drive fetches it again`);
    await load();
  };

  const editCard = (e: SavedSequence & { seconds: number }) => {
    const first = firstClipOf(e);
    const firstFile = first ? first.src.replace(`${game.footagePublic}/`, "") : "";
    const sources = sourceCount(e);
    const clipsIn = clipCount(e);
    const open = () => go({ name: "edit", id: e.id });
    return (
      <div className="card" key={e.id}>
        <div className="thumb" onClick={open} style={{ cursor: "pointer" }}>
          {firstFile ? <img src={api.clipThumb(firstFile, Math.min((first!.start + first!.end) / 2, first!.start + 3))} alt="" loading="lazy" /> : null}
        </div>
        <div className="body">
          <div className="title">{e.name}</div>
          <div className="small muted">
            {fmtSeconds(e.seconds)} · {clipsIn} clip{clipsIn === 1 ? "" : "s"} from {sources} recording{sources === 1 ? "" : "s"} · {fmtDate(e.updatedAt)}
          </div>
          <span className="badge ok">edit</span>
          {isVoiced(e) ? <span className="badge ok">voiced</span> : null}
          <div className="actions">
            <button className="small" onClick={() => go({ name: "make", file: `seq:${e.id}` })}>
              Make a video
            </button>
            <button className="small ghost" onClick={open}>
              Edit
            </button>
            <button
              className="small danger"
              onClick={() => {
                if (!confirm(`Bin the edit "${e.name}"?\n\nThe recordings it uses stay in the library. Its voice-overs go to the voice folder's .trash.`)) return;
                void api.trashSequence(e.id).then(load);
              }}
            >
              Bin
            </button>
          </div>
        </div>
      </div>
    );
  };

  const card = (c: Clip) => {
    const cutsFrom = cutsOf.get(c.file) ?? [];
    const original = c.source ? byFile(c.source) : undefined;
    const became = c.source ? editFromCut(c.file) : undefined;
    const inEdits = editsFrom(c.file).length;
    const wide = c.facts.width > c.facts.height;
    return (
      <div className="card" key={c.file}>
        <div className={`thumb${wide ? " wide" : ""}`} onClick={() => go(editOf(c, clips ?? []))} style={{ cursor: "pointer" }}>
          <img src={api.clipThumb(c.file, Math.min(c.facts.seconds * 0.3, 8))} alt="" loading="lazy" />
        </div>
        <div className="body">
          {renaming === c.file ? (
            <input
              type="text"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finishRename(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter") finishRename(c);
                if (e.key === "Escape") setRenaming(null);
              }}
              style={{ padding: "4px 8px", fontWeight: 700 }}
            />
          ) : (
            <div
              className="title"
              title={`${c.file}\nClick to name it`}
              style={{ cursor: "text" }}
              onClick={() => {
                setRenaming(c.file);
                setDraft(c.title || stem(c.file));
              }}
            >
              {c.title || stem(c.file)}
            </div>
          )}
          <div className="small muted">
            {fmtSeconds(c.facts.seconds)} · {c.facts.width}×{c.facts.height} · {fmtDate(c.facts.recordedAt)}
          </div>
          {c.note ? (
            <div className="small muted" title={c.note} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.note}
            </div>
          ) : null}
          <div className="row" style={{ gap: 6 }}>
            {c.source ? (
              original ? (
                <button className="link small" onClick={() => go({ name: "clean", file: c.source!, from: c.file })} title={`Open ${c.source} in the editor with this cut's pieces loaded`}>
                  cut from {stem(c.source)} ↗
                </button>
              ) : (
                <span className="small muted">cut from {stem(c.source)} (binned)</span>
              )
            ) : (
              <span className="badge">{kindOf(c)}</span>
            )}
            {became ? <span className="badge ok">now an edit</span> : null}
            {cutsFrom.length ? <span className="badge">{cutsFrom.length} old cut{cutsFrom.length === 1 ? "" : "s"}</span> : null}
            {voiced.has(c.file) ? <span className="badge ok">voiced</span> : null}
            {inEdits ? <span className="badge">in {inEdits} edit{inEdits === 1 ? "" : "s"}</span> : null}
          </div>
          {!c.source ? (
            <select
              value={c.shelf ?? ""}
              onChange={(e) => moveTo(c, e.target.value)}
              title={c.imported ? "The shelf it's on." : "The shelf it's on. Moving it between folders on Drive does this too."}
              style={{ padding: "4px 8px", fontSize: 13 }}
            >
              <option value="">Unsorted</option>
              {shelfNames.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value={NEW_SHELF}>New shelf…</option>
            </select>
          ) : null}
          <div className="actions">
            <button className="small" onClick={() => go({ name: "make", file: c.file })}>
              Make a video
            </button>
            {c.source ? (
              <button className="small ghost" onClick={() => (became ? go({ name: "edit", id: became.id }) : go(editOf(c, clips ?? [])))} title={became ? "Open the edit this cut became" : "Open the recording it came from in the editor, with this cut's pieces loaded; the edit takes its place up top"}>
                {became ? "Open the edit" : "Turn into an edit"}
              </button>
            ) : (
              <button className="small ghost" onClick={() => go(editOf(c, clips ?? []))} title="Opens the edit made from this recording, or starts one: cut it, put other footage with it, talk over it">
                Edit
              </button>
            )}
            <button className="small danger" onClick={() => void bin(c)}>
              Bin
            </button>
          </div>
        </div>
      </div>
    );
  };

  const pending = jobs.filter((j) => j.state !== "done" || Date.now() - j.startedAt < 8000);
  return (
    <div
      className={`stack${dropping ? " dropping" : ""}`}
      style={{ gap: 20, minHeight: "70vh" }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      {dropping ? (
        <div className="dropzone">
          Drop to add to {shelfLabel(dropShelf)}. Screen recordings get a light copy made at {game.fps} fps; the original's kept.
        </div>
      ) : null}
      <div className="row between">
        <div>
          <h2>Clips</h2>
          <div className="muted small">
            Record on the phone, drop it in the{" "}
            <a href={`https://drive.google.com/drive/folders/${game.footageFolderId}`} target="_blank" rel="noreferrer">
              Drive footage folder
            </a>
            , press Sync. A folder in there is a shelf here: make one (B-ROLL, GAMEPLAY…) and drop recordings in it. Screen recordings from this Mac: drop them anywhere on this page. Edit a recording to cut it, put other footage with it and talk over it; the edit shows up at the top.
          </div>
        </div>
        <div className="row">
          <label className="small muted row" style={{ gap: 6 }} title="Where a drop or an import from this Mac is filed">
            Imports go on
            <select
              value={dropShelf}
              onChange={(e) => {
                if (e.target.value !== NEW_SHELF) return setDropShelf(e.target.value);
                const s = askShelf();
                if (s !== null) setDropShelf(s);
              }}
              style={{ width: "auto", padding: "5px 8px", fontSize: 13 }}
            >
              <option value="">Unsorted</option>
              {[...new Set([...shelfNames, ...(dropShelf ? [dropShelf] : [])])].sort().map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value={NEW_SHELF}>New shelf…</option>
            </select>
          </label>
          <label className="button ghost" title="Screen recordings and other video from this Mac. Or drop them on the page.">
            Import from this Mac…
            <input
              type="file"
              accept="video/*,.mov,.mp4,.m4v"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                void importFiles(files);
              }}
            />
          </label>
          {clips?.some((c) => c.imported) ? (
            <button className="ghost" disabled={busy} onClick={() => void backupImports()} title="Recordings imported from this Mac only exist here until you do">
              Back up imports to Drive
            </button>
          ) : null}
          <button className="ghost" disabled={busy} onClick={() => go({ name: "make" })} title="Make a video has Start a timeline: an empty edit to add footage to. Or press Edit on a recording to start from it.">
            Start a timeline ›
          </button>
          <button className="ghost" disabled={busy} onClick={() => void sync(true)}>
            Re-probe disk
          </button>
          <button disabled={busy} onClick={() => void sync(false)}>
            {busy ? "Syncing…" : "Sync from Drive"}
          </button>
        </div>
      </div>
      {log ? <pre className="log small">{log}</pre> : null}
      {uploads.length || pending.length ? (
        <div className="panel stack" style={{ gap: 6 }}>
          {uploads.map((u) => (
            <div key={`u${u.name}`} className="small">
              {u.error ? `✖ ${u.name}: ${u.error}` : `uploading ${u.name} · ${Math.round(u.progress * 100)}%`}
            </div>
          ))}
          {pending.map((j) => (
            <div key={j.id} className="small">
              {j.state === "failed" ? `✖ ${j.name}: ${j.error}` : j.state === "done" ? `✔ ${j.name} is in the library as ${j.file}` : `making ${j.name} light enough to edit · ${Math.round(j.progress * 100)}%`}
            </div>
          ))}
        </div>
      ) : null}
      {edits.length ? (
        <>
          <h3 style={{ margin: 0 }}>Edits</h3>
          <div className="grid">{edits.map(editCard)}</div>
        </>
      ) : null}
      {clips === null ? (
        <div className="muted">loading…</div>
      ) : shelves.length === 0 ? (
        <div className="panel muted">No recordings yet. Drop one in the Drive folder and press Sync, or drop a screen recording on this page.</div>
      ) : (
        shelves.map((s) => (
          <section className="stack" style={{ gap: 12 }} key={s.name || "\u0000"}>
            <div className="row" style={{ gap: 10 }}>
              <h3 style={{ margin: 0 }}>{shelfLabel(s.name)}</h3>
              <span className="small muted">
                {s.clips.length} recording{s.clips.length === 1 ? "" : "s"}
                {s.name ? ` · Drive folder ${s.name}` : " · the top of the Drive folder, where the phone's recordings land"}
              </span>
            </div>
            <div className="grid">{s.clips.map(card)}</div>
          </section>
        ))
      )}

      {cuts.length ? (
        <section className="fold">
          <button className="link" onClick={() => setShowCuts((v) => !v)}>
            {showCuts ? "▾" : "▸"} Cuts from the old editor ({cuts.length})
          </button>
          {showCuts ? (
            <>
              <div className="small muted">
                Clips the old one-recording Clean up saved as new files. Videos come from edits now: Turn into an edit opens the recording each came from with its pieces loaded, and the edit takes its place up top. Bin the ones you're done with.
              </div>
              <div className="grid">{cuts.map(card)}</div>
            </>
          ) : null}
        </section>
      ) : null}

      {binned.length ? (
        <section className="fold">
          <button className="link" onClick={() => setShowBin((v) => !v)}>
            {showBin ? "▾" : "▸"} Bin ({binned.length})
          </button>
          {showBin ? (
            <>
              <div className="small muted">Sync leaves these on Drive. Restore puts one back — from {game.footageDir}/.trash if it's still there, else Drive re-sends it next sync.</div>
              <div className="stack" style={{ gap: 6 }}>
                {binned.map((b) => (
                  <div className="row between panel" style={{ padding: "8px 14px" }} key={b.file}>
                    <span className="mono">
                      {b.file} <span className="muted">{b.onDisk ? "in .trash" : "not on disk"}</span>
                    </span>
                    <button className="small ghost" onClick={() => void restore(b)}>
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};
