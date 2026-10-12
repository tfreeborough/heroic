/**
 * A game's edits: <publicDir>/sequences/<id>.json, committed. A sequence
 * is video tracks of clips from any of the game's recordings, audio tracks
 * of clips from the takes it holds, a music bed and markers (the maths and
 * the edits are @heroic/voiceover's). Templates play the file directly, so
 * there is nothing to encode: the edit IS the clip.
 *
 * Edits saved before 2026-10-05 (one packed row of shots, voice-overs in
 * their own files) are brought up to date the first time they're read:
 * the file is rewritten in this shape and the voice-over files go to the
 * voice folder's .trash, their takes staying where they are.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  type AudioClip,
  type AudioTrack,
  type Box,
  type Card,
  type Clip,
  type LegacySequence,
  type LegacyShot,
  type Sequence,
  type Take,
  type VideoTrack,
  MIN_CARD,
  WHOLE,
  cropBox,
  emptySequence,
  isLegacySequence,
  joinOverlap,
  mergeSegments,
  sameBox,
  sequenceSeconds,
  upgradeSequence,
} from "@heroic/voiceover";
import type { GameConfig } from "../game";
import { footageDir, publicDir, readSidecar } from "./footage";
import { deleteVoice, listVoices, readVoice, trashTakes } from "./voice";

export const seqDir = (g: GameConfig) => join(publicDir(g), "sequences");
const trashDir = (g: GameConfig) => join(seqDir(g), ".trash");
const pathOf = (g: GameConfig, id: string) => join(seqDir(g), `${seqSlug(id)}.json`);
/** What a template's `clip` prop takes for this sequence. */
export const sequencePath = (g: GameConfig, id: string) => relative(publicDir(g), pathOf(g, id));
/** What a voice-over recorded over an old edit had as its `clip`. */
export const seqClip = (id: string) => `seq:${id}`;
/** Where a recording sits under the public dir: what a clip's `src` is. */
export const footageSrc = (g: GameConfig, file: string) => `${relative(publicDir(g), footageDir(g))}/${file}`;

export const seqSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "edit";

export type SequenceSummary = Sequence & { path: string; seconds: number };

/** An old edit becomes a sequence, with its voice-overs folded in, and the file is rewritten. */
const upgrade = (g: GameConfig, old: LegacySequence): Sequence => {
  const voices = listVoices(g)
    .filter((v) => v.clip === seqClip(old.id))
    .flatMap((v) => {
      const full = readVoice(g, v.id);
      return full ? [full] : [];
    });
  const seq = upgradeSequence(old, voices);
  writeFileSync(pathOf(g, seq.id), JSON.stringify(seq, null, 1) + "\n");
  for (const v of voices) deleteVoice(g, v.id, true);
  return seq;
};

export const readSequence = (g: GameConfig, id: string): Sequence | undefined => {
  const p = pathOf(g, id);
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
    if (isLegacySequence(raw)) return upgrade(g, raw);
    const s = raw as Sequence;
    return Array.isArray(s.video) ? s : undefined;
  } catch {
    return undefined;
  }
};

export const listSequences = (g: GameConfig): SequenceSummary[] => {
  if (!existsSync(seqDir(g))) return [];
  return readdirSync(seqDir(g))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const s = readSequence(g, f.replace(/\.json$/, ""));
      return s ? [{ ...s, path: sequencePath(g, s.id), seconds: sequenceSeconds(s) }] : [];
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
};

const num = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
};
const box = (b: unknown): Box | undefined => {
  const o = b as Partial<Box> | undefined;
  if (!o || typeof o !== "object") return undefined;
  const x = num(o.x, 0, 1, 0);
  const y = num(o.y, 0, 1, 0);
  return { x, y, w: num(o.w, 0.01, 1 - x, 1 - x), h: num(o.h, 0.01, 1 - y, 1 - y) };
};
const freshId = () => Math.random().toString(36).slice(2, 10);
const safeSrc = (s: unknown) =>
  String(s ?? "")
    .replace(/(^|\/)\.\.(?=\/|$)/g, "")
    .replace(/^\/+/, "");

