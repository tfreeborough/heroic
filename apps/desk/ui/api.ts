import type { FormatSpec } from "../game";
import type { Binned } from "../lib/footage";
import type { ImportJob } from "../lib/imports";
import type { Job } from "../lib/render";
import type { Batch, Render } from "../lib/renders";
import type { PlanState, Script, ScriptPatch, ScriptSummary } from "../lib/scripts";
import type { ResearchState, ScriptResearch } from "../lib/research";
import type { DocEntry } from "../lib/doc";
/** A script's newest edit's score (lib/score.ts). */
export type ScoreState = { seq: string; file: string; seed: number; state: "making" | "ready" | "failed"; label?: string; error?: string };
/** A score on disk, for the list of past ones (lib/score.ts). */
export type ScoreListing = { file: string; seq: string; seed: number; label?: string; at: string };
import type { Platform, Post, Schedule } from "../lib/schedule";
import type { CleanupSpec, FootageSidecar } from "../lib/sidecar";
import type { Sequence, Take, VoiceOver } from "@heroic/voiceover";
import type { VoiceSummary } from "../lib/voice";
import type { WhisperStatus } from "../lib/whisper";

/** A recording in the library, or (from asClips) an edit dressed as one so Make can pick it. */
export type Clip = FootageSidecar & {
  /** What a template's clip prop takes, when it isn't `<footagePublic>/<file>` (an edit's JSON). */
  path?: string;
  /** A picture for its card, when it isn't the file's own. */
  thumb?: string;
  /** The video to play on hover. */
  video?: string;
  /** An edit: how many clips, from how many recordings. */
  shots?: number;
  /** An edit: it has a music bed (Make hides its own music fields). */
  music?: boolean;
  /** An edit: it has voice on its audio tracks. */
  voiced?: boolean;
  /** An edit: its markers' times, in order. */
  markers?: number[];
  sources?: number;
  /** An edit: the script (Scripts tab) it's making, by id. */
  idea?: string;
};
export type { Batch, Binned, Script, ScriptPatch, ScriptSummary, ImportJob, Job, Platform, Post, Render, Schedule, VoiceSummary, WhisperStatus };
/** What /api/games says about a game — enough for the page; templates load separately. */
export type GameInfo = { id: string; name: string; icon: string; fps: number; formats: Record<string, FormatSpec>; footageFolderId: string; footageDir: string; rendersDir: string; footagePublic: string };
/** An edit as the server lists it: `path` is what a template's clip prop takes. */
export type SavedSequence = Sequence & { path: string; seconds?: number };

const j = async <T>(res: Response): Promise<T> => {
  const text = await res.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text) as T & { error?: string };
  } catch {
    // The page is bundled fresh on every load but the server only reads its
    // code when it starts, so a route added since then isn't there yet.
    if (res.status === 404) throw new Error("The Desk's server doesn't know this part of the page yet. It was started before the code changed: stop it (Ctrl+C) and run `bun run desk` again.");
    throw new Error(text.slice(0, 200) || res.statusText);
  }
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};
const enc = encodeURIComponent;
const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const games = () => fetch("/api/games").then((r) => j<GameInfo[]>(r));

