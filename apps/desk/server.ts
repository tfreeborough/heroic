/**
 * The Desk — `bun run desk` at the repo root. One local page for the whole
 * promo loop of every registered game (games.ts): raw clips in (Drive),
 * cleanup (ffmpeg), template + props → render (Remotion), and the library
 * of finished videos (+ Drive upload).
 *
 * Bun bundles the React page from index.html itself (HMR in dev); the API
 * is plain JSON under /api/<game>/…. A game's public dir is served at
 * /g/<game>/… for the page, AND at the root for whichever game the page
 * last selected (cookie) — that's what the templates' staticFile() paths
 * resolve to inside the live preview.
 */
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import index from "./index.html";
import { type GameConfig, type GameRoutes } from "./game";
import { GAMES, gameById } from "./games";
import { type CleanupSpec, cleanupClip, ffprobe, filmstripAsync, thumbnail } from "./lib/ffmpeg";
import { footageDir, listBinned, listClips, publicDir, readSidecar, restoreClip, safeShelf, syncFootage, trashClip, writeSidecar } from "./lib/footage";
import { jobs, renderStillTo, rendersDir, startRender } from "./lib/render";
import { deleteBatch, deleteRender, listBatches, listRenders, uploadRenders } from "./lib/renders";
import { hasClaude } from "./lib/draft";
import type { ScriptPatch } from "./lib/scripts";
import { addScript, addTakeToScript, listScripts, readScript, removeScript, removeTakeFromScript, updateScript } from "./lib/scriptsStore";
import { adjustScript, anotherShort, binEdit, hasClaude as hasRewriter, makePictures, makeThumbnails, chooseScore, organise, ownPicture, ownThumbnail, pendingPictures, planState, planStory, planThumbnails, redoBeat, redoCut, redoPicturePrompt, remakeScore, scriptScores, rewriteScript, planTitles, ownSiteStill, saveArticle, videoPublishDate, writeArticle, writePrompts, writeYouTube } from "./lib/scriptSteps";
import { scoreState } from "./lib/score";
import { decide, researchState, startResearch } from "./lib/researcher";
import { docModified, listDocs, pullDoc, unlinkDoc } from "./lib/scriptDocs";
import { hasImages } from "./lib/cards";
import { type PostPatch, movePost, pruneSchedule, queueBatches, redraftPost, reflow, removePost, setIgnored, updatePost, updateSettings } from "./lib/scheduleStore";
import { type FootageSidecar, MEDIA_EXT, freshSidecar } from "./lib/sidecar";
import { type VoiceOver, voiceId } from "@heroic/voiceover";
import { backupTakes, deleteVoice, listVoices, openVoice, readVoice, resound, resoundTakes, saveTake, soundStrength, transcribeTake, trashTakes, voicePath, writeVoice } from "./lib/voice";
import { installWhisper, whisperStatus } from "./lib/whisper";
import { backupImports, importJobs, startImport } from "./lib/imports";
import { createSequence, footageSrc, listSequences, readSequence, sequenceFrom, sequencePath, trashSequence, writeSequence } from "./lib/sequences";
import type { Sequence, Take } from "@heroic/voiceover";

const PORT = Number(process.env.DESK_PORT ?? 3400);

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (e: unknown, status = 500) => json({ error: (e as Error).message ?? String(e) }, status);
const safeName = (name: string) => basename(name); // never walk out of a folder

/** Most bytes one Range reply carries. An open-ended `bytes=N-` on a 200 MB
 * recording otherwise streams to the end: Chrome parks those half-read
 * streams, several <video>s use up its 6 connections, and a seek back dies
 * with PIPELINE_ERROR_READ. Short replies make it ask again as it goes. */
const RANGE_CHUNK = 4 * 1024 * 1024;

/** A file response that honours Range, so <video> can seek. */
const file = (path: string, req?: Request): Response => {
  if (!existsSync(path) || !statSync(path).isFile()) return new Response("not found", { status: 404 });
  const f = Bun.file(path);
  const range = req?.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) return new Response(f, { headers: { "Accept-Ranges": "bytes" } });
  const start = m[1] ? Number(m[1]) : Math.max(0, f.size - Number(m[2]));
  const end = Math.min(m[1] && m[2] ? Number(m[2]) : f.size - 1, f.size - 1, start + RANGE_CHUNK - 1);
  if (start > end || start >= f.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${f.size}` } });
  return new Response(f.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Range": `bytes ${start}-${end}/${f.size}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Content-Type": f.type },
  });
};