/** Whatever the page sent, made safe to write: no path walking out of the public dir, numbers in range. */
const cleanClip = (c: Clip): Clip => {
  const sourceSeconds = num(c.sourceSeconds, 0.1, 1e6, 1);
  const start = num(c.start, 0, sourceSeconds, 0);
  const frames = Object.fromEntries(Object.entries(c.frames ?? {}).flatMap(([k, v]) => (box(v) ? [[k, box(v)!]] : [])));
  const crop = box(c.crop);
  return {
    id: String(c.id || freshId()),
    src: safeSrc(c.src),
    start,
    end: num(c.end, start + 0.05, sourceSeconds, sourceSeconds),
    at: num(c.at, 0, 1e6, 0),
    sourceSeconds,
    aspect: num(c.aspect, 0.1, 10, 9 / 16),
    ...(crop && (crop.x || crop.y || crop.w < 1 || crop.h < 1) ? { crop } : {}),
    ...(Object.keys(frames).length ? { frames } : {}),
    ...(c.muted ? { muted: true } : {}),
    ...(c.volume !== undefined && Number(c.volume) !== 1 ? { volume: num(c.volume, 0, 2, 1) } : {}),
  };
};
const cleanAudio = (c: AudioClip, takes: number): AudioClip | undefined => {
  const take = Math.round(Number(c.take));
  if (!Number.isFinite(take) || take < 0 || take >= takes) return undefined;
  const start = num(c.start, 0, 1e6, 0);
  return {
    id: String(c.id || freshId()),
    take,
    start,
    end: num(c.end, start + 0.05, 1e6, start + 0.05),
    at: num(c.at, 0, 1e6, 0),
    ...(c.muted ? { muted: true } : {}),
    ...(c.volume !== undefined && Number(c.volume) !== 1 ? { volume: num(c.volume, 0, 2, 1) } : {}),
  };
};
const cleanCard = (c: Card): Card | undefined => {
  const kind = c.kind === "text" || c.kind === "image" || c.kind === "broll" || c.kind === "build" || c.kind === "chapter" ? c.kind : undefined;
  if (!kind) return undefined;
  return {
    id: String(c.id || freshId()),
    kind,
    ...(c.text !== undefined ? { text: String(c.text).slice(0, 400) } : {}),
    ...(c.src !== undefined ? { src: safeSrc(c.src) } : {}),
    ...(c.note !== undefined ? { note: String(c.note).slice(0, 400) } : {}),
    ...(kind === "build" ? { seed: Math.round(num(c.seed, 1, 1e6, 1)) } : {}),
    ...(kind === "chapter" && c.n ? { n: Math.round(num(c.n, 1, 99, 1)) } : {}),
    ...(kind === "build" && Array.isArray(c.pulled) && c.pulled.length ? { pulled: c.pulled.map((w) => String(w).slice(0, 40)).slice(0, 4) } : {}),
    at: num(c.at, 0, 1e6, 0),
    seconds: num(c.seconds, MIN_CARD, 1e6, 4),
    place: c.place === "over" ? "over" : "full",
    ...(c.beat ? { beat: String(c.beat) } : {}),
  };
};
const cleanTake = (t: Take): Take => ({
  file: safeSrc(t.file),
  seconds: num(t.seconds, 0, 1e6, 0),
  recordedAt: String(t.recordedAt ?? ""),
  words: Array.isArray(t.words) ? t.words.map((w) => ({ text: String(w.text ?? ""), start: num(w.start, 0, 1e6, 0), end: num(w.end, 0, 1e6, 0), ...(w.hidden ? { hidden: true } : {}) })) : [],
  ...(t.transcribed ? { transcribed: true } : {}),
});

