/**
 * The Asset Forge's server half (docs/design/asset-forge.md) — Realmsmith's one
 * deliberate exception to "no server". A dev-only Vite middleware, because the
 * browser can't: hold API keys (they live in `.env.local`, gitignored), run
 * ffmpeg post-processing, or write into the game's assets folder without a
 * user gesture per file. Rides the dev server Realmsmith already runs; Vite
 * binds localhost, and `apply: "serve"` keeps all of this out of builds.
 *
 * Endpoints (JSON):
 *   GET  /forge/status    → ForgeStatus (types + which keys were found)
 *   POST /forge/generate  → GenerateRequest → GenerateResponse (b64 candidates)
 *   POST /forge/save      → SaveRequest → SaveResponse (writes files + sidecar + manifest)
 *   GET  /forge/bank      → ?type&id → BankResponse (takes on disk, with audio)
 *   POST /forge/bank/remove → BankRemoveRequest → BankResponse (delete a take)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import {
  BADGE,
  DEED,
  HOME,
  ICON,
  MODE,
  SFX,
  SFX_BITS,
  SPRITE,
  type BadgeSpec,
  type DeedSpec,
  type HomeSpec,
  type IconSpec,
  type ModeSpec,
  type SfxSpec,
  type SpriteSpec,
} from "./styleBible";
import { SFX_MODEL_ID, generateSfx } from "./elevenlabs";
import {
  STABLE_AUDIO_MODEL,
  generateSfxLocal,
  stableAudioStatus,
  weightsCached,
  type StableAudioEnv,
} from "./stableAudio";
import { IMAGE_MODEL_ID, generateImage } from "./openai";
import { processSfx } from "./audio";
import { bitsManifestTarget, listBankFiles, writeSfxManifest } from "./sfxManifest";
import { processIcon, processScene } from "./images";
import type {
  BankRemoveRequest,
  BankResponse,
  Candidate,
  SfxEngine,
  SfxProvider,
  ForgeStatus,
  GenerateRequest,
  GenerateResponse,
  SaveRequest,
  SaveResponse,
} from "./protocol";

/** Bank names are file names and manifest keys — snake_case, letter first. */
const NAME_RE = /^[a-z][a-z0-9_]*$/;
/** Icon ids are kebab-case (they mirror the sim's WeaponId/AbilityId unions). */
const ICON_NAME_RE = /^[a-z][a-z0-9-]*$/;

/** The two ElevenLabs SFX types share a pipeline — only tone/destination differ. */
const sfxSpec = (type: string): SfxSpec | null =>
  type === SFX.id ? SFX : type === SFX_BITS.id ? SFX_BITS : null;

/** The gpt-image-1 types share a pipeline — canvas/destination/template differ. */
type ImageSpec = IconSpec | SpriteSpec | ModeSpec | BadgeSpec | DeedSpec | HomeSpec;
const imageSpec = (type: string): ImageSpec | null =>
  type === ICON.id
    ? ICON
    : type === SPRITE.id
      ? SPRITE
      : type === MODE.id
        ? MODE
        : type === BADGE.id
          ? BADGE
          : type === DEED.id
            ? DEED
            : type === HOME.id
              ? HOME
              : null;

/** Seed prompt when only a bare subject arrives (curl/testing — the panel builds its own). */
const imageTemplate = (spec: ImageSpec, subject: string): string =>
  spec.id === ICON.id ? spec.template(subject, "weapon") : spec.template(subject);

