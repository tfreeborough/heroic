/**
 * The story under every Save: each video's journal, posted as a comment
 * from our own channel (docs/design/save-point-channel.md, § Story
 * comments). Runs on a Render cron shortly after the 8 AM go-live, and
 * once by hand to backfill. Idempotent: a video that already has a
 * top-level comment from us is left alone, so a run can repeat.
 *
 *   bun scripts/comments.ts stories     # no credentials: which slot has which story
 *   bun scripts/comments.ts auth        # once, locally: mint the refresh token
 *   bun scripts/comments.ts             # dry run: what would be posted
 *   bun scripts/comments.ts --post      # post them
 *
 * Env: YT_CLIENT_ID, YT_CLIENT_SECRET (a Google OAuth "Desktop app"
 * client), YT_REFRESH_TOKEN (from `auth`). No packages: plain fetch
 * against the Data API. YouTube only; TikTok's comment endpoint sits
 * behind Business Messaging access, which is not offered to UK accounts.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Ledger } from "../src/eggs";
import type { SaveSidecar } from "./sync-library";

const root = join(import.meta.dir, "..");
const SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const API = "https://www.googleapis.com/youtube/v3";

// ── the stories: slot → save name → journal ──────────────────────────────────

const wordsOf = (meta: SaveSidecar) => [meta.tagline, meta.title, meta.memory].map((w) => (w ?? "").trim()).filter(Boolean);
type Story = { slot: number; name: string; /** The words a title might carry: tagline, title, memory. */ words: string[]; journal: string };

/** Every slot the ledger knows, with its save's words if the sidecar is here. */
const stories = (): Story[] => {
  const ledger = JSON.parse(readFileSync(join(root, "public/slots.json"), "utf8")) as Ledger;
  return ledger.slots.map((e) => {
    const name = e.batch.replace(/^slot-\d+-/, "");
    const side = join(root, "public/saves", `${name}.json`);
    const meta = existsSync(side) ? (JSON.parse(readFileSync(side, "utf8")) as SaveSidecar) : {};
    return { slot: e.slot, name, words: wordsOf(meta), journal: (meta.journal ?? "").trim() };
  });
};

