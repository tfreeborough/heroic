/**
 * The Saves tab's server side (docs/design/save-point-channel.md, stage 4):
 * picture ideas and words from Claude, pictures from GPT Image, and the
 * finished save written into public/saves. The Desk loads this file by
 * path at start and mounts each route at /api/autosave/x/<name>.
 *
 * Keys come from apps/desk/.env (ANTHROPIC_API_KEY, OPENAI_API_KEY), which
 * Bun loads for the Desk. Everything Claude writes is a draft: the boxes
 * on the tab are Tom's, and the sidecar keeps what's in them at Save.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { generateImage } from "@heroic/forge";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { GameRoutes } from "../desk/game";
import { exec } from "../desk/lib/exec";
import * as hints from "./scripts/hints";
import { type SaveMusic, type SaveSidecar, syncLibrary } from "./scripts/sync-library";
import { MOODS, MOOD_NOTES, STYLE_NAMES, STYLE_NOTES } from "@heroic/music";
import { TAGLINE_MAX } from "./src/words";
import { EMPTY_LEDGER, type Ledger, forget, playtimeFor, record, resolveEgg } from "./src/eggs";
import { TUNE, type TuneProps, tuneFile, tuneFor } from "./src/music/tune";

const SAVES = join(import.meta.dir, "public/saves");
const MUSIC = join(import.meta.dir, "public/music");

/** Generated tunes kept (newest first): every memory edit makes a new one, so the folder is trimmed. */
const KEEP_TUNES = 40;
const trimTunes = () => {
  const dir = join(MUSIC, "generated");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.endsWith(".wav")).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }));
  for (const { f } of files.sort((a, b) => b.t - a.t).slice(KEEP_TUNES)) rmSync(join(dir, f));
};

/** Tunes being made right now, by file, so a second ask waits on the first. */
const making = new Map<string, Promise<{ file?: string; error?: string }>>();
const DRAFTS = join(SAVES, "drafts");
const ASCII = join(SAVES, "ascii");
const RETIRED = join(import.meta.dir, "retired");
/** The Desk's finished videos for Autosave (desk.config rendersDir), read to say which saves are made. */
const RENDERS = join(import.meta.dir, "out/desk");
const MODEL = "claude-opus-5-5";
/** Pictures per Generate press. */
const ROUND = 3;

/** The look that reads as glyphs. Glyphs grow where the picture is WHITE, so the subject is carved out by
 * light (a black silhouette builds as a hole). Full bleed with the frame's edges in shadow: the black builds as
 * nothing (ascii-build shadow "auto"), so the lit parts float on the screen with the dither edge. Tom turned down
 * the vignette circle and irregular cut-outs (10-10 re-shoot test; the old "large and centred" line made flat
 * catalogue shots). */
const STYLE =
  "Black ink woodcut / linocut print on plain white paper, framed like a still from a film with a deliberate camera angle. " +
  "Chiaroscuro: one strong light source carves the subject out of darkness, so the lit faces, hands and surfaces are bright white and carry the detail, " +
  "the shadow side falls into solid black. The subject is drawn by light, never as a flat black silhouette. " +
  "The dark scene runs right off every edge of the frame, full bleed, and the edges of the frame fall into solid black shadow: nothing lit touches the border. " +
  "No circle, oval or vignette, no white paper showing. Big simple shapes, high contrast, no mid-grey, no text, no border.";

export type Words = { memory: string[]; tagline: string[] };
export type Draft = {
  id: string;
  created: number;
  /** Tom's idea in his own words, if he gave one. */
  idea: string;
  /** What the picture model is asked for (the style is added on top). */
  prompt: string;
  /** Under public/, newest last. */
  pictures: string[];
  /** Pictures still being made (this Desk run only). */
  pending: number;
  errors: string[];
  chosen?: string;
  /** Claude's options; the boxes below are what Tom has made of them. */
  words?: Words;
  memory: string;
  tagline: string;
  title: string;
  journal: string;
  name: string;
};