/** Write a sequence as sent by the page. An empty one is fine: a timeline just started. */
export const writeSequence = (g: GameConfig, seq: Sequence): Sequence => {
  mkdirSync(seqDir(g), { recursive: true });
  const id = seqSlug(seq.id);
  const prev = readSequence(g, id);
  const takes = (seq.takes ?? []).map(cleanTake).filter((t) => t.file);
  const video: VideoTrack[] = (seq.video?.length ? seq.video : [{ id: "v1", clips: [] }]).map((t, i) => ({
    id: String(t.id || `v${i + 1}`),
    ...(t.muted ? { muted: true } : {}),
    clips: (t.clips ?? [])
      .map(cleanClip)
      .filter((c) => c.src)
      .sort((a, b) => a.at - b.at),
  }));
  const audio: AudioTrack[] = (seq.audio?.length ? seq.audio : [{ id: "a1", clips: [] }]).map((t, i) => ({
    id: String(t.id || `a${i + 1}`),
    ...(t.muted ? { muted: true } : {}),
    clips: (t.clips ?? [])
      .map((c) => cleanAudio(c, takes.length))
      .filter((c): c is AudioClip => Boolean(c))
      .sort((a, b) => a.at - b.at),
  }));
  const next: Sequence = {
    id,
    name: String(seq.name || id).slice(0, 120),
    ...(seq.note ? { note: String(seq.note) } : {}),
    ...(seq.idea ? { idea: String(seq.idea) } : {}),
    ...(seq.title ? { title: String(seq.title).slice(0, 200) } : {}),
    video,
    audio,
    takes,
    voice: {
      captionNudgeMs: Math.round(num(seq.voice?.captionNudgeMs, -1000, 1000, 0)),
      tidy: seq.voice?.tidy !== false,
      ...(seq.voice?.denoise ? { denoise: Math.round(num(seq.voice.denoise, 0, 3, 0)) } : {}),
      ...(seq.voice?.volume !== undefined && Number(seq.voice.volume) !== 1 ? { volume: num(seq.voice.volume, 0, 1, 1) } : {}),
    },
    ...(seq.music?.song ? { music: { song: safeSrc(seq.music.song), from: num(seq.music.from, 0, 1e6, 0), level: num(seq.music.level, 0, 1, 0.8) } } : {}),
    ...(seq.overlay?.cards?.length
      ? {
          overlay: {
            id: String(seq.overlay.id || "o1"),
            cards: seq.overlay.cards
              .map(cleanCard)
              .filter((c): c is Card => Boolean(c))
              .sort((a, b) => a.at - b.at),
          },
        }
      : {}),
    ...(seq.markers?.length ? { markers: seq.markers.map((m) => ({ id: String(m.id || freshId()), at: num(m.at, 0, 1e6, 0) })).sort((a, b) => a.at - b.at) } : {}),
    slide: num(seq.slide, 0.1, 2, 0.4),
    ...(seq.origin ? { origin: seq.origin } : {}),
    createdAt: prev?.createdAt ?? seq.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(pathOf(g, id), JSON.stringify(next, null, 1) + "\n");
  return next;
};

/** Into the sequences' .trash. Its takes go to the voice folder's .trash too, unless another edit uses them. */
export const trashSequence = (g: GameConfig, id: string) => {
  const p = pathOf(g, id);
  if (!existsSync(p)) return;
  const seq = readSequence(g, id);
  mkdirSync(trashDir(g), { recursive: true });
  renameSync(p, join(trashDir(g), `${seqSlug(id)}-${Date.now()}.json`));
  if (seq?.takes.length) {
    const used = new Set(listSequences(g).flatMap((s) => s.takes.map((t) => t.file)));
    trashTakes(
      g,
      seq.takes.filter((t) => !used.has(t.file)),
    );
  }
};

const freeId = (g: GameConfig, name: string) => {
  const base = seqSlug(name);
  let id = base;
  for (let n = 2; existsSync(pathOf(g, id)); n++) id = `${base}-${n}`;
  return id;
};
const stem = (file: string) => file.replace(/\.[^.]+$/, "");

/** A new, empty edit (Make's "Start a timeline"). */
export const createSequence = (g: GameConfig, name?: string): Sequence => {
  const title = (name ?? "").trim() || `Edit ${new Date().toISOString().slice(0, 10)}`;
  return writeSequence(g, emptySequence(freeId(g, title), title));
};

/**
 * The edit a clip opens in. `file` = a recording; `from` = a cut the old
 * editor made of it (its pieces become the clips, with the same slides, so
 * a voice-over timed against the cut lines up). Without `fresh`, an edit
 * already started from the same place is opened again.
 *
 * The first edit made from a clip takes its voice-overs with it: they were
 * recorded over that footage, and the edit is what that footage is now.
 */
export const sequenceFrom = (g: GameConfig, opts: { file: string; from?: string; fresh?: boolean }): Sequence => {
  const existing = listSequences(g);
  if (!opts.fresh) {
    const same = existing.find((s) => s.origin?.file === opts.file && (s.origin?.from ?? "") === (opts.from ?? ""));
    if (same) return same;
  }
  const rec = readSidecar(g, opts.file);
  if (!rec) throw new Error(`${opts.file} isn't in the library`);
  const cut = opts.from ? readSidecar(g, opts.from) : undefined;
  const spec = cut?.source === rec.file ? cut.cleanup : undefined;
  const src = footageSrc(g, rec.file);
  const facts = rec.facts;
  const aspect = facts.width && facts.height ? facts.width / facts.height : 9 / 16;
  const asShot = (start: number, end: number, crop: Box, muted: boolean): LegacyShot => ({ id: freshId(), src, start, end, sourceSeconds: facts.seconds, aspect, ...(sameBox(crop, WHOLE) ? {} : { crop }), ...(muted ? { muted: true } : {}) });
  let shots: LegacyShot[];
  let slide = 0.4;
  if (spec?.segments.length) {
    const segments = mergeSegments(spec.segments);
    slide = joinOverlap(segments, spec.transitionSeconds) || 0.4;
    shots = segments.map((s) => asShot(s.start, s.end, cropBox(spec.cropTop, spec.cropBottom), spec.muted));
  } else {
    shots = [asShot(0, facts.seconds, cropBox(rec.cropTop, rec.cropBottom), rec.muted)];
  }
  const name = cut && spec ? stem(cut.file) : stem(rec.file);
  const firstFromHere = !existing.some((s) => s.origin?.file === opts.file && (s.origin?.from ?? "") === (opts.from ?? ""));
  // Voice-overs recorded over this footage come along into the first edit made from it.
  const was = (cut && spec ? cut : rec).file;
  const voices = firstFromHere
    ? listVoices(g)
        .filter((v) => v.clip === was)
        .flatMap((v) => {
          const full = readVoice(g, v.id);
          return full ? [{ ...full, id: full.id === was ? name : full.id }] : [];
        })
    : [];
  const now = new Date().toISOString();
  const id = freeId(g, name);
  const old: LegacySequence = { id, name, note: (cut ?? rec).note || undefined, shots, slide, origin: { file: rec.file, ...(opts.from ? { from: opts.from } : {}) }, createdAt: now, updatedAt: now };
  // The old shape's packed timing laid out as placed clips: the same maths an old edit is read with.
  const seq = writeSequence(g, upgradeSequence(old, voices.map((v) => (v.id === name ? { ...v, id } : v))));
  for (const v of voices) deleteVoice(g, v.id === name ? (listVoices(g).find((x) => x.clip === was && readVoice(g, x.id)?.takes[0]?.file === v.takes[0]?.file)?.id ?? v.id) : v.id, true);
  return seq;
};