const json = (res: ServerResponse, code: number, body: unknown): void => {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

const readJson = <T>(req: IncomingMessage, maxBytes = 32 * 1024 * 1024): Promise<T> =>
  new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("request too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });

const clampDuration = (v: number | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(Math.min(30, Math.max(0.5, v)) * 10) / 10
    : undefined;

const clampInfluence = (v: number | undefined): number | undefined =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100
    : undefined;

export const forgePlugin = (): Plugin => {
  let elevenKey = "";
  let openaiKey = "";
  /** FORGE_SFX_PROVIDER: "stable-audio" runs the local model (stableAudio.ts),
   * "both" runs it AND ElevenLabs on the same prompt (takes tagged per engine);
   * anything else = ElevenLabs only. */
  let sfxProvider: SfxProvider = "elevenlabs";
  let stableAudio: StableAudioEnv = { dir: "", uv: "" };
  let repoRoot = "";

  const status = async (): Promise<ForgeStatus> => {
    const listDir = async (dir: string, ext: string): Promise<string[]> => {
      const abs = join(repoRoot, dir);
      return existsSync(abs) ? (await readdir(abs)).filter((f) => f.endsWith(ext)) : [];
    };
    /** id → forged subject, from every `<id>.forge.json` sidecar in a folder. */
    const forgedSubjects = async (dir: string): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (const f of await listDir(dir, ".forge.json")) {
        try {
          const meta = JSON.parse(await readFile(join(repoRoot, dir, f), "utf8")) as { subject?: unknown };
          if (typeof meta.subject === "string") out[f.slice(0, -".forge.json".length)] = meta.subject;
        } catch {
          // Unreadable sidecar — the deed simply isn't diffable; done-ness still comes from the PNG.
        }
      }
      return out;
    };
    const [iconFiles, sfxFiles, sfxForged, spriteFiles, modeFiles, badgeFiles, deedFiles, deedForged, homeFiles] =
      await Promise.all([
        listDir(ICON.destination, ".png"),
        listDir(SFX_BITS.destination, ".mp3"),
        forgedSubjects(SFX_BITS.destination),
        listDir(SPRITE.destination, ".png"),
        listDir(MODE.destination, ".png"),
        listDir(BADGE.destination, ".png"),
        listDir(DEED.destination, ".png"),
        forgedSubjects(DEED.destination),
        listDir(HOME.destination, ".png"),
      ]);
    return {
      types: [
        { id: SFX_BITS.id, label: SFX_BITS.label, provider: SFX_BITS.provider, candidates: SFX_BITS.candidates },
        { id: ICON.id, label: ICON.label, provider: ICON.provider, candidates: ICON.candidates },
        { id: SPRITE.id, label: SPRITE.label, provider: SPRITE.provider, candidates: SPRITE.candidates },
        { id: MODE.id, label: MODE.label, provider: MODE.provider, candidates: MODE.candidates },
        { id: BADGE.id, label: BADGE.label, provider: BADGE.provider, candidates: BADGE.candidates },
        { id: DEED.id, label: DEED.label, provider: DEED.provider, candidates: DEED.candidates },
        { id: HOME.id, label: HOME.label, provider: HOME.provider, candidates: HOME.candidates },
        { id: SFX.id, label: SFX.label, provider: SFX.provider, candidates: SFX.candidates },
      ],
      keys: {
        elevenlabs: elevenKey.length > 0,
        openai: openaiKey.length > 0,
        stableAudio: stableAudioStatus(stableAudio).ready,
        stableAudioWeights: weightsCached(),
      },
      sfxProvider,
      sfxProviderMissing: providerMissing(),
      iconFiles,
      sfxFiles,
      sfxForged,
      spriteFiles,
      modeFiles,
      badgeFiles,
      deedFiles,
      deedForged,
      homeFiles,
    };
  };

  /** Image generation (icons, sprites, mode cards): N PNGs — transparent
   * cut-outs or opaque scenes per the spec. The panel builds the prompt (it
   * owns the sets) and sends it verbatim; the bare subject fallback below
   * only serves curl/testing. */
  const generateImages = async (
    spec: ImageSpec,
    body: GenerateRequest,
    res: ServerResponse,
  ): Promise<void> => {
    if (!openaiKey)
      return json(res, 503, {
        error:
          "OPENAI_API_KEY is missing — add it to apps/realmsmith/.env.local and restart the dev server",
      });
    const subject = (body.subject ?? "").trim();
    const explicit = (body.prompt ?? "").trim().slice(0, 2400);
    if (!explicit && !subject) return json(res, 400, { error: "a prompt or subject is required" });
    const prompt = explicit || imageTemplate(spec, subject);

    const settled = await Promise.allSettled(
      Array.from({ length: spec.candidates }, () =>
        generateImage(openaiKey, prompt, spec.size, "background" in spec ? spec.background : "transparent"),
      ),
    );
    const candidates: Candidate[] = [];
    for (const r of settled) {
      if (r.status !== "fulfilled") continue;
      // Preview = the save pipeline's own output (grid snap + quantize), so
      // the panel judges candidates as they will actually ship — the raw
      // generation stays the save payload (bits-art-style.md § pixel grids).
      let preview: string | undefined;
      try {
        const processed =
          "savedWidth" in spec
            ? await processScene(
                r.value,
                spec.savedWidth,
                spec.savedHeight,
                spec.pixelGridWidth,
                spec.pixelGridHeight,
                spec.paletteColours,
              )
            : await processIcon(r.value, spec.savedSize, spec.pixelGrid, spec.paletteColours);
        preview = processed.toString("base64");
      } catch {
        /* best-effort — the panel falls back to the raw image */
      }
      candidates.push({ id: candidates.length, mime: "image/png", b64: r.value.toString("base64"), preview });
    }
    if (candidates.length === 0) {
      const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      return json(res, 502, { error: `generation failed: ${first ? String(first.reason) : "unknown"}` });
    }
    json(res, 200, { prompt, candidates } satisfies GenerateResponse);
  };

  const generate = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson<GenerateRequest>(req);
    const image = imageSpec(body.type);
    if (image) return generateImages(image, body, res);
    const spec = sfxSpec(body.type);
    if (!spec) return json(res, 400, { error: `unknown asset type "${body.type}"` });
    const subject = (body.subject ?? "").trim();
    if (!subject) return json(res, 400, { error: "subject is required" });
    // An explicit prompt (the panel's editable box, hand-written)
    // is sent verbatim; otherwise the style-bible template seeds from the subject.
    const prompt = (body.prompt ?? "").trim().slice(0, 800) || spec.template(subject);
    const durationSeconds = clampDuration(body.durationSeconds);

    const promptInfluence = clampInfluence(body.promptInfluence) ?? spec.promptInfluence;

    // Each engine returns its takes tagged; "both" runs them side by side on
    // the SAME prompt and duration and the panel shows all six.
    const runLocal = async (): Promise<Candidate[]> => {
      const status = stableAudioStatus(stableAudio);
      if (!status.ready) throw new Error(`Stable Audio isn't ready — missing: ${status.missing.join("; ")}`);
      const takes = await generateSfxLocal(stableAudio, { text: prompt, durationSeconds, takes: spec.candidates });
      return takes.map((wav, id) => ({ id, mime: "audio/wav", b64: wav.toString("base64"), engine: "stable-audio" }));
    };
    const runEleven = async (): Promise<Candidate[]> => {
      if (!elevenKey)
        throw new Error("ELEVENLABS_API_KEY is missing — add it to apps/realmsmith/.env.local and restart the dev server");
      const settled = await Promise.allSettled(
        Array.from({ length: spec.candidates }, () =>
          generateSfx(elevenKey, { text: prompt, durationSeconds, promptInfluence }),
        ),
      );
      const out: Candidate[] = [];
      for (const r of settled) {
        if (r.status === "fulfilled")
          out.push({ id: out.length, mime: "audio/mpeg", b64: r.value.toString("base64"), engine: "elevenlabs" });
      }
      if (out.length === 0) {
        const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
        throw new Error(first ? String(first.reason) : "ElevenLabs returned nothing");
      }
      return out;
    };

    const runs =
      sfxProvider === "both"
        ? [runLocal(), runEleven()]
        : sfxProvider === "stable-audio"
          ? [runLocal()]
          : [runEleven()];
    const settled = await Promise.allSettled(runs);
    const candidates: Candidate[] = [];
    const failures: string[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") candidates.push(...r.value);
      else failures.push(String((r.reason as Error).message ?? r.reason));
    }
    candidates.forEach((c, i) => (c.id = i));
    if (candidates.length === 0)
      return json(res, failures.some((f) => f.includes("missing")) ? 503 : 502, {
        error: `generation failed: ${failures.join(" | ")}`,
      });
    // Partial success on "both": the takes that came back, plus a note.
    json(res, 200, {
      prompt: failures.length > 0 ? `${prompt}\n\n[one engine failed: ${failures.join(" | ")}]` : prompt,
      candidates,
    } satisfies GenerateResponse);
  };

  /** What's missing for the configured engine(s); empty = ready to generate.
   * "both" is ready when EITHER engine is (the other's failure is reported
   * per generation, not as a hard gate). */
  const providerMissing = (): string[] => {
    const local = stableAudioStatus(stableAudio).missing.map((m) => `Stable Audio: ${m}`);
    const eleven = elevenKey ? [] : ["ElevenLabs: ELEVENLABS_API_KEY in apps/realmsmith/.env.local"];
    if (sfxProvider === "stable-audio") return local;
    if (sfxProvider === "elevenlabs") return eleven;
    return local.length > 0 && eleven.length > 0 ? [...local, ...eleven] : [];
  };

  /** Image save (icons, sprites, mode cards): one PNG per id, overwritten on
   * regeneration; sidecar refreshed. */
  const saveImage = async (
    spec: ImageSpec,
    body: SaveRequest,
    res: ServerResponse,
  ): Promise<void> => {
    const id = body.baseName ?? "";
    if (!ICON_NAME_RE.test(id) || id.length > 48)
      return json(res, 400, {
        error: "name must be kebab-case — lowercase letters/digits/hyphens, starting with a letter",
      });
    const take = Array.isArray(body.takes) ? body.takes.find((t) => typeof t === "string" && t.length > 0) : undefined;
    if (!take) return json(res, 400, { error: "no candidate selected" });

    const raw = Buffer.from(take, "base64");
    if (raw.length === 0) return json(res, 400, { error: "the selected candidate had an empty payload" });
    const dir = join(repoRoot, spec.destination);
    await mkdir(dir, { recursive: true });
    const file = `${id}.png`;
    // Cut-outs letterbox into a square; scenes cover-crop to their frame.
    // Both snap to the style's true pixel grid and crush to its palette
    // budget (bits-art-style.md).
    const processed =
      "savedWidth" in spec
        ? await processScene(
            raw,
            spec.savedWidth,
            spec.savedHeight,
            spec.pixelGridWidth,
            spec.pixelGridHeight,
            spec.paletteColours,
          )
        : await processIcon(raw, spec.savedSize, spec.pixelGrid, spec.paletteColours);
    await writeFile(join(dir, file), processed);

    // Sidecar: keep `created` across regenerations, refresh everything else.
    const sidecarPath = join(dir, `${id}.forge.json`);
    const now = new Date().toISOString();
    let created = now;
    if (existsSync(sidecarPath)) {
      try {
        const prev = JSON.parse(await readFile(sidecarPath, "utf8")) as { created?: unknown };
        if (typeof prev.created === "string") created = prev.created;
      } catch {
        /* unreadable sidecar → rewrite it */
      }
    }
    const sidecar = {
      type: spec.id,
      subject: body.subject ?? "",
      prompt: body.prompt ?? "",
      provider: spec.provider,
      model: IMAGE_MODEL_ID,
      params: {
        size: spec.size,
        quality: "medium",
        background: "background" in spec ? spec.background : "transparent",
        ...("savedWidth" in spec
          ? {
              savedWidth: spec.savedWidth,
              savedHeight: spec.savedHeight,
              pixelGrid: `${spec.pixelGridWidth}x${spec.pixelGridHeight}`,
            }
          : { savedSize: spec.savedSize, pixelGrid: spec.pixelGrid }),
        paletteColours: spec.paletteColours,
      },
      files: [file],
      created,
      updated: now,
    };
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

    json(res, 200, {
      files: [file],
      sidecar: `${spec.destination}/${id}.forge.json`,
      // The require-map line for the consuming module (one src/ level deep);
      // specs with a bespoke paste target (mode cards) own their own line.
      manifestLines: [
        "manifestLine" in spec
          ? spec.manifestLine(id, file)
          : `  "${id}": require("${spec.manifestDir}/${file}"),`,
      ],
    } satisfies SaveResponse);
  };

  const save = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson<SaveRequest>(req);
    const image = imageSpec(body.type);
    if (image) return saveImage(image, body, res);
    const spec = sfxSpec(body.type);
    if (!spec) return json(res, 400, { error: `unknown asset type "${body.type}"` });
    const base = body.baseName ?? "";
    if (!NAME_RE.test(base) || base.length > 48)
      return json(res, 400, {
        error: "name must be snake_case — lowercase letters/digits/underscores, starting with a letter",
      });
    const rawTakes = Array.isArray(body.takes) ? body.takes : [];
    const engines = Array.isArray(body.engines) ? body.engines : [];
    const picked = rawTakes
      .map((t, i) => ({ b64: t, engine: engines[i] }))
      .filter((t): t is { b64: string; engine: SfxEngine | undefined } => typeof t.b64 === "string" && t.b64.length > 0);
    const takes = picked.map((t) => t.b64);
    if (takes.length === 0) return json(res, 400, { error: "no takes selected" });

    const dir = join(repoRoot, spec.destination);
    await mkdir(dir, { recursive: true });

    // Continue the variation-bank numbering from whatever is already on disk, so
    // saving more takes into an existing bank never overwrites earlier ones.
    const existing = await readdir(dir);
    const numbered = new RegExp(`^${base}_(\\d+)\\.mp3$`);
    let next =
      existing.reduce((max, f) => {
        const m = numbered.exec(f);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0) + 1;

    const files: string[] = [];
    for (const b64 of takes) {
      const raw = Buffer.from(b64, "base64");
      if (raw.length === 0) return json(res, 400, { error: "a selected take had an empty payload" });
      const processed = await processSfx(raw, spec.loudnessLufs, spec.truePeakDb);
      const file = `${base}_${next++}.mp3`;
      await writeFile(join(dir, file), processed);
      files.push(file);
    }

    // One sidecar per bank. Merge with an existing one: keep `created`,
    // accumulate `files`, refresh the prompt fields to the latest generation.
    const sidecarPath = join(dir, `${base}.forge.json`);
    const engineProvider = (e: string): string => (e === "stable-audio" ? "stable-audio-3" : "elevenlabs-sfx");
    const engineModel = (e: string): string => (e === "stable-audio" ? STABLE_AUDIO_MODEL : SFX_MODEL_ID);
    const fallbackEngine: SfxEngine = sfxProvider === "stable-audio" ? "stable-audio" : "elevenlabs";
    const now = new Date().toISOString();
    let created = now;
    let prevFiles: string[] = [];
    let prevEngines: Record<string, string> = {};
    if (existsSync(sidecarPath)) {
      try {
        const prev = JSON.parse(await readFile(sidecarPath, "utf8")) as {
          created?: unknown;
          files?: unknown;
          takeEngines?: unknown;
        };
        if (typeof prev.created === "string") created = prev.created;
        if (Array.isArray(prev.files))
          prevFiles = prev.files.filter((f): f is string => typeof f === "string");
        if (prev.takeEngines && typeof prev.takeEngines === "object")
          prevEngines = prev.takeEngines as Record<string, string>;
      } catch {
        /* unreadable sidecar → rewrite it */
      }
    }
    const takeEngines: Record<string, string> = { ...prevEngines };
    files.forEach((f, i) => (takeEngines[f] = picked[i]?.engine ?? fallbackEngine));
    const usedEngines = new Set(Object.values(takeEngines));
    const sidecar = {
      type: spec.id,
      subject: body.subject ?? "",
      prompt: body.prompt ?? "",
      // Provenance: which engine made the takes. Per file in `takeEngines`
      // (a bank can mix); the top-level provider/model summarise the bank.
      provider: usedEngines.size === 1 ? engineProvider([...usedEngines][0]!) : usedEngines.size > 1 ? "mixed" : spec.provider,
      model: usedEngines.size === 1 ? engineModel([...usedEngines][0]!) : usedEngines.size > 1 ? "mixed" : SFX_MODEL_ID,
      params: {
        durationSeconds: clampDuration(body.durationSeconds) ?? null,
        promptInfluence: clampInfluence(body.promptInfluence) ?? spec.promptInfluence,
        loudnessLufs: spec.loudnessLufs,
        truePeakDb: spec.truePeakDb,
      },
      files: [...prevFiles, ...files],
      takeEngines,
      created,
      updated: now,
    };
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

    // The bank is live the moment the file lands: the generated manifest is
    // rewritten from the folder and the catalogue derives clips from its keys.
    const manifest = await syncManifest(spec);
    const manifestLines = files.map(
      (f) => `  ${f.replace(/\.mp3$/, "")}: require("${spec.manifestDir}/${f}"),`,
    );
    json(res, 200, {
      files,
      sidecar: `${spec.destination}/${base}.forge.json`,
      manifestLines,
      manifest,
    } satisfies SaveResponse);
  };

  /** Rewrite the game's generated SFX manifest for this spec's folder. Only the
   * BITS type has one today (the gauntlet's manifest is still hand-kept). */
  const syncManifest = async (spec: SfxSpec): Promise<string | undefined> => {
    if (spec.id !== "sfx-bits") return undefined;
    const target = bitsManifestTarget(repoRoot, spec.destination);
    await writeSfxManifest(target);
    return target.out.slice(repoRoot.length + 1);
  };

  /** The takes already on disk for a bank, with audio for auditioning. */
  const bank = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const q = new URL(req.url ?? "", "http://forge").searchParams;
    const spec = sfxSpec(q.get("type") ?? "");
    if (!spec) return json(res, 400, { error: `unknown asset type "${q.get("type") ?? ""}"` });
    const id = q.get("id") ?? "";
    if (!NAME_RE.test(id)) return json(res, 400, { error: "bad bank id" });
    const dir = join(repoRoot, spec.destination);
    const { files } = await listBankFiles(dir);
    const takes = await Promise.all(
      files
        .filter((f) => f.bank === id)
        .map(async (f) => {
          const buf = await readFile(join(dir, f.file));
          return { file: f.file, n: f.n, bytes: buf.length, mime: "audio/mpeg", b64: buf.toString("base64") };
        }),
    );
    json(res, 200, { id, takes } satisfies BankResponse);
  };

  /** Delete one take from a bank: file gone, sidecar's file list trimmed,
   * manifest regenerated. Numbering is NOT compacted — the catalogue reads
   * whatever exists, and stable names keep git history and sidecars honest. */
  const bankRemove = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson<BankRemoveRequest>(req);
    const spec = sfxSpec(body.type);
    if (!spec) return json(res, 400, { error: `unknown asset type "${body.type}"` });
    const id = body.id ?? "";
    const file = body.file ?? "";
    if (!NAME_RE.test(id) || !new RegExp(`^${id}_\\d+\\.mp3$`).test(file))
      return json(res, 400, { error: "file must be a numbered take of this bank" });
    const dir = join(repoRoot, spec.destination);
    await rm(join(dir, file), { force: true });
    const sidecarPath = join(dir, `${id}.forge.json`);
    if (existsSync(sidecarPath)) {
      try {
        const prev = JSON.parse(await readFile(sidecarPath, "utf8")) as { files?: unknown };
        if (Array.isArray(prev.files)) {
          prev.files = prev.files.filter((f) => f !== file);
          await writeFile(sidecarPath, `${JSON.stringify(prev, null, 2)}\n`);
        }
      } catch {
        /* unreadable sidecar — leave it */
      }
    }
    await syncManifest(spec);
    // Hand back the bank as it now stands.
    req.url = `/bank?type=${encodeURIComponent(body.type)}&id=${encodeURIComponent(id)}`;
    return bank(req, res);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Mounted at /forge, so req.url arrives with that prefix stripped.
    const url = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && url === "/status") return json(res, 200, await status());
    if (req.method === "POST" && url === "/generate") return generate(req, res);
    if (req.method === "POST" && url === "/save") return save(req, res);
    if (req.method === "GET" && url === "/bank") return bank(req, res);
    if (req.method === "POST" && url === "/bank/remove") return bankRemove(req, res);
    json(res, 404, { error: `no forge endpoint ${req.method} ${url}` });
  };

  return {
    name: "realmsmith-forge",
    apply: "serve",
    configResolved(config) {
      // loadEnv with an empty prefix reads all vars from .env/.env.local — unlike
      // VITE_-prefixed ones they are never exposed to client code.
      const env = loadEnv(config.mode, config.root, "");
      elevenKey = env.ELEVENLABS_API_KEY ?? process.env.ELEVENLABS_API_KEY ?? "";
      openaiKey = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
      repoRoot = resolve(config.root, "../..");
      const pick = (k: string): string | undefined => env[k] ?? process.env[k];
      const providerEnv = pick("FORGE_SFX_PROVIDER");
      sfxProvider = providerEnv === "stable-audio" || providerEnv === "both" ? providerEnv : "elevenlabs";
      // Defaults: the checkout as a sibling of this monorepo, uv where its
      // installer puts it. Both overridable for other machines.
      stableAudio = {
        dir: resolve(config.root, pick("STABLE_AUDIO_DIR") ?? "../../../stable-audio-3"),
        uv: pick("UV_BIN") ?? join(process.env.HOME ?? "", ".local/bin/uv"),
        hfToken: pick("HF_TOKEN"),
        device: pick("STABLE_AUDIO_DEVICE"),
      };
    },
    configureServer(server) {
      server.middlewares.use("/forge", (req, res, next) => {
        // Only claim the actual endpoints. Everything else under /forge/ is
        // Vite serving this very directory as browser modules (the panel
        // imports styleBible.ts at runtime) — pass it through.
        const url = (req.url ?? "").split("?")[0];
        const isEndpoint =
          (req.method === "GET" && (url === "/status" || url === "/bank")) ||
          (req.method === "POST" && (url === "/generate" || url === "/save" || url === "/bank/remove"));
        if (!isEndpoint) return next();
        void handle(req, res).catch((e: unknown) => {
          if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        });
      });
    },
  };
};
