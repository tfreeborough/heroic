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
 *   POST /forge/expand    → ExpandRequest → ExpandResponse (LLM prompt-craft)
 *   POST /forge/generate  → GenerateRequest → GenerateResponse (b64 candidates)
 *   POST /forge/save      → SaveRequest → SaveResponse (writes files + sidecar)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import {
  EXPANDER_MODEL,
  ICON,
  SFX,
  SFX_BITS,
  SPRITE,
  expanderSystem,
  type IconSpec,
  type SfxSpec,
  type SpriteSpec,
} from "./styleBible";
import { SFX_MODEL_ID, generateSfx } from "./elevenlabs";
import { IMAGE_MODEL_ID, expandPrompt, generateImage } from "./openai";
import { processSfx } from "./audio";
import { processIcon } from "./images";
import type {
  Candidate,
  ExpandRequest,
  ExpandResponse,
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

/** The two gpt-image-1 types share a pipeline — size/destination/template differ. */
const imageSpec = (type: string): IconSpec | SpriteSpec | null =>
  type === ICON.id ? ICON : type === SPRITE.id ? SPRITE : null;

/** Seed prompt when only a bare subject arrives (curl/testing — the panel builds its own). */
const imageTemplate = (spec: IconSpec | SpriteSpec, subject: string): string =>
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
  let repoRoot = "";

  const status = async (): Promise<ForgeStatus> => {
    const listDir = async (dir: string, ext: string): Promise<string[]> => {
      const abs = join(repoRoot, dir);
      return existsSync(abs) ? (await readdir(abs)).filter((f) => f.endsWith(ext)) : [];
    };
    const [iconFiles, sfxFiles, spriteFiles] = await Promise.all([
      listDir(ICON.destination, ".png"),
      listDir(SFX_BITS.destination, ".mp3"),
      listDir(SPRITE.destination, ".png"),
    ]);
    return {
      types: [
        { id: SFX_BITS.id, label: SFX_BITS.label, provider: SFX_BITS.provider, candidates: SFX_BITS.candidates },
        { id: ICON.id, label: ICON.label, provider: ICON.provider, candidates: ICON.candidates },
        { id: SPRITE.id, label: SPRITE.label, provider: SPRITE.provider, candidates: SPRITE.candidates },
        { id: SFX.id, label: SFX.label, provider: SFX.provider, candidates: SFX.candidates },
      ],
      keys: { elevenlabs: elevenKey.length > 0, openai: openaiKey.length > 0 },
      iconFiles,
      sfxFiles,
      spriteFiles,
    };
  };

  const expand = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson<ExpandRequest>(req);
    const spec = sfxSpec(body.type);
    if (!spec) return json(res, 400, { error: `unknown asset type "${body.type}"` });
    const subject = (body.subject ?? "").trim();
    if (!subject) return json(res, 400, { error: "subject is required" });
    if (!openaiKey)
      return json(res, 503, {
        error:
          "OPENAI_API_KEY is missing — add it to apps/realmsmith/.env.local and restart the dev server",
      });
    const duration = clampDuration(body.durationSeconds);
    const user = duration ? `${subject}\n\nTarget length: about ${duration} seconds.` : subject;
    const prompt = await expandPrompt(
      openaiKey,
      EXPANDER_MODEL,
      expanderSystem(spec.soundIdentity),
      user,
    );
    json(res, 200, { prompt } satisfies ExpandResponse);
  };

  /** Image generation (icons + sprites): N transparent PNGs. The panel builds
   * the prompt (it owns the sets) and sends it verbatim; the bare subject
   * fallback below only serves curl/testing. */
  const generateImages = async (
    spec: IconSpec | SpriteSpec,
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
      Array.from({ length: spec.candidates }, () => generateImage(openaiKey, prompt, spec.size)),
    );
    const candidates: Candidate[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled")
        candidates.push({ id: candidates.length, mime: "image/png", b64: r.value.toString("base64") });
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
    if (!elevenKey)
      return json(res, 503, {
        error:
          "ELEVENLABS_API_KEY is missing — add it to apps/realmsmith/.env.local and restart the dev server",
      });

    // An explicit prompt (the panel's editable box — hand-written or LLM-expanded)
    // is sent verbatim; otherwise the style-bible template seeds from the subject.
    const prompt = (body.prompt ?? "").trim().slice(0, 800) || spec.template(subject);
    const durationSeconds = clampDuration(body.durationSeconds);
    const promptInfluence = clampInfluence(body.promptInfluence) ?? spec.promptInfluence;
    const settled = await Promise.allSettled(
      Array.from({ length: spec.candidates }, () =>
        generateSfx(elevenKey, { text: prompt, durationSeconds, promptInfluence }),
      ),
    );
    const candidates: Candidate[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled")
        candidates.push({ id: candidates.length, mime: "audio/mpeg", b64: r.value.toString("base64") });
    }
    if (candidates.length === 0) {
      const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      return json(res, 502, { error: `generation failed: ${first ? String(first.reason) : "unknown"}` });
    }
    json(res, 200, { prompt, candidates } satisfies GenerateResponse);
  };

  /** Image save (icons + sprites): one PNG per id, overwritten on regeneration;
   * sidecar refreshed. */
  const saveImage = async (
    spec: IconSpec | SpriteSpec,
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
    await writeFile(join(dir, file), await processIcon(raw, spec.savedSize));

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
      params: { size: spec.size, quality: "medium", background: "transparent", savedSize: spec.savedSize },
      files: [file],
      created,
      updated: now,
    };
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

    json(res, 200, {
      files: [file],
      sidecar: `${spec.destination}/${id}.forge.json`,
      // The require-map line for the consuming module (one src/ level deep).
      manifestLines: [`  "${id}": require("${spec.manifestDir}/${file}"),`],
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
    const takes = Array.isArray(body.takes)
      ? body.takes.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [];
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
    const now = new Date().toISOString();
    let created = now;
    let prevFiles: string[] = [];
    if (existsSync(sidecarPath)) {
      try {
        const prev = JSON.parse(await readFile(sidecarPath, "utf8")) as {
          created?: unknown;
          files?: unknown;
        };
        if (typeof prev.created === "string") created = prev.created;
        if (Array.isArray(prev.files))
          prevFiles = prev.files.filter((f): f is string => typeof f === "string");
      } catch {
        /* unreadable sidecar → rewrite it */
      }
    }
    const sidecar = {
      type: spec.id,
      subject: body.subject ?? "",
      prompt: body.prompt ?? "",
      provider: spec.provider,
      model: SFX_MODEL_ID,
      params: {
        durationSeconds: clampDuration(body.durationSeconds) ?? null,
        promptInfluence: clampInfluence(body.promptInfluence) ?? spec.promptInfluence,
        loudnessLufs: spec.loudnessLufs,
        truePeakDb: spec.truePeakDb,
      },
      files: [...prevFiles, ...files],
      created,
      updated: now,
    };
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

    const manifestLines = files.map(
      (f) => `  ${f.replace(/\.mp3$/, "")}: require("${spec.manifestDir}/${f}"),`,
    );
    json(res, 200, {
      files,
      sidecar: `${spec.destination}/${base}.forge.json`,
      manifestLines,
    } satisfies SaveResponse);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Mounted at /forge, so req.url arrives with that prefix stripped.
    const url = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && url === "/status") return json(res, 200, await status());
    if (req.method === "POST" && url === "/expand") return expand(req, res);
    if (req.method === "POST" && url === "/generate") return generate(req, res);
    if (req.method === "POST" && url === "/save") return save(req, res);
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
    },
    configureServer(server) {
      server.middlewares.use("/forge", (req, res, next) => {
        // Only claim the actual endpoints. Everything else under /forge/ is
        // Vite serving this very directory as browser modules (the panel
        // imports styleBible.ts at runtime) — pass it through.
        const url = (req.url ?? "").split("?")[0];
        const isEndpoint =
          (req.method === "GET" && url === "/status") ||
          (req.method === "POST" && (url === "/expand" || url === "/generate" || url === "/save"));
        if (!isEndpoint) return next();
        void handle(req, res).catch((e: unknown) => {
          if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        });
      });
    },
  };
};