const pending = new Map<string, number>();
const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");
const draftFile = (id: string) => join(DRAFTS, safe(id), "draft.json");
const read = (id: string): Draft | undefined => {
  const f = draftFile(id);
  return existsSync(f) ? { ...(JSON.parse(readFileSync(f, "utf8")) as Draft), pending: pending.get(id) ?? 0 } : undefined;
};
/** Read, change, write: small and synchronous, so two pictures landing together can't lose one. */
const change = (id: string, fn: (d: Draft) => void): Draft => {
  const d = read(id);
  if (!d) throw new Error("that draft has gone");
  fn(d);
  writeFileSync(draftFile(id), JSON.stringify({ ...d, pending: 0 }, null, 2));
  return { ...d, pending: pending.get(id) ?? 0 };
};
const list = (): Draft[] =>
  existsSync(DRAFTS)
    ? readdirSync(DRAFTS)
        .map((id) => read(id))
        .filter((d): d is Draft => Boolean(d))
        .sort((a, b) => b.created - a.created)
    : [];

const body = async <T>(req: Request) => (await req.json()) as T;
const clean = (s: string) => s.replace(/—/g, ", ").replace(/\s+/g, " ").trim();

/** Kick off a round of pictures; each is saved onto the draft as it lands. */
const generate = (id: string, prompt: string) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("no OPENAI_API_KEY in apps/desk/.env");
  pending.set(id, (pending.get(id) ?? 0) + ROUND);
  for (let i = 0; i < ROUND; i++) {
    void generateImage(key, `${prompt.trim()} ${STYLE}`, "1024x1024", "opaque")
      .then((png) => {
        const dir = join(DRAFTS, safe(id));
        let n = 1;
        while (existsSync(join(dir, `${n}.png`))) n++;
        writeFileSync(join(dir, `${n}.png`), png);
        change(id, (d) => d.pictures.push(`saves/drafts/${safe(id)}/${n}.png`));
      })
      .catch((e: Error) => {
        if (read(id)) change(id, (d) => d.errors.push(e.message.slice(0, 300)));
      })
      .finally(() => pending.set(id, Math.max(0, (pending.get(id) ?? 1) - 1)));
  }
};

// ── Claude ──

const ABOUT = [
  "Autosave (@autosave.ascii) is a TikTok channel run by one person, Tom. Every video is a fake video-game save screen:",
  "'Please wait while we save your progress.' A picture builds itself out of green ASCII characters, Matrix style, while a save bar fills,",
  "then 'Save complete. You may now continue scrolling.' A line labelled MEMORY reveals what the picture was. Each video is a numbered save slot.",
  "The mood: quiet, nostalgic, a little cryptic, like the save points in old games, but the saves are ordinary moments of a life as much as places.",
].join(" ");

const VOICE = [
  "Write like Tom talking: plain, British spelling, everyday words, dry and a little wistful. No em dashes, no exclamation marks, no emoji,",
  "no hashtags, no ALL CAPS, no slogans or three-beat lists, nothing that sounds like an advert.",
].join(" ");

const ask = async <T extends z.ZodTypeAny>(system: string, content: Anthropic.MessageParam["content"], out: T, effort: "low" | "medium" = "low"): Promise<z.infer<T>> => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("no ANTHROPIC_API_KEY in apps/desk/.env");
  const res = await new Anthropic().messages.parse({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort, format: zodOutputFormat(out) },
    system,
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined this one");
  const parsed = res.parsed_output as z.infer<T> | null;
  if (!parsed) throw new Error(`nothing usable came back (stop reason ${res.stop_reason})`);
  return parsed;
};

// ── a save's music: Claude picks the mood and styles from the picture and words ──

const MusicChoice = z.object({
  mood: z.enum(MOODS).describe("The one mood that fits best."),
  styles: z.array(z.enum(STYLE_NAMES as [string, ...string[]])).min(3).max(3).describe("The three arrangements that fit best, best first, all different."),
  why: z.string().describe("One short plain sentence on what in the picture and words led there."),
});