/** Route helper: resolve :game or 404. */
const withGame = (fn: (g: GameConfig, req: Request & { params: Record<string, string> }) => Response | Promise<Response>) => (req: Request & { params: Record<string, string> }) => {
  const g = gameById(req.params.game ?? "");
  return g ? fn(g, req) : json({ error: `unknown game ${req.params.game}` }, 404);
};

// Each game's prepare step (e.g. sync icons from the game app) once at start.
for (const g of GAMES) {
  for (const cmd of g.prepare ?? []) {
    const p = Bun.spawnSync(cmd, { cwd: g.root, stdout: "inherit", stderr: "inherit" });
    if (p.exitCode !== 0) console.warn(`⚠ ${g.id}: ${cmd.join(" ")} exited ${p.exitCode}`);
  }
}

// Each game's own server routes, from desk.server.ts beside its config.
const gameRoutes = new Map<string, GameRoutes>();
for (const g of GAMES) {
  const mod = join(g.root, "desk.server.ts");
  if (existsSync(mod)) gameRoutes.set(g.id, ((await import(mod)) as { routes: GameRoutes }).routes);
}

const server = Bun.serve({
  port: PORT,
  // Sync, cleanup and Drive upload answer only when the child process is done,
  // which can be minutes; Bun's default 10s idle timeout would drop the socket
  // under them. 255 is the ceiling Bun allows.
  idleTimeout: 255,
  // Screen recordings dropped on the page come up as one request body (Bun's default cap is 128 MB).
  maxRequestBodySize: 32 * 1024 ** 3,
  // Full page reloads on change, not hot swaps: the templates load as a lazy
  // chunk and a hot-swapped screen would keep the old one until a reload.
  development: { hmr: false, console: true },
  routes: {
    "/": index,
    "/api/games": {
      GET: () => json(GAMES.map((g) => ({ id: g.id, name: g.name, icon: `/g/${g.id}/${g.icon}`, fps: g.fps, formats: g.formats, footageFolderId: g.drive.footageFolderId, footageDir: g.footageDir, rendersDir: g.rendersDir, footagePublic: footageSrc(g, "").replace(/\/$/, "") }))),
    },

    // ── a game's own routes (its tabs' server side) ──
    "/api/:game/x/:name": withGame(async (g, req) => {
      const fn = gameRoutes.get(g.id)?.[`${req.method} ${req.params.name}`];
      if (!fn) return json({ error: `no ${req.method} ${req.params.name} for ${g.id}` }, 404);
      try {
        return await fn(req, g);
      } catch (e) {
        return fail(e);
      }
    }),

    // ── raw clips ──
    "/api/:game/clips": { GET: withGame((g) => json(listClips(g))) },
    "/api/:game/clips/sync": {
      POST: withGame(async (g, req) => json(await syncFootage(g, { offline: new URL(req.url).searchParams.get("offline") === "1" }))),
    },
    /** What's been binned; restore puts a recording back (from .trash/, or off the ledger so Drive re-sends it). */
    /** A recording from the Mac: the body is the file, `?name=` its name. Answers once it's on disk; the convert runs on (poll GET). */
    "/api/:game/imports": {
      GET: withGame((g) => json([...importJobs.values()].filter((j) => j.game === g.id).sort((a, b) => b.startedAt - a.startedAt).slice(0, 20))),
      POST: withGame(async (g, req) => {
        const q = new URL(req.url).searchParams;
        const name = safeName(q.get("name") ?? "recording.mov");
        if (!req.body) return json({ error: "no file" }, 400);
        try {
          return json(await startImport(g, name, req, safeShelf(q.get("shelf") ?? "")));
        } catch (e) {
          return fail(e, 400);
        }
      }),
    },
    "/api/:game/imports/backup": {
      POST: withGame(async (g) => {
        try {
          return json(await backupImports(g));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    "/api/:game/bin": { GET: withGame((g) => json(listBinned(g))) },
    "/api/:game/bin/:file/restore": { POST: withGame((g, req) => json(restoreClip(g, safeName(decodeURIComponent(req.params.file!))))) },
    "/api/:game/clips/:file": {
      GET: withGame((g, req) => {
        const side = readSidecar(g, safeName(decodeURIComponent(req.params.file!)));
        return side ? json(side) : json({ error: "no such clip" }, 404);
      }),
      /** Save the sidecar's editable fields (title/line/note/crop…). */
      PUT: withGame(async (g, req) => {
        const name = safeName(decodeURIComponent(req.params.file!));
        const prev = readSidecar(g, name);
        if (!prev) return json({ error: "no such clip" }, 404);
        const patch = (await req.json()) as Partial<FootageSidecar>;
        const next: FootageSidecar = { ...prev, ...patch, file: prev.file, facts: prev.facts };
        // A shelf is a folder name; an empty one means unshelved (the key goes, not an empty string).
        if ("shelf" in patch) {
          const shelf = safeShelf(patch.shelf ?? "");
          if (shelf) next.shelf = shelf;
          else delete next.shelf;
        }
        writeSidecar(g, next);
        return json(next);
      }),
      DELETE: withGame((g, req) => {
        trashClip(g, safeName(decodeURIComponent(req.params.file!)));
        return json({ ok: true });
      }),
    },
    "/api/:game/clips/:file/thumb": {
      GET: withGame(async (g, req) => {
        const name = safeName(decodeURIComponent(req.params.file!));
        const at = Number(new URL(req.url).searchParams.get("at") ?? 1);
        try {
          return file(await thumbnail(join(footageDir(g), name), Math.max(0, at), 480, req.signal));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    "/api/:game/clips/:file/strip": {
      /** `?frames=` = how many frames across the whole recording: the editor asks for more on a long one, and more again zoomed in.
       * Capped so the tiled JPEG stays under its 65,535px width limit. */
      GET: withGame(async (g, req) => {
        const name = safeName(decodeURIComponent(req.params.file!));
        const side = readSidecar(g, name);
        if (!side) return json({ error: "no such clip" }, 404);
        const tileWidth = (120 * (side.facts.width || 9)) / (side.facts.height || 16);
        const most = Math.max(24, Math.min(1024, Math.floor(60000 / tileWidth)));
        const frames = Math.max(24, Math.min(most, Math.round(Number(new URL(req.url).searchParams.get("frames")) || 24)));
        try {
          return file(await filmstripAsync(join(footageDir(g), name), side.facts.seconds, frames, 120, req.signal));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Cut + crop into a new clip in the library. `replace` names an existing
     * cut of this recording to save over (re-cutting from the Clips screen). */
    "/api/:game/clips/:file/cleanup": {
      POST: withGame(async (g, req) => {
        const name = safeName(decodeURIComponent(req.params.file!));
        const body = (await req.json()) as CleanupSpec & { name: string; replace?: string };
        const src = readSidecar(g, name);
        if (!src) return json({ error: "no such clip" }, 404);
        const outName = `${safeName(body.name).replace(MEDIA_EXT, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "clip"}.mp4`;
        const dir = footageDir(g);
        const replacing = body.replace && outName === safeName(body.replace) ? readSidecar(g, outName) : undefined;
        if (existsSync(join(dir, outName)) && !replacing) return json({ error: `${outName} already exists — pick another name` }, 409);
        if (replacing && replacing.source !== src.file) return json({ error: `${outName} was cut from ${replacing.source ?? "somewhere else"}, not ${src.file}` }, 409);
        // Always encode to a .partial beside the target, then swap in: a failed or
        // cancelled cut leaves no half-written .mp4 (the library skips .partial),
        // and a failed re-cut leaves the old cut intact.
        const tmp = join(dir, `.${outName}.partial`);
        try {
          await cleanupClip(join(dir, name), tmp, body, req.signal);
          renameSync(tmp, join(dir, outName));
          const facts = { ...ffprobe(join(dir, outName)), recordedAt: src.facts.recordedAt, bytes: statSync(join(dir, outName)).size };
          const keep = replacing ?? src;
          const side: FootageSidecar = {
            ...freshSidecar(outName, facts),
            title: keep.title,
            line: keep.line,
            note: keep.note,
            cropTop: 0,
            cropBottom: 0,
            muted: body.muted,
            source: src.file,
            cleanup: { segments: body.segments, transition: body.transition, transitionSeconds: body.transitionSeconds, cropTop: body.cropTop, cropBottom: body.cropBottom, muted: body.muted },
          };
          writeSidecar(g, side);
          return json(side);
        } catch (e) {
          rmSync(tmp, { force: true });
          return fail(e);
        }
      }),
    },

    // ── edits (sequences) ──
    "/api/:game/sequences": {
      GET: withGame((g) => json(listSequences(g))),
      /** A new edit: `{ name? }` for an empty timeline (Make's Start a timeline), or `{ file, from?, fresh? }` for one started from a recording (see sequenceFrom). */
      POST: withGame(async (g, req) => {
        try {
          const body = (await req.json()) as { file?: string; from?: string; fresh?: boolean; name?: string };
          const s = body.file ? sequenceFrom(g, { file: body.file, from: body.from, fresh: body.fresh }) : createSequence(g, body.name);
          return json({ ...s, path: sequencePath(g, s.id) });
        } catch (e) {
          return fail(e, 400);
        }
      }),
    },
    "/api/:game/sequences/:id": {
      GET: withGame((g, req) => {
        const s = readSequence(g, req.params.id!);
        return s ? json({ ...s, path: sequencePath(g, s.id) }) : json({ error: "no such edit" }, 404);
      }),
      PUT: withGame(async (g, req) => {
        try {
          const s = writeSequence(g, { ...((await req.json()) as Sequence), id: req.params.id! });
          return json({ ...s, path: sequencePath(g, s.id) });
        } catch (e) {
          return fail(e, 400);
        }
      }),
      DELETE: withGame((g, req) => {
        trashSequence(g, req.params.id!);
        return json({ ok: true });
      }),
    },
    /** A recording (the request body: a WAV off the mic, or any audio with `?ext=`) → a take for this edit, made to sound as `?tidy=`/`?denoise=` ask. The page adds it to the edit. */
    "/api/:game/sequences/:id/takes": {
      POST: withGame(async (g, req) => {
        const q = new URL(req.url).searchParams;
        try {
          const bytes = new Uint8Array(await req.arrayBuffer());
          if (bytes.byteLength < 100) return json({ error: "that recording is empty" }, 400);
          return json(await saveTake(g, req.params.id!, bytes, { ext: q.get("ext") ?? "wav", tidy: q.get("tidy") !== "0", denoise: Number(q.get("denoise")) || 0, signal: req.signal }));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Whisper over one take (the body): the same take back, with its words. */
    "/api/:game/sequences/:id/transcribe": {
      POST: withGame(async (g, req) => {
        try {
          return json(await transcribeTake(g, (await req.json()) as Take, req.signal));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** The edit's takes made to sound another way (tidied or not, the noise down or not) from the raw recordings: `{ takes, tidy, denoise }` → the takes, pointing at the new files. */
    "/api/:game/sequences/:id/sound": {
      POST: withGame(async (g, req) => {
        try {
          const body = (await req.json()) as { takes: Take[]; tidy?: boolean; denoise?: number };
          return json(await resoundTakes(g, body.takes ?? [], { tidy: body.tidy !== false, denoise: soundStrength(body.denoise) }, req.signal));
        } catch (e) {
          return fail(e);
        }
      }),
    },

    // ── voice-overs ──
    "/api/:game/voice": { GET: withGame((g) => json(listVoices(g))) },
    /** Is Whisper built and its model down? POST starts the install and answers at once; poll GET. */
    "/api/:game/voice/whisper": {
      GET: withGame(() => json(whisperStatus())),
      POST: withGame(() => {
        void installWhisper().catch(() => {});
        return json(whisperStatus());
      }),
    },
    "/api/:game/voice/backup": {
      POST: withGame(async (g) => {
        try {
          return json(await backupTakes(g));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    "/api/:game/voice/:id": {
      /** The saved voice-over, or an empty one for `?clip=` (nothing is written until the first save). */
      GET: withGame((g, req) => {
        const clip = new URL(req.url).searchParams.get("clip") ?? "";
        const v = clip ? openVoice(g, req.params.id!, safeName(clip)) : readVoice(g, req.params.id!);
        return v ? json({ ...v, path: voicePath(g, v.id) }) : json({ error: "no such voice-over" }, 404);
      }),
      PUT: withGame(async (g, req) => {
        const body = (await req.json()) as VoiceOver;
        const volume = Number(body.volume);
        return json(
          writeVoice(g, {
            id: voiceId(req.params.id!),
            clip: safeName(body.clip ?? ""),
            takes: body.takes ?? [],
            pieces: body.pieces ?? [],
            captionNudgeMs: Number(body.captionNudgeMs) || 0,
            tidy: body.tidy !== false,
            denoise: Math.max(0, Math.min(3, Math.round(Number(body.denoise) || 0))),
            volume: Number.isFinite(volume) && body.volume !== undefined ? Math.max(0, Math.min(1, volume)) : 1,
            ...(body.against && Array.isArray((body.against as { shots?: unknown }).shots) ? { against: body.against } : {}),
          }),
        );
      }),
      /** `?keep=1` takes the edit away and leaves the recordings (it has moved to another clip). */
      DELETE: withGame((g, req) => {
        deleteVoice(g, req.params.id!, new URL(req.url).searchParams.get("keep") === "1");
        return json({ ok: true });
      }),
    },
    /** A recording (the request body: a WAV off the mic, or any audio with `?ext=`) → this voice-over's next take. */
    "/api/:game/voice/:id/takes": {
      POST: withGame(async (g, req) => {
        const q = new URL(req.url).searchParams;
        try {
          const bytes = new Uint8Array(await req.arrayBuffer());
          if (bytes.byteLength < 100) return json({ error: "that recording is empty" }, 400);
          return json(await saveTake(g, req.params.id!, bytes, { ext: q.get("ext") ?? "wav", tidy: q.get("tidy") !== "0", denoise: Number(q.get("denoise")) || 0, signal: req.signal }));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Whisper over one take (the body): the same take back, with its words. */
    "/api/:game/voice/:id/transcribe": {
      POST: withGame(async (g, req) => {
        try {
          return json(await transcribeTake(g, (await req.json()) as VoiceOver["takes"][number], req.signal));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** The takes' sound made another way (tidied or not, the noise down or not) from the raw recordings. The body is the voice-over as the page has it. */
    "/api/:game/voice/:id/sound": {
      POST: withGame(async (g, req) => {
        try {
          const body = (await req.json()) as { voice: VoiceOver; tidy?: boolean; denoise?: number };
          return json(writeVoice(g, await resound(g, { ...body.voice, id: voiceId(req.params.id!) }, { tidy: body.tidy, denoise: body.denoise }, req.signal)));
        } catch (e) {
          return fail(e);
        }
      }),
    },

    // ── rendering ──
    "/api/:game/render": {
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { template: string; props: Record<string, unknown>; formats: string[]; name: string };
        const batch = crypto.randomUUID(); // the formats of one press = one batch in the library
        return json(body.formats.map((format) => startRender(g, { template: body.template, props: body.props, format, name: body.name, batch })));
      }),
    },
    "/api/:game/jobs": { GET: withGame((g) => json([...jobs.values()].filter((j) => j.game === g.id).sort((a, b) => b.startedAt - a.startedAt).slice(0, 30))) },
    "/api/:game/still": {
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { template: string; props: Record<string, unknown>; format: string; frame: number; name: string };
        const out = join(rendersDir(g), `${safeName(body.name)}-${body.format}-f${body.frame}.png`);
        try {
          await renderStillTo(g, { ...body, out });
          return json({ file: basename(out) });
        } catch (e) {
          return fail(e);
        }
      }),
    },

    // ── finished videos ──
    "/api/:game/renders": { GET: withGame((g) => json(listRenders(g))) },
    "/api/:game/batches": { GET: withGame((g) => json(listBatches(g))) },
    "/api/:game/batches/:id": {
      DELETE: withGame(async (g, req) => {
        const id = decodeURIComponent(req.params.id!);
        const props = listBatches(g).find((b) => b.id === id)?.renders.map((r) => r.props) ?? [];
        const deleted = deleteBatch(g, id);
        // Tell the game, if it listens (Autosave takes the slot out of its ledger).
        const hook = gameRoutes.get(g.id)?.["POST batch-deleted"];
        if (hook && deleted) await hook(new Request("http://desk/batch-deleted", { method: "POST", body: JSON.stringify({ id, props }) }), g);
        return json({ ok: true, deleted });
      }),
    },
    /** One rclone run for however many renders — a whole batch, or the ones not on Drive yet. */
    "/api/:game/renders/upload": {
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { slugs: string[] };
        return json(await uploadRenders(g, (body.slugs ?? []).map(safeName)));
      }),
    },
    "/api/:game/renders/:slug": {
      DELETE: withGame((g, req) => {
        deleteRender(g, safeName(req.params.slug!));
        return json({ ok: true });
      }),
    },
    "/api/:game/renders/:slug/thumb": {
      GET: withGame(async (g, req) => {
        try {
          return file(await thumbnail(join(rendersDir(g), `${safeName(req.params.slug!)}.mp4`), 1.5, 480, req.signal));
        } catch (e) {
          return fail(e);
        }
      }),
    },

    // ── the posting queue ──
    "/api/:game/schedule": {
      GET: withGame((g) => json({ ...pruneSchedule(g), claude: hasClaude() && Boolean(g.post?.ai) })),
      /** Queue batches: each lands in the next free slot under the spacing rule. */
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { batches: string[]; from?: string };
        return json(await queueBatches(g, body.batches ?? [], body.from));
      }),
      PUT: withGame(async (g, req) => json(updateSettings(g, (await req.json()) as { slotsPerDay?: number; minGapDays?: number; slotLabels?: string[] }))),
    },
    "/api/:game/schedule/reflow": { POST: withGame((g) => json(reflow(g))) },
    /** Dragged to another day/slot; whatever was there swaps places with it. */
    "/api/:game/schedule/:id/move": {
      POST: withGame(async (g, req) => {
        try {
          const body = (await req.json()) as { day: string; slot: number };
          return json(movePost(g, req.params.id!, body.day, body.slot));
        } catch (e) {
          return fail(e, 404);
        }
      }),
    },
    "/api/:game/schedule/:id/draft": {
      POST: withGame(async (g, req) => {
        try {
          return json(await redraftPost(g, req.params.id!));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** A batch the queue should leave alone (experiments), or not any more. */
    "/api/:game/batches/:id/ignore": {
      PUT: withGame(async (g, req) => json(setIgnored(g, decodeURIComponent(req.params.id!), Boolean(((await req.json()) as { ignored: boolean }).ignored)))),
    },
    "/api/:game/schedule/:id": {
      PUT: withGame(async (g, req) => {
        try {
          return json(updatePost(g, req.params.id!, (await req.json()) as PostPatch));
        } catch (e) {
          return fail(e, 404);
        }
      }),
      DELETE: withGame((g, req) => json(removePost(g, req.params.id!))),
    },
    // ── scripts (the Scripts tab) ──
    "/api/:game/scripts": {
      GET: withGame((g) => json({ list: listScripts(g), claude: hasRewriter() && Boolean(g.script?.ai), images: hasImages(), palette: g.script?.palette ?? "matrix" })),
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { title?: string; source?: string };
        return json(addScript(g, String(body.title ?? ""), String(body.source ?? "")));
      }),
    },
    "/api/:game/scripts/:id": {
      GET: withGame((g, req) => {
        const s = readScript(g, req.params.id!);
        const seqId = s?.sequences?.at(-1)?.id;
        return s ? json({ ...s, pending: pendingPictures(s.id), score: seqId ? (scoreState(g, seqId) ?? null) : null, researching: researchState(s.id) ?? null, planning: planState(s.id) ?? null }) : json({ error: "no such script" }, 404);
      }),
      PUT: withGame(async (g, req) => {
        try {
          return json(updateScript(g, req.params.id!, (await req.json()) as ScriptPatch));
        } catch (e) {
          return fail(e, 404);
        }
      }),
      DELETE: withGame((g, req) => {
        removeScript(g, req.params.id!);
        return json({ ok: true });
      }),
    },
    /** The Claude steps: rewrite (source → cuts), adjust (a re-paste), redo (a beat or a cut to an instruction), short (one more). Each answers with the whole script. */
    "/api/:game/scripts/:id/rewrite": { POST: withGame(async (g, req) => rewriteScript(g, req.params.id!).then(json, fail)) },
    "/api/:game/scripts/:id/adjust": { POST: withGame(async (g, req) => adjustScript(g, req.params.id!).then(json, fail)) },
    "/api/:game/scripts/:id/redo": {
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { cut: string; beat?: string; instruction?: string };
        return body.beat ? redoBeat(g, req.params.id!, body.cut, body.beat, body.instruction ?? "").then(json, fail) : redoCut(g, req.params.id!, body.cut, body.instruction ?? "").then(json, fail);
      }),
    },
    /** The Google Docs in the game's scripts folder (docs/design/desk-docs.md), newest first; `?fresh=1` skips the half-minute cache. */
    "/api/:game/docs": {
      GET: withGame(async (g, req) => listDocs(g, new URL(req.url).searchParams.get("fresh") === "1").then((docs) => json({ docs }), fail)),
    },
    /** A script's Doc: GET = Drive's modified time now; POST `{ id? }` = pull it in (link to `id`, or the latest of the linked one); DELETE = unlink (the words stay). */
    "/api/:game/scripts/:id/doc": {
      GET: withGame(async (g, req) => docModified(g, req.params.id!).then((modified) => json({ modified }), fail)),
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { id?: string };
        return pullDoc(g, req.params.id!, body.id ? String(body.id) : undefined).then(json, fail);
      }),
      DELETE: withGame((g, req) => {
        try {
          return json(unlinkDoc(g, req.params.id!));
        } catch (e) {
          return fail(e, 404);
        }
      }),
    },
    /** Research the draft in the background (docs/design/desk-research.md). Answers at once with the run's state; GET the script for progress. */
    "/api/:game/scripts/:id/research": {
      POST: withGame((g, req) => {
        try {
          return json(startResearch(g, req.params.id!));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Tom's call on one finding: `{ finding, status?, text?, anchor? }`. Answers with the research. */
    "/api/:game/scripts/:id/research/decide": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { finding?: string; status?: string; text?: string; anchor?: string };
        try {
          return json(decide(g, req.params.id!, String(body.finding ?? ""), { status: body.status, text: body.text, anchor: body.anchor }));
        } catch (e) {
          return fail(e, 400);
        }
      }),
    },
    /** The story (docs/design/desk-ascii-scripts.md § Pictures): world, cast, chapters and a scene line a beat, in one call. Starts in the background; answers with the state, the script's `planning` says how it's going. */
    "/api/:game/scripts/:id/story": {
      POST: withGame((g, req) => {
        try {
          return json(planStory(g, req.params.id!));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** The prompts from the story, a batch of beats a call in the background (`?all=1`: every beat again). Answers with the state. */
    "/api/:game/scripts/:id/prompts": {
      POST: withGame((g, req) => {
        try {
          return json(writePrompts(g, req.params.id!, new URL(req.url).searchParams.get("all") === "1"));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** One picture's prompt written again by Claude: `{ beat, k, instruction }`. Answers with the script. */
    "/api/:game/scripts/:id/prompt": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { beat?: string; k?: number; instruction?: string };
        return redoPicturePrompt(g, req.params.id!, String(body.beat ?? ""), Math.max(0, Math.min(1, Math.round(Number(body.k)) || 0)), String(body.instruction ?? "")).then(json, fail);
      }),
    },
    /** Make pictures in the background: every one not yet made, or (`only`) another try at exactly these. */
    "/api/:game/scripts/:id/pictures": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { only?: { beat: string; k: number }[] };
        try {
          const only = Array.isArray(body.only) ? body.only.map((o) => ({ beat: String(o.beat), k: Math.round(Number(o.k)) || 0 })) : undefined;
          return json(makePictures(g, req.params.id!, only));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Tom's own image (the body) as a beat's picture: `?beat=&k=&ext=`. Answers with the script. */
    "/api/:game/scripts/:id/pictures/own": {
      POST: withGame(async (g, req) => {
        const q = new URL(req.url).searchParams;
        try {
          const bytes = new Uint8Array(await req.arrayBuffer());
          if (bytes.byteLength < 100) return json({ error: "that image is empty" }, 400);
          if (bytes.byteLength > 25e6) return json({ error: "that image is over 25 MB" }, 400);
          return json(ownPicture(g, req.params.id!, q.get("beat") ?? "", Math.round(Number(q.get("k"))) || 0, bytes, q.get("ext") ?? "png"));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Three more thumbnail ideas (docs/design/desk-thumbnails.md): `{ instruction? }`. Answers with the script. */
    "/api/:game/scripts/:id/thumbnails/plan": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { instruction?: string };
        return planThumbnails(g, req.params.id!, String(body.instruction ?? "")).then(json, fail);
      }),
    },
    /** Three more YouTube titles to test: `{ instruction? }`. Answers with the script. */
    "/api/:game/scripts/:id/titles/plan": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { instruction?: string };
        return planTitles(g, req.params.id!, String(body.instruction ?? "")).then(json, fail);
      }),
    },
    /** The top of the YouTube description and the tags, written again: `{ instruction? }`. Answers with the script. */
    "/api/:game/scripts/:id/youtube": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { instruction?: string };
        return writeYouTube(g, req.params.id!, String(body.instruction ?? "")).then(json, fail);
      }),
    },
    /** The long cut as an article for the site's dev log (docs/design/desk-writeup.md), to an instruction. Answers with the script. */
    "/api/:game/scripts/:id/writeup": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { instruction?: string };
        return writeArticle(g, req.params.id!, String(body.instruction ?? "")).then(json, fail);
      }),
    },
    /** A glyph still the page drew for the article (the body, PNG): `?key=<beat id>` or `?key=cover`. Saved beside the script's pictures; Save to the site uses them. */
    "/api/:game/scripts/:id/writeup/still": {
      POST: withGame(async (g, req) => {
        const key = new URL(req.url).searchParams.get("key") ?? "";
        try {
          const bytes = new Uint8Array(await req.arrayBuffer());
          if (bytes.byteLength < 100) return json({ error: "that still is empty" }, 400);
          if (bytes.byteLength > 25e6) return json({ error: "that still is over 25 MB" }, 400);
          ownSiteStill(g, req.params.id!, key, bytes);
          return json({ ok: true });
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** When a YouTube video went live (`?v=` id or link), for the post's date: `{ date: "YYYY-MM-DD" | "" }`. */
    "/api/:game/scripts/:id/writeup/video": { GET: withGame(async (_g, req) => json({ date: await videoPublishDate(new URL(req.url).searchParams.get("v") ?? "") })) },
    /** Write the article (and its cover) into the site's content folder for Tom to commit. Answers with the script. */
    "/api/:game/scripts/:id/writeup/save": { POST: withGame((g, req) => saveArticle(g, req.params.id!, req.signal).then(json, fail)) },
    /** Make thumbnail pictures in the background: every idea with none yet, or (`only`, idea ids) another try at those. */
    "/api/:game/scripts/:id/thumbnails/make": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { only?: string[] };
        try {
          return json(makeThumbnails(g, req.params.id!, Array.isArray(body.only) ? body.only.map(String) : undefined));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Tom's own image (the body) as a thumbnail picture: `?idea=&ext=` (no idea = a new one). Answers with the script. */
    "/api/:game/scripts/:id/thumbnails/own": {
      POST: withGame(async (g, req) => {
        const q = new URL(req.url).searchParams;
        try {
          const bytes = new Uint8Array(await req.arrayBuffer());
          if (bytes.byteLength < 100) return json({ error: "that image is empty" }, 400);
          if (bytes.byteLength > 25e6) return json({ error: "that image is over 25 MB" }, 400);
          return json(ownThumbnail(g, req.params.id!, q.get("idea") ?? "", bytes, q.get("ext") ?? "png"));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** A recording off the prompter's mic (the body) → saved as a take, Whisper over it, onto the script. Answers with the take. `?ext=` for a dropped audio file. */
    "/api/:game/scripts/:id/takes": {
      POST: withGame(async (g, req) => {
        const q = new URL(req.url).searchParams;
        try {
          const bytes = new Uint8Array(await req.arrayBuffer());
          if (bytes.byteLength < 100) return json({ error: "that recording is empty" }, 400);
          const take = await saveTake(g, `script-${req.params.id!.slice(0, 8)}`, bytes, { ext: q.get("ext") ?? "wav", tidy: q.get("tidy") !== "0", denoise: Number(q.get("denoise")) || 0, signal: req.signal });
          const heard = await transcribeTake(g, take, req.signal).catch((e: Error) => ({ ...take, error: e.message }));
          addTakeToScript(g, req.params.id!, { ...take, words: heard.words, transcribed: heard.transcribed });
          return json(heard);
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** A take off the script and into the voice folder's .trash (`file` = its path under public/). */
    "/api/:game/scripts/:id/takes/:file": {
      DELETE: withGame((g, req) => {
        try {
          const { script, take } = removeTakeFromScript(g, req.params.id!, decodeURIComponent(req.params.file!));
          if (take) trashTakes(g, [take]);
          return json(script);
        } catch (e) {
          return fail(e, 404);
        }
      }),
    },
    /** The newest edit's score made again (`another`: a new seed, a whole new soundtrack). Answers at once with the script. */
    "/api/:game/scripts/:id/score": {
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { another?: boolean };
        try {
          return json(remakeScore(g, req.params.id!, Boolean(body.another)));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** Every score made for the script's edits (GET), or one of them back on the newest edit (POST `{ file }`, answers with the script). */
    "/api/:game/scripts/:id/scores": {
      GET: withGame((g, req) => {
        try {
          return json(scriptScores(g, req.params.id!));
        } catch (e) {
          return fail(e);
        }
      }),
      POST: withGame(async (g, req) => {
        const body = (await req.json().catch(() => ({}))) as { file?: string };
        try {
          return json(chooseScore(g, req.params.id!, String(body.file ?? "")));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** One of the script's edits binned (into the sequences' .trash) and off its list. Answers with the script. */
    "/api/:game/scripts/:id/sequences/:seq": {
      DELETE: withGame((g, req) => {
        try {
          return json(binEdit(g, req.params.id!, req.params.seq!));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    /** The takes → a fresh sequence per cut. */
    "/api/:game/scripts/:id/organise": {
      POST: withGame((g, req) => {
        try {
          return json(organise(g, req.params.id!));
        } catch (e) {
          return fail(e);
        }
      }),
    },
    "/api/:game/scripts/:id/short": {
      POST: withGame(async (g, req) => {
        const body = (await req.json()) as { instruction?: string };
        return anotherShort(g, req.params.id!, body.instruction ?? "").then(json, fail);
      }),
    },
  },
  /** Static: /g/<game>/renders/<file>, /g/<game>/<public path>, then the cookie-selected game's public dir at the root. */
  fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const m = /^\/g\/([^/]+)\/(.*)$/.exec(path);
    if (m) {
      const g = gameById(m[1]!);
      if (!g) return new Response("unknown game", { status: 404 });
      if (m[2]!.startsWith("renders/")) return file(join(rendersDir(g), safeName(m[2]!.slice(8))), req);
      const pub = publicDir(g);
      const p = join(pub, m[2]!);
      return p.startsWith(pub + "/") ? file(p, req) : new Response("not found", { status: 404 });
    }
    const cookie = /(?:^|;\s*)desk_game=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
    const g = gameById(cookie ?? "") ?? GAMES[0];
    if (g) {
      const pub = publicDir(g);
      const p = join(pub, path);
      if (p.startsWith(pub + "/")) return file(p, req);
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`\n  The Desk → http://localhost:${server.port}   (${GAMES.map((g) => g.name).join(", ")})\n`);
