/**
 * The Make screen's templates for Autosave. Browser only (desk.config.ts
 * lazy-loads it).
 */
import type { DeskTemplate } from "../desk/game";
import type { LibrarySave } from "./scripts/sync-library";
import library from "./src/data/library.json";

// Typed by hand: an empty library would otherwise infer never[].
const saves = library.saves as LibrarySave[];
import { SAVE_DEFAULTS } from "./src/defaults";
import { HINT_MAX, TAGLINE_MAX } from "./src/words";
import { EMPTY_LEDGER, type Ledger, clock, missingBefore, nextSlot, playtimeFor, resolveEgg } from "./src/eggs";
import { MEMORY_MAX_LINES, Save, memoryLines, saveSchema, saveSeconds, timeline } from "./src/Save";
import { TUNE, type TuneProps, tuneFor } from "./src/music/tune";

/** The Hints tab's server side (desk.server.ts). */
const hints = (name: string, body?: unknown) =>
  fetch(`/api/autosave/x/${name}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined).then((r) => r.json() as Promise<Record<string, unknown>>);

/** The slot ledger as last fetched (fresh form, after each Render press). */
let ledger: Ledger = EMPTY_LEDGER;
const loadLedger = () =>
  hints("slots")
    .then((l) => (ledger = l as unknown as Ledger))
    .catch(() => ledger);
void loadLedger();

/** What a save's clock and egg will be, in plain words. */
const info = (p: Record<string, unknown>) => {
  const slot = Number(p.slot) || 1, seed = Number(p.seed) || 0, seconds = Number(p.seconds) || 16;
  const lines: string[] = [];
  const set = Number(p.playtimeFrom);
  const auto = playtimeFor(ledger, slot);
  if (set >= 0) lines.push(`PLAYTIME starts at ${clock(set)}, set by hand (the ledger says ${clock(auto)}).`);
  else lines.push(`PLAYTIME runs ${clock(auto)} → ${clock(auto + seconds)}${slot > 1 ? ` (slots 1–${slot - 1} added up)` : " (a new game)"}.`);
  const missing = missingBefore(ledger, slot);
  if (missing.length) lines.push(`Slot${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "have" : "has"} no render yet, so ${missing.length > 1 ? "they count" : "it counts"} as nothing.`);
  const mine = ledger.slots.find((e) => e.slot === slot);
  if (mine) {
    lines.push(`Slot ${slot} is already in the ledger (${mine.seconds}s); rendering replaces it.`);
    if (set < 0 && mine.playtimeFrom !== auto) lines.push(`Its clock started at ${clock(mine.playtimeFrom)} last time; it would now start at ${clock(auto)}.`);
    if (mine.seconds !== seconds && ledger.slots.some((e) => e.slot > slot)) lines.push(`At ${seconds}s instead of ${mine.seconds}s, every later slot's clock moves too: re-render those to keep it joined up.`);
  }
  const { egg, why } = resolveEgg(String(p.egg ?? "auto"), slot, seed, ledger);
  lines.push(egg ? `Egg: ${egg.label}. ${why}` : `Egg: none. ${why}`);
  if (p.music === TUNE) {
    const { score, reading, file } = tuneFor(p as unknown as TuneProps);
    const take = Number(p.tuneTake) || 0;
    const words = reading.why.filter((w) => w.includes("→")).map((w) => w.split("→")[0]).slice(0, 4);
    lines.push(`Music: slot ${slot}'s tune${take ? ` (take ${take})` : ""}, ${score.label}.${words.length ? ` Mood from: ${words.join(", ")}.` : ""}${p.musicFile === file ? "" : " Making it…"}`);
  }
  return lines.join("\n");
};

/** "slot-07-everyone-checks-in-the-mirror-sometimes": the slot as it's drawn, then the memory
 * in kebab case, cut at a word past ~60 characters so file names stay readable. */