const MUSIC_SYSTEM = [
  "You choose the background music for a short looping video: a picture builds itself out of glyphs while a game saves, and the memory it's of is revealed at the end.",
  "The music is generated from a fixed menu, so you choose from it: one mood (the harmony, tempo and feel) and three arrangements (the instruments), best first.",
  "Go by what the picture shows and what the memory is about: its place, era, time of day and feeling. Fit the scene, not the surface words (a place name isn't a hint about racing).",
  "The three arrangements should all suit it, and differ from each other enough to be real alternatives.",
  "",
  "Moods:",
  ...MOODS.map((m) => `- ${m}: ${MOOD_NOTES[m]}`),
  "",
  "Arrangements:",
  ...STYLE_NAMES.map((s) => `- ${s}: ${STYLE_NOTES[s]}`),
].join("\n");

const sidecarOf = (n: string): SaveSidecar => {
  const side = join(SAVES, `${n}.json`);
  return existsSync(side) ? (JSON.parse(readFileSync(side, "utf8")) as SaveSidecar) : {};
};

/** Choices being made right now, by save, so a second ask waits on the first. */
const choosing = new Map<string, Promise<SaveMusic>>();

/** Asks Claude for a save's music and keeps it in the sidecar. */
const chooseMusic = (n: string): Promise<SaveMusic> => {
  let job = choosing.get(n);
  if (job) return job;
  job = (async () => {
    const png = join(SAVES, `${n}.png`);
    if (!existsSync(png)) throw new Error(`no save called ${n}`);
    const side = sidecarOf(n);
    const words = [
      `Memory: ${side.memory ?? n}`,
      side.tagline && `Tagline: ${side.tagline}`,
      side.prompt && `The picture was drawn from: ${side.prompt}`,
      side.journal && `Journal:\n${side.journal}`,
    ].filter(Boolean).join("\n\n");
    const out = await ask(MUSIC_SYSTEM, [
      { type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(png).toString("base64") } },
      { type: "text", text: words },
    ], MusicChoice);
    const music: SaveMusic = { mood: out.mood, styles: [...new Set(out.styles)], why: out.why.trim() };
    // Read again: the words may have been edited while Claude was thinking.
    writeFileSync(join(SAVES, `${n}.json`), JSON.stringify({ ...sidecarOf(n), music }, null, 2) + "\n");
    return music;
  })().finally(() => choosing.delete(n));
  choosing.set(n, job);
  return job;
};

/** A save's music as the Save template's props. */
const musicProps = (m: SaveMusic) => ({ tuneMood: m.mood, tuneStyles: m.styles.join(","), tuneWhy: m.why });

const Ideas = z.object({
  ideas: z.array(z.string()).min(6).max(6).describe("Six picture prompts, one sentence each."),
});

const suggest = async (idea: string): Promise<string[]> => {
  const have = syncLibrary().saves.map((s) => `- ${s.prompt || s.memory}`);
  const out = await ask(
    [
      ABOUT,
      "",
      "You suggest what the next saves could be a picture of. Each suggestion is a prompt for an image model, one plain sentence.",
      "Write it as a shot from a film, not a catalogue photo. Each prompt says where the camera is (low, over a shoulder, close on hands, from inside the screen looking out),",
      "what single light source there is (a screen, a lamp, a window, moonlight, a torch) and what it falls on, and the small human moment: a face, hands, someone waiting.",
      "Light matters most: what the light falls on is what shows, so faces and hands lit by the light source read best; a dark figure against a bright background reads badly.",
      "What reads well: one or two subjects, a few big shapes, a face lit up. What reads badly: busy scenes, crowds, maps, small detail, wide landscapes, text, anything that needs colour.",
      "No style words (the style is added for you). No text in the picture. Mix places with moments: a first bike, a late night, a waiting room, a lighthouse.",
    ].join("\n"),
    [
      idea.trim() ? `Tom's idea, riff on it (six different takes): ${idea.trim()}` : "Six ideas of your own, all different from each other.",
      "",
      "Already made (don't repeat these):",
      ...have,
    ].join("\n"),
    Ideas,
  );
  return out.ideas.map(clean);
};