/** All calls scoped to one game. */
export const gameApi = (game: string) => {
  const base = `/api/${enc(game)}`;
  return {
    clips: () => fetch(`${base}/clips`).then((r) => j<Clip[]>(r)),
    sync: (offline = false) => post(`${base}/clips/sync${offline ? "?offline=1" : ""}`).then((r) => j<{ ok: boolean; log: string }>(r)),
    saveClip: (file: string, patch: Partial<Clip>) =>
      fetch(`${base}/clips/${enc(file)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => j<Clip>(r)),
    trashClip: (file: string) => fetch(`${base}/clips/${enc(file)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
    bin: () => fetch(`${base}/bin`).then((r) => j<Binned[]>(r)),
    restoreClip: (file: string) => post(`${base}/bin/${enc(file)}/restore`).then((r) => j<{ onDisk: boolean }>(r)),
    cleanup: (file: string, body: CleanupSpec & { name: string; replace?: string }) =>
      post(`${base}/clips/${enc(file)}/cleanup`, body).then((r) => j<Clip>(r)),
    clipThumb: (file: string, at: number) => `${base}/clips/${enc(file)}/thumb?at=${at.toFixed(2)}`,
    clipStrip: (file: string, frames = 24) => `${base}/clips/${enc(file)}/strip?frames=${frames}`,
    clipUrl: (file: string) => `/g/${enc(game)}/footage/${enc(file)}`,

    /** A file from the Mac into the footage library, onto `shelf` ("" = unshelved). Upload progress comes through `onProgress` (0–1); the convert is a job to poll with imports(). */
    importFile: (file: File, onProgress?: (p: number) => void, shelf = "") =>
      new Promise<ImportJob>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("POST", `${base}/imports?name=${enc(file.name)}${shelf ? `&shelf=${enc(shelf)}` : ""}`);
        x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
        x.onload = () => {
          try {
            const data = JSON.parse(x.responseText) as ImportJob & { error?: string };
            if (x.status >= 400) reject(new Error(data.error ?? x.statusText));
            else resolve(data);
          } catch {
            reject(new Error(x.status === 404 ? "The Desk's server doesn't know imports yet: stop it (Ctrl+C) and run `bun run desk` again." : x.responseText.slice(0, 200)));
          }
        };
        x.onerror = () => reject(new Error("the upload failed"));
        x.send(file);
      }),
    imports: () => fetch(`${base}/imports`).then((r) => j<ImportJob[]>(r)),
    backupImports: () => post(`${base}/imports/backup`).then((r) => j<{ ok: boolean; log: string }>(r)),

    sequences: () => fetch(`${base}/sequences`).then((r) => j<(SavedSequence & { seconds: number })[]>(r)),
    sequence: (id: string) => fetch(`${base}/sequences/${enc(id)}`).then((r) => j<SavedSequence>(r)),
    /** The edit a clip opens in (made if there isn't one; `fresh` = always a new one). */
    sequenceFrom: (body: { file: string; from?: string; fresh?: boolean }) => post(`${base}/sequences`, body).then((r) => j<SavedSequence>(r)),
    /** A new, empty edit (Make's Start a timeline). */
    newSequence: (name?: string) => post(`${base}/sequences`, { name }).then((r) => j<SavedSequence>(r)),
    /** A recording off the mic (or an audio file) → a take for this edit. The page puts it on a track. */
    addSequenceTake: (id: string, audio: Blob, opts: { tidy: boolean; denoise?: number; ext?: string }) =>
      fetch(`${base}/sequences/${enc(id)}/takes?tidy=${opts.tidy ? 1 : 0}&denoise=${opts.denoise ?? 0}&ext=${enc(opts.ext ?? "wav")}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: audio }).then((r) => j<Take>(r)),
    transcribeTake: (id: string, take: Take) => post(`${base}/sequences/${enc(id)}/transcribe`, take).then((r) => j<Take>(r)),
    /** The edit's takes made to sound another way: tidied or not, the background noise down (0–3) or not. */
    sequenceSound: (id: string, takes: Take[], want: { tidy: boolean; denoise?: number }) => post(`${base}/sequences/${enc(id)}/sound`, { takes, ...want }).then((r) => j<Take[]>(r)),
    saveSequence: (seq: Sequence) => fetch(`${base}/sequences/${enc(seq.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(seq) }).then((r) => j<SavedSequence>(r)),
    trashSequence: (id: string) => fetch(`${base}/sequences/${enc(id)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),

    voices: () => fetch(`${base}/voice`).then((r) => j<VoiceSummary[]>(r)),
    /** The saved voice-over, or an empty one for this clip. `path` is what a template's `voice` prop takes. */
    voice: (id: string, clip: string) => fetch(`${base}/voice/${enc(id)}?clip=${enc(clip)}`).then((r) => j<VoiceOver & { path: string }>(r)),
    saveVoice: (voice: VoiceOver) => fetch(`${base}/voice/${enc(voice.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(voice) }).then((r) => j<VoiceOver>(r)),
    /** `keepTakes`: the edit has moved to another clip, its recordings stay. */
    deleteVoice: (id: string, keepTakes = false) => fetch(`${base}/voice/${enc(id)}${keepTakes ? "?keep=1" : ""}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
    /** A saved voice-over as it is on disk, or undefined. */
    savedVoice: (id: string) => fetch(`${base}/voice/${enc(id)}`).then((r) => (r.ok ? j<VoiceOver & { path: string }>(r) : undefined)),
    addTake: (id: string, audio: Blob, opts: { tidy: boolean; denoise?: number; ext?: string }) =>
      fetch(`${base}/voice/${enc(id)}/takes?tidy=${opts.tidy ? 1 : 0}&denoise=${opts.denoise ?? 0}&ext=${enc(opts.ext ?? "wav")}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: audio }).then((r) => j<Take>(r)),
    transcribe: (id: string, take: Take) => post(`${base}/voice/${enc(id)}/transcribe`, take).then((r) => j<Take>(r)),
    /** The takes' sound made another way: tidied or not, the background noise down (0–3) or not. */
    sound: (voice: VoiceOver, want: { tidy?: boolean; denoise?: number }) => post(`${base}/voice/${enc(voice.id)}/sound`, { voice, ...want }).then((r) => j<VoiceOver>(r)),
    whisper: () => fetch(`${base}/voice/whisper`).then((r) => j<WhisperStatus>(r)),
    installWhisper: () => post(`${base}/voice/whisper`).then((r) => j<WhisperStatus>(r)),
    backupTakes: () => post(`${base}/voice/backup`).then((r) => j<{ ok: boolean; log: string }>(r)),
    /** A file under the game's public dir, as the page fetches it (a take's WAV). */
    publicUrl: (path: string) => `/g/${enc(game)}/${path.split("/").map(enc).join("/")}`,

    render: (body: { template: string; props: Record<string, unknown>; formats: string[]; name: string }) => post(`${base}/render`, body).then((r) => j<Job[]>(r)),
    still: (body: { template: string; props: Record<string, unknown>; format: string; frame: number; name: string }) => post(`${base}/still`, body).then((r) => j<{ file: string }>(r)),
    jobs: () => fetch(`${base}/jobs`).then((r) => j<Job[]>(r)),

    batches: () => fetch(`${base}/batches`).then((r) => j<Batch[]>(r)),
    deleteBatch: (id: string) => fetch(`${base}/batches/${enc(id)}`, { method: "DELETE" }).then((r) => j<{ ok: true; deleted: number }>(r)),
    deleteRender: (slug: string) => fetch(`${base}/renders/${enc(slug)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
    upload: (slugs: string[]) => post(`${base}/renders/upload`, { slugs }).then((r) => j<{ ok: boolean; log: string; uploaded: string[] }>(r)),
    renderThumb: (slug: string) => `${base}/renders/${enc(slug)}/thumb`,
    renderUrl: (slug: string) => `/g/${enc(game)}/renders/${enc(slug)}.mp4`,

    /** `claude` = the server has a key and the game a voice, so drafting is on. */
    schedule: () => fetch(`${base}/schedule`).then((r) => j<Schedule & { claude: boolean }>(r)),
    redraft: (id: string) => post(`${base}/schedule/${enc(id)}/draft`).then((r) => j<Schedule>(r)),
    queue: (batches: string[]) => post(`${base}/schedule`, { batches }).then((r) => j<{ schedule: Schedule; placed: Post[]; skipped: string[] }>(r)),
    scheduleSettings: (patch: { slotsPerDay?: number; minGapDays?: number; slotLabels?: string[] }) =>
      fetch(`${base}/schedule`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => j<Schedule>(r)),
    reflow: () => post(`${base}/schedule/reflow`).then((r) => j<Schedule>(r)),
    move: (id: string, day: string, slot: number) => post(`${base}/schedule/${enc(id)}/move`, { day, slot }).then((r) => j<Schedule>(r)),
    updatePost: (id: string, patch: Partial<Pick<Post, "day" | "slot" | "title" | "description" | "posted">> & { doneAt?: string | null }) =>
      fetch(`${base}/schedule/${enc(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => j<Schedule>(r)),
    ignore: (batch: string, ignored: boolean) =>
      fetch(`${base}/batches/${enc(batch)}/ignore`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ignored }) }).then((r) => j<Schedule>(r)),

    /** The Scripts tab. `claude` = the server has a key and the game a script voice, so the rewrite steps are on. */
    scripts: () => fetch(`${base}/scripts`).then((r) => j<{ list: ScriptSummary[]; claude: boolean; images: boolean; palette: "matrix" | "sand" }>(r)),
    /** `pending`: beats whose sketch is being made right now. */
    script: (id: string) => fetch(`${base}/scripts/${enc(id)}`).then((r) => j<Script & { pending: string[]; score: ScoreState | null; researching: ResearchState | null; planning: PlanState | null }>(r)),
    /** The Google Docs in the game's scripts folder (docs/design/desk-docs.md). */
    docs: (fresh = false) => fetch(`${base}/docs${fresh ? "?fresh=1" : ""}`).then((r) => j<{ docs: DocEntry[] }>(r)),
    /** Pull a Doc into a script (`doc` links it; without, the latest of the one it's linked to). */
    pullDoc: (id: string, doc?: string) => post(`${base}/scripts/${enc(id)}/doc`, doc ? { id: doc } : {}).then((r) => j<Script>(r)),
    unlinkDoc: (id: string) => fetch(`${base}/scripts/${enc(id)}/doc`, { method: "DELETE" }).then((r) => j<Script>(r)),
    /** Drive's modified time for the script's Doc now (null when it isn't linked or isn't there). */
    docModified: (id: string) => fetch(`${base}/scripts/${enc(id)}/doc`).then((r) => j<{ modified: string | null }>(r)),
    /** Research the draft (docs/design/desk-research.md): starts in the background; the script's `researching` says how it's going. */
    research: (id: string) => post(`${base}/scripts/${enc(id)}/research`).then((r) => j<ResearchState>(r)),
    /** Tom's call on one finding: accept, reject, his words, or where a lost one goes. */
    decideFinding: (id: string, finding: string, d: { status?: string; text?: string; anchor?: string }) => post(`${base}/scripts/${enc(id)}/research/decide`, { finding, ...d }).then((r) => j<ScriptResearch>(r)),
    /** The newest edit's score made again; `another` = a new seed. */
    remakeScore: (id: string, another: boolean) => post(`${base}/scripts/${enc(id)}/score`, { another }).then((r) => j<Script>(r)),
    /** One of the script's edits binned (into the sequences' .trash) and off its list. */
    binScriptEdit: (id: string, seq: string) => fetch(`${base}/scripts/${enc(id)}/sequences/${enc(seq)}`, { method: "DELETE" }).then((r) => j<Script>(r)),
    /** Every score made for the script's edits still on disk, newest first. */
    scores: (id: string) => fetch(`${base}/scripts/${enc(id)}/scores`).then((r) => j<ScoreListing[]>(r)),
    /** An earlier score back on the newest edit (its seed becomes the script's). */
    chooseScore: (id: string, file: string) => post(`${base}/scripts/${enc(id)}/scores`, { file }).then((r) => j<Script>(r)),
    /** A recording → a take on the script (saved, transcribed). */
    addScriptTake: (id: string, audio: Blob, opts: { tidy: boolean; denoise?: number; ext?: string }) =>
      fetch(`${base}/scripts/${enc(id)}/takes?tidy=${opts.tidy ? 1 : 0}&denoise=${opts.denoise ?? 0}&ext=${enc(opts.ext ?? "wav")}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: audio }).then((r) => j<Take & { error?: string }>(r)),
    removeScriptTake: (id: string, file: string) => fetch(`${base}/scripts/${enc(id)}/takes/${enc(file)}`, { method: "DELETE" }).then((r) => j<Script>(r)),
    organise: (id: string) => post(`${base}/scripts/${enc(id)}/organise`).then((r) => j<{ script: Script; made: { cut: string; title: string; id: string; missing: string[]; conflicts: { beat: string; takes: string[] }[]; youtube: string }[] }>(r)),
    /** The story (docs/design/desk-ascii-scripts.md § Pictures): world, cast, chapters and a scene line a beat, in one call in the background; the script's `planning` says how it's going. */
    planStory: (id: string) => post(`${base}/scripts/${enc(id)}/story`).then((r) => j<PlanState>(r)),
    /** The prompts from the story; `all` = every beat again. A batch of beats a call in the background, each landing on the beats as it's done. */
    writePrompts: (id: string, all = false) => post(`${base}/scripts/${enc(id)}/prompts${all ? "?all=1" : ""}`).then((r) => j<PlanState>(r)),
    /** Pictures made in the background: every one not yet made, or another try at exactly `only`. */
    makePictures: (id: string, only?: { beat: string; k: number }[]) => post(`${base}/scripts/${enc(id)}/pictures`, { only }).then((r) => j<{ started: number }>(r)),
    /** One picture's prompt written again by Claude (to an instruction, or blank for just a better idea). */
    newPicturePrompt: (id: string, beat: string, k: number, instruction: string) => post(`${base}/scripts/${enc(id)}/prompt`, { beat, k, instruction }).then((r) => j<Script>(r)),
    /** Three more thumbnail ideas (docs/design/desk-thumbnails.md), to an instruction or none. */
    planThumbnails: (id: string, instruction = "") => post(`${base}/scripts/${enc(id)}/thumbnails/plan`, { instruction }).then((r) => j<Script>(r)),
    /** Three more YouTube titles to test, to an instruction or none. */
    planTitles: (id: string, instruction = "") => post(`${base}/scripts/${enc(id)}/titles/plan`, { instruction }).then((r) => j<Script>(r)),
    /** The top of the YouTube description and the tags, written again (to an instruction or none). */
    /** The long cut as an article for the site's dev log (docs/design/desk-writeup.md). */
    writeArticle: (id: string, instruction = "") => post(`${base}/scripts/${enc(id)}/writeup`, { instruction }).then((r) => j<Script>(r)),
    /** A glyph still drawn on the page (a beat's picture, or "cover" for the thumbnail) for the article: the server keeps it beside the script's pictures. */
    siteStill: (id: string, key: string, png: Blob) => fetch(`${base}/scripts/${enc(id)}/writeup/still?key=${enc(key)}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: png }).then((r) => j<{ ok: true }>(r)),
    /** When the YouTube video went live, for the post's date ("" if YouTube doesn't say). */
    videoDate: (id: string, video: string) => fetch(`${base}/scripts/${enc(id)}/writeup/video?v=${enc(video)}`).then((r) => j<{ date: string }>(r)),
    /** Write the article and its cover into the site for Tom to commit. */
    saveArticle: (id: string) => post(`${base}/scripts/${enc(id)}/writeup/save`).then((r) => j<Script>(r)),
    writeYouTube: (id: string, instruction = "") => post(`${base}/scripts/${enc(id)}/youtube`, { instruction }).then((r) => j<Script>(r)),
    /** Thumbnail pictures made in the background: every idea with none yet, or another try at `only`. */
    makeThumbnails: (id: string, only?: string[]) => post(`${base}/scripts/${enc(id)}/thumbnails/make`, { only }).then((r) => j<{ started: number }>(r)),
    /** Tom's own image as a thumbnail picture (no idea = a new idea of its own). */
    ownThumbnail: (id: string, idea: string, file: File) =>
      fetch(`${base}/scripts/${enc(id)}/thumbnails/own?idea=${enc(idea)}&ext=${enc(file.name.split(".").pop() ?? "png")}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file }).then((r) => j<Script>(r)),
    /** Tom's own image as a beat's picture. */
    ownPicture: (id: string, beat: string, k: number, file: File) =>
      fetch(`${base}/scripts/${enc(id)}/pictures/own?beat=${enc(beat)}&k=${k}&ext=${enc(file.name.split(".").pop() ?? "png")}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: file }).then((r) => j<Script>(r)),
    addScript: (title: string, source = "") => post(`${base}/scripts`, { title, source }).then((r) => j<Script>(r)),
    updateScript: (id: string, patch: ScriptPatch) =>
      fetch(`${base}/scripts/${enc(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).then((r) => j<Script>(r)),
    removeScript: (id: string) => fetch(`${base}/scripts/${enc(id)}`, { method: "DELETE" }).then((r) => j<{ ok: true }>(r)),
    /** The Claude steps; each answers with the whole script. */
    rewriteScript: (id: string) => post(`${base}/scripts/${enc(id)}/rewrite`).then((r) => j<Script>(r)),
    adjustScript: (id: string) => post(`${base}/scripts/${enc(id)}/adjust`).then((r) => j<Script>(r)),
    redoBeat: (id: string, cut: string, beat: string, instruction: string) => post(`${base}/scripts/${enc(id)}/redo`, { cut, beat, instruction }).then((r) => j<Script>(r)),
    redoCut: (id: string, cut: string, instruction: string) => post(`${base}/scripts/${enc(id)}/redo`, { cut, instruction }).then((r) => j<Script>(r)),
    anotherShort: (id: string, instruction: string) => post(`${base}/scripts/${enc(id)}/short`, { instruction }).then((r) => j<Script>(r)),
    unqueue: (id: string) => fetch(`${base}/schedule/${enc(id)}`, { method: "DELETE" }).then((r) => j<Schedule>(r)),
  };
};
export type GameApi = ReturnType<typeof gameApi>;

/** The clip that opens an edit (the earliest on the bottom track), for its picture. */
export const firstClipOf = (s: Pick<Sequence, "video">) => [...(s.video[0]?.clips ?? [])].sort((a, b) => a.at - b.at)[0];
export const clipCount = (s: Pick<Sequence, "video">) => s.video.reduce((n, t) => n + t.clips.length, 0);
export const sourceCount = (s: Pick<Sequence, "video">) => new Set(s.video.flatMap((t) => t.clips.map((c) => c.src))).size;
export const isVoiced = (s: Pick<Sequence, "audio">) => s.audio.some((t) => !t.muted && t.clips.some((c) => !c.muted));
/** Which recordings an edit uses. */
export const usesRecording = (s: Pick<Sequence, "video">, src: string) => s.video.some((t) => t.clips.some((c) => c.src === src));

/** Edits as library entries: file `seq:<id>`, the first clip's recording for the picture. */
export const asClips = (api: GameApi, game: GameInfo, edits: (SavedSequence & { seconds: number })[]): Clip[] =>
  edits.map((s) => {
    const first = firstClipOf(s);
    const file = first ? first.src.replace(`${game.footagePublic}/`, "") : "";
    return {
      file: `seq:${s.id}`,
      facts: { seconds: s.seconds, width: 1080, height: 1920, fps: game.fps, recordedAt: s.updatedAt.slice(0, 19), bytes: 0 },
      title: s.name,
      line: "",
      note: s.note ?? "",
      cropTop: 0,
      cropBottom: 0,
      muted: false,
      path: s.path,
      thumb: file ? api.clipThumb(file, Math.min((first!.start + first!.end) / 2, first!.start + 3)) : undefined,
      video: file ? api.clipUrl(file) : undefined,
      shots: clipCount(s),
      markers: (s.markers ?? []).map((m) => m.at),
      ...(s.idea ? { idea: s.idea } : {}),
      ...(s.music ? { music: true } : {}),
      ...(isVoiced(s) ? { voiced: true } : {}),
      sources: sourceCount(s),
    };
  });
export const clipPath = (game: GameInfo, c: Clip) => c.path ?? `${game.footagePublic}/${c.file}`;
/** A shelf's name on screen: the Drive folder's, or Unsorted for the top of the Drive folder. */
export const shelfLabel = (shelf: string | undefined) => shelf || "Unsorted";
/** What kind of recording a raw is, from its facts: a phone capture is tall, a screen capture wide. */
export const kindOf = (c: Clip) => (c.imported ? "from the Mac" : c.facts.width > c.facts.height ? "screen" : "phone");
/** A blank card for an edit with no footage yet. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
export const thumbOf = (api: GameApi, c: Clip) => c.thumb ?? (c.path ? BLANK : api.clipThumb(c.file, Math.min(c.facts.seconds * 0.3, 8)));

export const fmtSeconds = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m}:${r.toFixed(1).padStart(4, "0")}` : `${r.toFixed(1)}s`;
};
export const fmtBytes = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
export const fmtDate = (iso: string) => iso.slice(0, 10) + " " + iso.slice(11, 16);