/** Saves not in the ledger yet (their sidecar is here, nothing rendered), matched by tagline only. */
const unslotted = (known: Set<string>): Story[] =>
  readdirSync(join(root, "public/saves"))
    .filter((f) => f.endsWith(".json") && !known.has(f.slice(0, -5)))
    .map((f) => {
      const meta = JSON.parse(readFileSync(join(root, "public/saves", f), "utf8")) as SaveSidecar;
      return { slot: 0, name: f.slice(0, -5), words: wordsOf(meta), journal: (meta.journal ?? "").trim() };
    });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The story a video is, from its title "Save 07: <words>". The words win
 * (a save's tagline, title or memory, as typed): a slot in the ledger can
 * be stale when a save was renamed or re-rendered. Then the slot number.
 */
const storyFor = (title: string, all: Story[]): Story | undefined => {
  const after = title.includes(":") ? title.slice(title.indexOf(":") + 1) : title;
  const t = norm(after);
  const byWords = t ? all.find((s) => s.words.some((w) => norm(w) === t)) : undefined;
  if (byWords) return byWords;
  const m = /^save\s*(\d+)\b/i.exec(title.trim());
  return m ? all.find((s) => s.slot === Number(m[1])) : undefined;
};

// ── Google OAuth ─────────────────────────────────────────────────────────────

/** The Desk's env file holds the keys locally (Bun only reads the .env beside the cwd); Render sets them itself. */
const DESK_ENV = join(root, "../desk/.env");
const fromDeskEnv = (): Record<string, string> => {
  if (!existsSync(DESK_ENV)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(DESK_ENV, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
};
const env = (k: string) => {
  const v = process.env[k] || fromDeskEnv()[k];
  if (!v) throw new Error(`no ${k} in the environment or apps/desk/.env`);
  return v;
};

/** A fresh access token from the refresh token. */
const accessToken = async () => {
  const body = new URLSearchParams({ client_id: env("YT_CLIENT_ID"), client_secret: env("YT_CLIENT_SECRET"), refresh_token: env("YT_REFRESH_TOKEN"), grant_type: "refresh_token" });
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`token refresh failed: ${data.error ?? res.status} ${data.error_description ?? ""}`.trim());
  return data.access_token;
};

/**
 * The one-off: open Google's consent page, catch the code on a loopback
 * port, swap it for a refresh token, print it. The OAuth client must be
 * a "Desktop app" and the consent screen "In production" (a "Testing"
 * app's refresh token dies after 7 days).
 */
const auth = async () => {
  const clientId = env("YT_CLIENT_ID");
  const clientSecret = env("YT_CLIENT_SECRET");
  const port = 48123;
  const redirect = `http://127.0.0.1:${port}/`;
  const code = await new Promise<string>((resolve, reject) => {
    const server = Bun.serve({
      port,
      fetch(req) {
        const u = new URL(req.url);
        const c = u.searchParams.get("code");
        const e = u.searchParams.get("error");
        setTimeout(() => server.stop(true), 100);
        if (c) resolve(c);
        else reject(new Error(`consent failed: ${e ?? "no code"}`));
        return new Response(c ? "Signed in. You can close this tab and go back to the terminal." : `Google said: ${e}`, { headers: { "content-type": "text/plain" } });
      },
    });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent" }).toString();
    console.log(`Open this in the browser signed in as the Autosave channel:\n\n${url}\n`);
    Bun.spawn(["open", url.toString()]).unref();
  });
  const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code" });
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const data = (await res.json()) as { refresh_token?: string; error?: string; error_description?: string };
  if (!data.refresh_token) throw new Error(`no refresh token back: ${data.error ?? res.status} ${data.error_description ?? ""}`.trim());
  console.log(`YT_REFRESH_TOKEN=${data.refresh_token}\n\nPut that in apps/desk/.env for local runs and in the Render cron's environment.`);
};

// ── the Data API ─────────────────────────────────────────────────────────────

type Video = { id: string; title: string; privacy: string; publishedAt: string };

const yt = async <T>(token: string, method: "GET" | "POST", path: string, query: Record<string, string>, body?: unknown): Promise<T> => {
  const url = `${API}/${path}?${new URLSearchParams(query)}`;
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json()) as T & { error?: { code: number; message: string; errors?: { reason: string }[] } };
  if (!res.ok) throw new Error(`${path}: ${data.error?.errors?.[0]?.reason ?? res.status} ${data.error?.message ?? ""}`.trim());
  return data;
};

/** Our channel id and its uploads playlist. */
const channel = async (token: string) => {
  const r = await yt<{ items?: { id: string; snippet: { title: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(token, "GET", "channels", { part: "snippet,contentDetails", mine: "true" });
  const c = r.items?.[0];
  if (!c) throw new Error("the signed-in account has no channel");
  return { id: c.id, name: c.snippet.title, uploads: c.contentDetails.relatedPlaylists.uploads };
};

/** Every upload, with its privacy (scheduled ones are private until they go live). */
const uploads = async (token: string, playlist: string): Promise<Video[]> => {
  const ids: string[] = [];
  let pageToken = "";
  do {
    const r = await yt<{ items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(token, "GET", "playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    ids.push(...(r.items ?? []).map((i) => i.contentDetails.videoId));
    pageToken = r.nextPageToken ?? "";
  } while (pageToken);
  const out: Video[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt<{ items?: { id: string; snippet: { title: string; publishedAt: string }; status: { privacyStatus: string } }[] }>(token, "GET", "videos", { part: "snippet,status", id: ids.slice(i, i + 50).join(",") });
    out.push(...(r.items ?? []).map((v) => ({ id: v.id, title: v.snippet.title, privacy: v.status.privacyStatus, publishedAt: v.snippet.publishedAt })));
  }
  return out.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
};

/** Whether we already left a top-level comment on this video ("" = comments are off). */
const ourComment = async (token: string, videoId: string, channelId: string): Promise<boolean | ""> => {
  let pageToken = "";
  try {
    do {
      const r = await yt<{ items?: { snippet: { topLevelComment: { snippet: { authorChannelId?: { value: string } } } } }[]; nextPageToken?: string }>(token, "GET", "commentThreads", { part: "snippet", videoId, maxResults: "100", textFormat: "plainText", ...(pageToken ? { pageToken } : {}) });
      if ((r.items ?? []).some((t) => t.snippet.topLevelComment.snippet.authorChannelId?.value === channelId)) return true;
      pageToken = r.nextPageToken ?? "";
    } while (pageToken);
  } catch (e) {
    if (/commentsDisabled/.test(String(e))) return "";
    throw e;
  }
  return false;
};

const post = (token: string, videoId: string, channelId: string, text: string) =>
  yt(token, "POST", "commentThreads", { part: "snippet" }, { snippet: { channelId, videoId, topLevelComment: { snippet: { textOriginal: text } } } });

// ── the run ──────────────────────────────────────────────────────────────────

const run = async (live: boolean) => {
  const slotted = stories();
  const all = [...slotted, ...unslotted(new Set(slotted.map((s) => s.name)))];
  const token = await accessToken();
  const me = await channel(token);
  const videos = await uploads(token, me.uploads);
  console.log(`${me.name}: ${videos.length} upload${videos.length === 1 ? "" : "s"}, ${all.length} stories on file${live ? "" : " (dry run: add --post to post)"}`);
  let posted = 0;
  for (const v of videos) {
    const tag = `${v.id}  ${v.title}`;
    if (v.privacy !== "public") {
      console.log(`  skip  ${tag}  (${v.privacy})`);
      continue;
    }
    const story = storyFor(v.title, all);
    if (!story) {
      console.log(`  ????  ${tag}  (no save matches this title)`);
      continue;
    }
    if (!story.journal) {
      console.log(`  none  ${tag}  (${story.name} has no journal yet)`);
      continue;
    }
    const have = await ourComment(token, v.id, me.id);
    if (have === "") console.log(`  off   ${tag}  (comments are off)`);
    else if (have) console.log(`  done  ${tag}`);
    else if (!live) console.log(`  would ${tag}  ← ${story.name}, ${story.journal.length} chars`);
    else {
      await post(token, v.id, me.id, story.journal);
      posted++;
      console.log(`  POSTED ${tag}  ← ${story.name}`);
    }
  }
  console.log(live ? `posted ${posted}` : "nothing posted (dry run)");
};

/** The mapping alone, offline: every ledger slot and whether a story is on file for it. */
const listStories = () => {
  const slotted = stories();
  for (const s of slotted) console.log(`  Save ${String(s.slot).padStart(2, "0")}  ${s.name.padEnd(16)} ${s.journal ? `${s.journal.length} chars` : s.words.length ? "NO JOURNAL" : "NO SIDECAR"}`);
  const rest = unslotted(new Set(slotted.map((s) => s.name)));
  if (rest.length) console.log(`  not rendered yet: ${rest.map((s) => s.name).join(", ")}`);
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const task = args[0] === "auth" ? auth() : args[0] === "stories" ? Promise.resolve(listStories()) : run(args.includes("--post"));
  task.catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