const renderName = (p: Record<string, unknown>) => {
  const slot = `slot-${String(Number(p.slot) || 1).padStart(2, "0")}`;
  const words = String(p.memory ?? "").toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  let memory = "";
  for (const w of words) {
    if (memory && memory.length + 1 + w.length > 60) break;
    memory = memory ? `${memory}-${w}` : w;
  }
  return memory ? `${slot}-${memory}` : slot;
};

export const TEMPLATES: DeskTemplate[] = [
  {
    id: "Save",
    label: "Save",
    blurb: "A picture builds itself out of glyphs while the game saves: save bar, tips, the memory revealed at the end, then it drops away as rain and loops. Same seed, same video.",
    component: Save,
    schema: saveSchema,
    seconds: (p) => saveSeconds(p as { seconds: number }),
    clipProps: () => ({}),
    clipKey: "clip",
    defaults: { ...SAVE_DEFAULTS },
    options: {
      music: [{ value: TUNE, label: "Generated: this slot's own tune" }, { value: "", label: "No music" }, ...(library.music as { file: string; name: string }[]).map((m) => ({ value: m.file, label: m.name }))],
    },
    // The look is locked and the seed picks the rest (arrival, order, tune style),
    // the ledger sets the clock and the egg is earned, not forced: none of it is
    // a choice per video. Still in the schema, so Studio can force them for testing.
    hide: ["clip", "musicFile", "arrival", "order", "tone", "palette", "egg", "playtimeFrom", "tuneStyle", "tuneTake", "musicFrom", "musicVolume", "ticksVolume"],
    gallery: { key: "image", label: "Picture", items: saves.map((s) => ({ value: s.file, label: s.title || s.memory, thumb: s.file })) },
    long: ["memory", "journal"],
    reroll: ["seed"],
    // Picking a picture brings its words; edit them after to make them yours.
    linked: (key, value) => {
      const s = key === "image" ? saves.find((x) => x.file === value) : undefined;
      return s ? { memory: s.memory, tagline: s.tagline, title: s.title, journal: s.journal } : undefined;
    },
    // Each video gets the next two hints off the queue; rendering takes them.
    // and the next free slot from the ledger. Rendering takes the hints and writes the slot.
    fresh: async () => {
      const [h, l] = await Promise.all([hints("hints-next"), loadLedger()]);
      return { ...h, slot: nextSlot(l) };
    },
    rendered: async (p, name) => {
      await Promise.all([hints("hints-used", { texts: [p.hint1, p.hint2].filter((h) => typeof h === "string"), name }), hints("slot-rendered", { props: p, name })]);
      await loadLedger();
    },
    // Generated music: the Desk makes the file for these props (desk.server.ts "tune").
    prepare: async (p) => {
      if (p.music !== TUNE) return {};
      const r = (await hints("tune", p)) as { file?: string; error?: string };
      if (!r.file) throw new Error(r.error ?? "the music didn't make");
      return { musicFile: r.file };
    },
    name: renderName,
    info,
    warn: (p) => {
      const memory = String(p.memory ?? ""), seconds = Number(p.seconds) || 16;
      const lines = memoryLines(memory).length;
      if (lines > MEMORY_MAX_LINES) return `The memory runs to ${lines} lines; past ${MEMORY_MAX_LINES} it crowds TikTok's caption.`;
      const build = timeline(seconds, memory).buildEnd;
      const tagline = String(p.tagline ?? "").trim();
      if (tagline.length > TAGLINE_MAX) return `The tagline is ${tagline.length} characters; TikTok cuts it at about ${TAGLINE_MAX}, so the start has to stand on its own.`;
      const longHint = [p.hint1, p.hint2].map((h) => String(h ?? "").trim()).find((h) => h.length > HINT_MAX);
      if (longHint) return `A hint runs to ${longHint.length} characters; past about ${HINT_MAX} it takes a third line under the bar.`;
      if (String(p.journal ?? "").length + tagline.length > 3600) return "The journal is close to TikTok's caption limit (about 4,000 characters with the channel line and tags).";
      if (build < seconds * 0.55) return `A memory this long leaves the picture only ${build.toFixed(1)}s to build. A few more seconds would give it room.`;
      return undefined;
    },
  },
];
