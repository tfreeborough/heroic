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
import { EXPANDER, SFX } from "./styleBible";
import { SFX_MODEL_ID, generateSfx } from "./elevenlabs";
import { expandPrompt } from "./openai";
import { processSfx } from "./audio";
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

  const status = (): ForgeStatus => ({
    types: [{ id: SFX.id, label: SFX.label, provider: SFX.provider, candidates: SFX.candidates }],
    keys: { elevenlabs: elevenKey.length > 0, openai: openaiKey.length > 0 },
  });

  const expand = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson<ExpandRequest>(req);
    if (body.type !== SFX.id) return json(res, 400, { error: `unknown asset type "${body.type}"` });
    const subject = (body.subject ?? "").trim();
    if (!subject) return json(res, 400, { error: "subject is required" });
    if (!openaiKey)
      return json(res, 503, {
        error:
          "OPENAI_API_KEY is missing — add it to apps/realmsmith/.env.local and restart the dev server",
      });
    const duration = clampDuration(body.durationSeconds);
    const user = duration ? `${subject}\n\nTarget length: about ${duration} seconds.` : subject;
    const prompt = await expandPrompt(openaiKey, EXPANDER.model, EXPANDER.system, user);
    json(res, 200, { prompt } satisfies ExpandResponse);
  };

  const generate = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson<GenerateRequest>(req);
    if (body.type !== SFX.id) return json(res, 400, { error: `unknown asset type "${body.type}"` });
    const subject = (body.subject ?? "").trim();
    if (!subject) return json(res, 400, { error: "subject is required" });
    if (!elevenKey)
      return json(res, 503, {
        error:
          "ELEVENLABS_API_KEY is missing — add it to apps/realmsmith/.env.local and restart the dev server",
      });

    // An explicit prompt (the panel's editable box — hand-written or LLM-expanded)
    // is sent verbatim; otherwise the style-bible template seeds from the subject.
    const prompt = (body.prompt ?? "").trim().slice(0, 800) || SFX.template(subject);
    const durationSeconds = clampDuration(body.durationSeconds);
    const promptInfluence = clampInfluence(body.promptInfluence) ?? SFX.promptInfluence;
    const settled = await Promise.allSettled(
      Array.from({ length: SFX.candidates }, () =>
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

  const save = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readJson<SaveRequest>(req);
    if (body.type !== SFX.id) return json(res, 400, { error: `unknown asset type "${body.type}"` });
    const base = body.baseName ?? "";
    if (!NAME_RE.test(base) || base.length > 48)
      return json(res, 400, {
        error: "name must be snake_case — lowercase letters/digits/underscores, starting with a letter",
      });
    const takes = Array.isArray(body.takes)
      ? body.takes.filter((t): t is string => typeof t === "string" && t.length > 0)
      : [];
    if (takes.length === 0) return json(res, 400, { error: "no takes selected" });

    const dir = join(repoRoot, SFX.destination);
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
      const processed = await processSfx(raw, SFX.loudnessLufs, SFX.truePeakDb);
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
      type: SFX.id,
      subject: body.subject ?? "",
      prompt: body.prompt ?? "",
      provider: SFX.provider,
      model: SFX_MODEL_ID,
      params: {
        durationSeconds: clampDuration(body.durationSeconds) ?? null,
        promptInfluence: clampInfluence(body.promptInfluence) ?? SFX.promptInfluence,
        loudnessLufs: SFX.loudnessLufs,
        truePeakDb: SFX.truePeakDb,
      },
      files: [...prevFiles, ...files],
      created,
      updated: now,
    };
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

    const manifestLines = files.map(
      (f) => `  ${f.replace(/\.mp3$/, "")}: require("../../../assets/audio/sfx/${f}"),`,
    );
    json(res, 200, {
      files,
      sidecar: `${SFX.destination}/${base}.forge.json`,
      manifestLines,
    } satisfies SaveResponse);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Mounted at /forge, so req.url arrives with that prefix stripped.
    const url = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && url === "/status") return json(res, 200, status());
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
      server.middlewares.use("/forge", (req, res) => {
        void handle(req, res).catch((e: unknown) => {
          if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
        });
      });
    },
  };
};