const WordsOut = z.object({
  memory: z.array(z.string()).min(3).max(3).describe("Three MEMORY lines: first short (2 to 5 words, like 'The quiet hours'), then a medium one, then a longer descriptive one up to 110 characters. Sentence case, no full stop at the end."),
  tagline: z.array(z.string()).min(3).max(3).describe(`Three one-line captions for under the video, each under ${TAGLINE_MAX} characters (TikTok cuts it there). Dry, a little cryptic, can talk to the viewer. The first few words must work on their own.`),
});

const write = async (d: Draft, picture: string): Promise<Words> => {
  const png = readFileSync(join(import.meta.dir, "public", picture));
  const examples = syncLibrary().saves.filter((s) => !s.file.includes("/drafts/")).map((s) => `- MEMORY: ${s.memory}${s.tagline ? ` | tagline: ${s.tagline}` : ""}`);
  const out = await ask(
    [
      ABOUT,
      "",
      VOICE,
      "",
      "You write the words for one save: the MEMORY line revealed on screen, and the tagline, the one line posted under the video (YouTube's title as 'Save 07: <tagline>', the start of TikTok's caption).",
      "The tagline shows from the first second while the picture is still building, so it must not give the memory away: it sets up the reveal, it doesn't spoil it.",
      "Look at the picture itself: write about what's actually there, as a memory someone might have of it, not a description of an illustration.",
      "Never mention ASCII, pixels, drawings, characters or the video. Don't explain the joke.",
      "",
      "Saves Tom has already made, so you hear the voice:",
      ...examples,
    ].join("\n"),
    [
      { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
      { type: "text", text: [d.idea.trim() ? `Tom's idea: ${d.idea.trim()}` : "", `The prompt the picture came from: ${d.prompt}`].filter(Boolean).join("\n") },
    ],
    WordsOut,
  );
  return { memory: out.memory.map(clean), tagline: out.tagline.map(clean) };
};

const JournalOut = z.object({
  journal: z.string().describe("The journal entry: one to three short paragraphs, plain text, no headings."),
});

/** One journal entry to start from. Tom's own is the point; this is for when he's stuck. */
const writeJournal = async (d: Draft, picture: string): Promise<string> => {
  const png = readFileSync(join(import.meta.dir, "public", picture));
  const out = await ask(
    [
      ABOUT,
      "",
      VOICE,
      "",
      "You write the JOURNAL for one save: the longer text behind TikTok's 'more' button, under the short tagline. It's a reward for the people who tap.",
      "It can be a small story, a fragment of a save file, a note someone left, a log entry, a half-remembered detail. Specific and concrete beats grand.",
      "One to three short paragraphs. It mustn't repeat the memory or the tagline; it goes somewhere they don't. Never mention ASCII, pixels, drawings or the video.",
    ].join("\n"),
    [
      { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
      { type: "text", text: [`MEMORY (on screen): ${d.memory || "(not written yet)"}`, `Tagline (above the journal): ${d.tagline || "(not written yet)"}`, `The prompt the picture came from: ${d.prompt}`].join("\n") },
    ],
    JournalOut,
  );
  return out.journal.replace(/—/g, ", ").trim();
};

// ── retelling in Tom's voice: a second pass over anything Claude drafted ──

/** The saves Tom wrote himself (slots 5 to 16). Add a name when you've written one; never a drafted or retold one. */
const OWN_SAVES = ["daytona", "first-flight", "judicium", "going-for-goal", "herding", "rain", "obliteration", "expedition", "snow-day", "strangers-kindness", "the-creature", "seasons"];

const RetellOut = z.object({
  journal: z.string().describe("The retold journal: plain text, paragraphs separated by a blank line, no headings, no preamble."),
});

/** Tom's own journals, in full, for the retell step to copy the rhythm of. */
const ownJournals = (): string[] =>
  OWN_SAVES.flatMap((name) => {
    const f = join(SAVES, `${name}.json`);
    if (!existsSync(f)) return [];
    const side = JSON.parse(readFileSync(f, "utf8")) as SaveSidecar;
    return side.journal?.trim() ? [`### ${name}\n${side.journal.trim()}`] : [];
  });

/** Retell a journal so it reads as Tom's: same facts and order, his sentences and his kind of ending. voice.md says how. */
const retell = async (journal: string): Promise<string> => {
  const sheet = readFileSync(join(import.meta.dir, "voice.md"), "utf8");
  const out = await ask(
    [
      ABOUT,
      "",
      "You retell one journal entry (the text behind TikTok's 'more' button) so it reads as if Tom wrote it himself.",
      "The guide below says how he writes and what gives a draft away, and his own journals follow in full: match their rhythm, not their subjects.",
      "Keep every fact, name, number and the order of events. Change the sentences, the hedging, the fillers and the ending. Roughly the same length.",
      "Never mention ASCII, pixels, drawings or the video.",
      "",
      sheet.trim(),
      "",
      "## Tom's own journals, in full",
      "",
      ...ownJournals(),
    ].join("\n"),
    [{ type: "text", text: `Retell this as Tom:\n\n${journal.trim()}` }],
    RetellOut,
    "medium",
  );
  return out.journal.replace(/—/g, ", ").trim();
};

const writeAscii = (name: string, base64: string) => {
  mkdirSync(ASCII, { recursive: true });
  writeFileSync(join(ASCII, `${name}.png`), Buffer.from(base64.replace(/^data:image\/png;base64,/, ""), "base64"));
};

/** Which pictures have been rendered, as which slots: picture file → slot numbers. */
const madeSlots = () => {
  const made = new Map<string, number[]>();
  if (!existsSync(RENDERS)) return made;
  for (const f of readdirSync(RENDERS).filter((x) => x.endsWith(".json") && x !== "schedule.json")) {
    try {
      const r = JSON.parse(readFileSync(join(RENDERS, f), "utf8")) as { props?: { image?: string; slot?: number } };
      if (r.props?.image) made.set(r.props.image, [...new Set([...(made.get(r.props.image) ?? []), r.props.slot ?? 0])].sort((a, b) => a - b));
    } catch {}
  }
  return made;
};

// ── routes ──

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

type Fields = Partial<Pick<Draft, "idea" | "prompt" | "chosen" | "memory" | "tagline" | "title" | "journal" | "name">>;
const FIELDS = ["idea", "prompt", "chosen", "memory", "tagline", "title", "journal", "name"] as const;

// ── the slot ledger (public/slots.json): what each slot was rendered as ──

const LEDGER = join(import.meta.dir, "public/slots.json");
const readLedger = (): Ledger => (existsSync(LEDGER) ? (JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger) : EMPTY_LEDGER);

export const routes: GameRoutes = {
  "GET slots": () => Response.json(readLedger()),

  /** A Save was sent to render: note its slot, its real length, where its clock
   * started and the egg it got (worked out exactly as the video does). */
  "POST slot-rendered": async (req) => {
    const { props, name = "" } = await body<{ props: Record<string, unknown>; name?: string }>(req);
    const slot = Number(props.slot), seconds = Number(props.seconds), seed = Number(props.seed);
    if (!Number.isInteger(slot) || slot < 1 || !(seconds > 0)) return Response.json({ error: "no slot or length" }, { status: 400 });
    const l = readLedger();
    const from = Number(props.playtimeFrom);
    const entry = {
      slot,
      seconds,
      playtimeFrom: from >= 0 ? from : playtimeFor(l, slot),
      egg: resolveEgg(String(props.egg ?? "auto"), slot, seed, l).egg?.id ?? "",
      music: props.music === TUNE ? (tuneFor(props as unknown as TuneProps)?.score.style ?? "") : "",
      batch: name,
      renderedAt: new Date().toISOString(),
    };
    const next = record(l, entry);
    writeFileSync(LEDGER, JSON.stringify(next, null, 2) + "\n");
    return Response.json(next);
  },

  /** The Desk deleted a batch of renders: its slot leaves the ledger (unless another render
   * of that slot is still there), so the next Make press offers it again. */
  "POST batch-deleted": async (req) => {
    const { props = [] } = await body<{ props?: { slot?: number }[] }>(req);
    const still = new Set([...madeSlots().values()].flat());
    const gone = [...new Set(props.map((p) => Number(p.slot)))].filter((n) => n >= 1 && !still.has(n));
    if (!gone.length) return Response.json(readLedger());
    const next = forget(readLedger(), gone);
    writeFileSync(LEDGER, JSON.stringify(next, null, 2) + "\n");
    return Response.json(next);
  },

  "GET drafts": () => Response.json({ drafts: list(), keys: { images: Boolean(process.env.OPENAI_API_KEY), words: Boolean(process.env.ANTHROPIC_API_KEY) } }),

  "POST suggest": async (req) => Response.json({ ideas: await suggest((await body<{ idea?: string }>(req)).idea ?? "") }),

  /** A new draft and its first round of pictures. */
  "POST draft": async (req) => {
    const { idea = "", prompt } = await body<{ idea?: string; prompt: string }>(req);
    if (!prompt?.trim()) return Response.json({ error: "say what to draw first" }, { status: 400 });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    mkdirSync(join(DRAFTS, id), { recursive: true });
    const d: Draft = { id, created: Date.now(), idea, prompt: prompt.trim(), pictures: [], pending: 0, errors: [], memory: "", tagline: "", title: "", journal: "", name: "" };
    writeFileSync(draftFile(id), JSON.stringify(d, null, 2));
    generate(id, d.prompt);
    return Response.json(read(id));
  },

  /** Another round, from the prompt as it stands now. */
  "POST more": async (req) => {
    const { id, prompt } = await body<{ id: string; prompt?: string }>(req);
    const d = change(id, (x) => {
      if (prompt?.trim()) x.prompt = prompt.trim();
      x.errors = [];
    });
    generate(id, d.prompt);
    return Response.json(read(id));
  },

  /** Keep what Tom has typed or picked. */
  "POST update": async (req) => {
    const { id, ...patch } = await body<{ id: string } & Fields>(req);
    return Response.json(
      change(id, (d) => {
        for (const k of FIELDS) if (typeof patch[k] === "string") d[k] = patch[k]!;
      }),
    );
  },

  /** Claude's options for the chosen picture. The boxes are the page's business. */
  "POST words": async (req) => {
    const { id, picture } = await body<{ id: string; picture: string }>(req);
    const d = read(id);
    if (!d) return Response.json({ error: "that draft has gone" }, { status: 404 });
    if (!d.pictures.includes(picture)) return Response.json({ error: "that picture isn't in this draft" }, { status: 400 });
    const words = await write(d, picture);
    return Response.json(change(id, (x) => (x.words = words)));
  },

  /** A journal entry to start from (the page shows it beside Tom's own): drafted, then retold in his voice. */
  "POST journal": async (req) => {
    const { id } = await body<{ id: string }>(req);
    const d = read(id);
    if (!d?.chosen) return Response.json({ error: "pick a picture first" }, { status: 400 });
    return Response.json({ journal: await retell(await writeJournal(d, d.chosen)) });
  },

  /** Any journal text (a draft, an old generated save) retold in Tom's voice. Never writes anything; the page offers the result. */
  "POST retell": async (req) => {
    const { journal } = await body<{ journal: string }>(req);
    if (!journal?.trim()) return Response.json({ error: "nothing to retell" }, { status: 400 });
    return Response.json({ journal: await retell(journal) });
  },

  /** Saves with no glyph copy yet (made before 10-10). */
  "GET missing-ascii": () => Response.json({ saves: syncLibrary().saves.filter((s) => !s.ascii).map((s) => ({ name: s.name, file: s.file })) }),
  /** A glyph copy the page drew: { name, png } (base64). */
  "POST ascii": async (req) => {
    const { name, png } = await body<{ name: string; png: string }>(req);
    if (!existsSync(join(SAVES, `${safe(name)}.png`))) return Response.json({ error: `no save called ${name}` }, { status: 404 });
    writeAscii(safe(name), png);
    syncLibrary();
    return Response.json({ ok: true });
  },

  /** Into the library: the picture, its sidecar, its glyph copy, a re-sync. The draft goes. */
  "POST save": async (req) => {
    const { id, picture, name, memory, tagline, journal = "", ascii } = await body<{ id: string; picture: string; name: string; memory: string; tagline: string; journal?: string; ascii?: string }>(req);
    const d = read(id);
    if (!d) return Response.json({ error: "that draft has gone" }, { status: 404 });
    if (!d.pictures.includes(picture)) return Response.json({ error: "pick a picture first" }, { status: 400 });
    const n = slug(name || memory);
    if (!n || n === "drafts") return Response.json({ error: "give it a name" }, { status: 400 });
    if (existsSync(join(SAVES, `${n}.png`))) return Response.json({ error: `there's already a save called ${n}` }, { status: 409 });
    renameSync(join(import.meta.dir, "public", picture), join(SAVES, `${n}.png`));
    // The journal is kept exactly as written, line breaks and all.
    const side: SaveSidecar = { memory: clean(memory), tagline: clean(tagline), journal: journal.trim(), prompt: d.prompt };
    if (ascii) writeAscii(n, ascii);
    writeFileSync(join(SAVES, `${n}.json`), JSON.stringify(side, null, 2) + "\n");
    rmSync(join(DRAFTS, safe(id)), { recursive: true, force: true });
    syncLibrary();
    // Its music, chosen in the background (the Desk asks again, and waits, if it's needed first).
    void chooseMusic(n).catch(() => {});
    return Response.json({ file: `saves/${n}.png`, ...side });
  },

  /** Every save in the library, newest first, with the slots it's been rendered as. */
  "GET saved": () => {
    const made = madeSlots();
    const saves = syncLibrary().saves.map((s) => ({ ...s, at: statSync(join(import.meta.dir, "public", s.file)).mtimeMs, slots: made.get(s.file) ?? [] }));
    return Response.json({ saves: saves.sort((a, b) => b.at - a.at) });
  },

  /** A saved save's words, changed: its sidecar rewritten (the prompt kept), the library re-synced.
   * Videos already rendered keep the words they were made with. */
  "POST saved-update": async (req) => {
    const { name, memory = "", tagline = "", journal = "" } = await body<{ name: string } & Partial<Record<"memory" | "tagline" | "journal", string>>>(req);
    const n = safe(name);
    if (!existsSync(join(SAVES, `${n}.png`))) return Response.json({ error: `no save called ${name}` }, { status: 404 });
    const side = join(SAVES, `${n}.json`);
    const old = existsSync(side) ? (JSON.parse(readFileSync(side, "utf8")) as SaveSidecar) : {};
    // The music stays as chosen: Choose again on the tab if the new words want different.
    const next: SaveSidecar = { memory: clean(memory), tagline: clean(tagline), journal: journal.trim(), prompt: old.prompt ?? "", ...(old.music && { music: old.music }) };
    writeFileSync(side, JSON.stringify(next, null, 2) + "\n");
    syncLibrary();
    return Response.json(next);
  },

  /** Out of the library into retired/ (gitignored), picture, words and glyph copy. Never one that's been rendered. */
  "POST saved-retire": async (req) => {
    const n = safe((await body<{ name: string }>(req)).name);
    const png = join(SAVES, `${n}.png`);
    if (!existsSync(png)) return Response.json({ error: `no save called ${n}` }, { status: 404 });
    if (madeSlots().has(`saves/${n}.png`)) return Response.json({ error: "that one's been made into a video, so it stays" }, { status: 409 });
    mkdirSync(join(RETIRED, "ascii"), { recursive: true });
    for (const [from, to] of [[png, `${n}.png`], [join(SAVES, `${n}.json`), `${n}.json`], [join(ASCII, `${n}.png`), `ascii/${n}.png`]] as const)
      if (existsSync(from)) renameSync(from, join(RETIRED, to));
    syncLibrary();
    return Response.json({ ok: true });
  },

  "POST bin": async (req) => {
    const { id } = await body<{ id: string }>(req);
    rmSync(join(DRAFTS, safe(id)), { recursive: true, force: true });
    pending.delete(id);
    return Response.json({ ok: true });
  },

  // ── the Hints tab (scripts/hints.ts) ──

  "GET hints": () => Response.json(hints.view()),
  "POST hints-add": async (req) => {
    const { text, top = false } = await body<{ text: string; top?: boolean }>(req);
    return Response.json(hints.add(text ?? "", top));
  },
  "POST hints-edit": async (req) => {
    const { id, text } = await body<{ id: string; text: string }>(req);
    return Response.json(hints.edit(id, text ?? ""));
  },
  "POST hints-delete": async (req) => Response.json(hints.remove((await body<{ id: string }>(req)).id)),
  "POST hints-order": async (req) => Response.json(hints.order((await body<{ ids: string[] }>(req)).ids ?? [])),
  "POST hints-requeue": async (req) => Response.json(hints.requeue((await body<{ id: string }>(req)).id)),
  /** A fresh Make form's pair: the top two of the queue. */
  "GET hints-next": () => {
    const [hint1 = "", hint2 = ""] = hints.next(2);
    return Response.json({ hint1, hint2 });
  },
  /** A Render press: these are taken. */
  "POST hints-used": async (req) => {
    const { texts, name } = await body<{ texts: string[]; name: string }>(req);
    return Response.json(hints.markUsed(texts ?? [], name || "video"));
  },

  /**
   * A save's generated music (src/music/tune.ts): the file for these props,
   * made if it isn't there yet. The making runs in its own process (8s of
   * maths would freeze the Desk's server otherwise) and is cached by name, so
   * asking again for the same props is instant.
   */
  /** A save's music (picture = "saves/<name>.png"): as chosen, or chosen now if it never was. */
  "POST tune-choice": async (req) => {
    const { image = "" } = await body<{ image?: string }>(req);
    const n = safe(image.replace(/^saves\//, "").replace(/\.[a-z]+$/i, ""));
    if (!n || !existsSync(join(SAVES, `${n}.png`))) return Response.json({ error: "pick a saved picture first" }, { status: 400 });
    const music = sidecarOf(n).music ?? (await chooseMusic(n));
    return Response.json(musicProps(music));
  },

  /** Choose again: a fresh pick for a save's music, replacing the last. */
  "POST music-choose": async (req) => {
    const n = safe((await body<{ name: string }>(req)).name);
    return Response.json({ music: await chooseMusic(n) });
  },

  "POST tune": async (req) => {
    const p = await body<TuneProps>(req);
    if (!(Number(p.slot) >= 1) || !(Number(p.seconds) > 0)) return Response.json({ error: "no slot or length" }, { status: 400 });
    if (!p.tuneMood) return Response.json({ error: "this save's music hasn't been chosen yet" }, { status: 400 });
    const file = tuneFile(p);
    if (existsSync(join(MUSIC, file))) return Response.json({ file });
    let job = making.get(file);
    if (!job) {
      const props = { slot: p.slot, tuneTake: p.tuneTake, tuneStyle: p.tuneStyle, tuneAvoid: p.tuneAvoid, tuneMood: p.tuneMood, tuneStyles: p.tuneStyles, seconds: p.seconds, memory: p.memory };
      job = exec(["bun", "scripts/music.ts", "--props", JSON.stringify(props), "--out", join(MUSIC, file)], import.meta.dir)
        .then((r) => {
          if (!r.ok) return { error: r.err.trim().split("\n").pop() || "the tune didn't make" };
          trimTunes();
          return { file };
        })
        .finally(() => making.delete(file));
      making.set(file, job);
    }
    const r = await job;
    return Response.json(r, { status: r.error ? 500 : 200 });
  },
};
