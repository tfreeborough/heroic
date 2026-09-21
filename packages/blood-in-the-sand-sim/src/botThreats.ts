/**
 * What the bot brain KNOWS about the things that can hurt it
 * (docs/design/bot-brains-v4.md, stages 1–3). Bots never draft gated or
 * Signet kit, but they must FIGHT all of it — so the knowledge lives in two
 * EXHAUSTIVE tables keyed by the content unions. Adding a WeaponId or a
 * DeployableKind is a compile error right here until the brain has been told
 * what the new thing is: the archetype-check ritual, enforced by the type
 * system instead of by memory.
 *
 * Everything reads public data only — the snapshot every client renders and
 * the WEAPONS/ability config every player can open in the codex.
 */
import {
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  SANDSTORM,
  SANDTRAP,
  SINKHOLE,
  TAR_PIT,
  TITANS_DRAUGHT,
  TREMOR,
  WEAPONS,
  type WeaponId,
} from "./config";
import type { DeployableSnapshot, PlayerSnapshot, ShellSnapshot } from "./protocol";
import type { DeployableKind } from "./state";

// ── Weapons ────────────────────────────────────────────────────────────────

/** HOW a weapon hurts — which decides what a dodge even means:
 *  arc   = a tracked melee strike; only RANGE saves you (leave the reach, or
 *          stand inside a minReach dead zone) — or i-frames across the strike
 *  shot  = a projectile down a line; sidestep it, i-frame it, mirror it
 *  shell = a marked circle with a clock; walk off the mark
 *  beam  = never hurts anyone (the Lifeline) — but its wielder is the
 *          priority kill while the link is up */
export type ThreatKind = "arc" | "shot" | "shell" | "beam";

export const THREAT_KINDS: Record<WeaponId, ThreatKind> = {
  blade: "arc",
  hammer: "arc",
  trident: "arc",
  fang: "arc",
  bow: "shot",
  staff: "shot",
  scorpion: "shot",
  bombard: "shell",
  lifeline: "beam",
};

export const threatKind = (p: PlayerSnapshot): ThreatKind | null =>
  p.weapon === null ? null : THREAT_KINDS[p.weapon];

/** Is Titan's Draught live on this body? (The slot's active clock is public —
 * and the giant is hard to miss.) Reach AND hurtbox scale with it. */
export const titanFactor = (p: PlayerSnapshot): number =>
  p.abilities.some((s) => s.id === "titans-draught" && s.active > 0) ? TITANS_DRAUGHT.sizeFactor : 1;

export const bodyRadius = (p: PlayerSnapshot): number => PLAYER_RADIUS * titanFactor(p);

/**
 * The CENTRE-distance band in which `attacker`'s arc strike connects with
 * `victim` — step.ts's own rule (rim inside reach, rim outside minReach),
 * titan-scaled. `near` > 0 is a dead zone: stand closer than that and the
 * swing can't even start. Null for anything that isn't an arc.
 */
export const strikeBand = (
  attacker: PlayerSnapshot,
  victim: PlayerSnapshot,
): { near: number; far: number } | null => {
  if (attacker.weapon === null || THREAT_KINDS[attacker.weapon] !== "arc") return null;
  const a = WEAPONS[attacker.weapon].attack;
  const f = titanFactor(attacker);
  const r = bodyRadius(victim);
  return { near: Math.max(0, (a.minReach ?? 0) * f - r), far: a.reach * f + r };
};

/** The dead zone of a weapon that has one but isn't an arc (the bombard):
 * closer than this, the gun cannot start a swing at all. */
export const deadZone = (attacker: PlayerSnapshot, victim: PlayerSnapshot): number => {
  if (attacker.weapon === null) return 0;
  const min = WEAPONS[attacker.weapon].attack.minReach ?? 0;
  return Math.max(0, min * (THREAT_KINDS[attacker.weapon] === "arc" ? titanFactor(attacker) : 1) - bodyRadius(victim));
};

/** How long the lethal instant LASTS — a thrust travels, a burst keeps
 * firing. I-frames have to straddle all of it. */
export const strikeSpan = (weapon: WeaponId): number => {
  const w = WEAPONS[weapon];
  if (w.burst) return (w.burst.count - 1) * w.burst.interval;
  return w.attack.thrustDuration ?? 0;
};

/** Full attack cycle, seconds — a fast cycle can't be out-dodged with a
 * four-charge dash; it has to be out-SPACED. */
export const cycleSeconds = (weapon: WeaponId): number => WEAPONS[weapon].attack.windup + WEAPONS[weapon].attack.recovery;

/** Run speed right now, px/s, as far as the snapshot shows it (slows are
 * public — the blue ring). Tier speed rides `factor`. */
export const runSpeed = (p: PlayerSnapshot, factor = 1): number =>
  PLAYER_MAX_SPEED * factor * (p.slowLeft > 0 ? 0.6 : 1);

// ── Ground ─────────────────────────────────────────────────────────────────

export interface HazardSpec {
  /** Zone radius, px (bodies are tested at the RIM — callers add a body). */
  radius: number;
  /** true = hurts/binds everyone, the owner's team included (the
   * spare-no-one family: sinkhole, tar). */
  sparesNoOne: boolean;
  /** Plan a committed detour around it (big, worth walking round) — or just
   * refuse to loiter in it (small/soft: tar blobs). */
  detour: boolean;
  /** Emergency-shell weight: how hard the feet are thrown out of it. */
  shove: number;
}

/** Every placed thing, and whether the feet should refuse it. `null` = not a
 * hazard (a decoy, a heal zone). EXHAUSTIVE on purpose — see the file note. */
export const HAZARDS: Record<DeployableKind, HazardSpec | null> = {
  // Live OR arming: a mine that arms under your feet goes off just the same
  // (v4 gauntlet: the brain used to ignore the 2s arming window entirely).
  sandtrap: { radius: SANDTRAP.triggerRadius, sparesNoOne: false, detour: true, shove: 3 },
  quake: { radius: TREMOR.radius, sparesNoOne: false, detour: true, shove: 3 },
  sandstorm: { radius: SANDSTORM.radius, sparesNoOne: false, detour: true, shove: 3 },
  sinkhole: { radius: SINKHOLE.radius, sparesNoOne: true, detour: true, shove: 3 },
  tar: { radius: TAR_PIT.radiusMax, sparesNoOne: true, detour: false, shove: 1.2 },
  "straw-man": null,
  "blood-font": null,
};

/** The hazard a deployable poses to ME, body margin included — or null. */
export const hazardOf = (d: DeployableSnapshot, me: PlayerSnapshot): (HazardSpec & { reach: number }) | null => {
  const spec = HAZARDS[d.kind];
  if (spec === null) return null;
  if (d.team === me.team && !spec.sparesNoOne) return null;
  return { ...spec, reach: spec.radius + bodyRadius(me) };
};

/** A bombard shell whose landing ring I'm standing in (or about to be). */
export interface IncomingShell {
  id: number;
  /** Seconds until it lands. */
  landIn: number;
  /** px I still have to cover to be clear of the blast (≤ 0 = already clear). */
  exitDist: number;
  /** Unit direction straight out of the ring. */
  awayX: number;
  awayY: number;
}

/**
 * The most urgent shell I'm inside the ring of. Shells spare no one — the
 * gunner's own team included — so ownership is irrelevant (and isn't on the
 * wire anyway). `margin` widens the ring a touch: clear means CLEAR.
 */
export const incomingShell = (me: PlayerSnapshot, shells: readonly ShellSnapshot[], margin = 14): IncomingShell | null => {
  let best: IncomingShell | null = null;
  for (const s of shells) {
    const dx = me.x - s.tx;
    const dy = me.y - s.ty;
    const d = Math.hypot(dx, dy);
    const exitDist = s.blast + bodyRadius(me) + margin - d;
    if (exitDist <= 0) continue;
    if (best !== null && s.landIn >= best.landIn) continue;
    // Dead centre has no "out" — any way will do; pick +x deterministically.
    best = { id: s.id, landIn: s.landIn, exitDist, awayX: d > 1 ? dx / d : 1, awayY: d > 1 ? dy / d : 0 };
  }
  return best;
};

// ── Spacing ────────────────────────────────────────────────────────────────

/**
 * Matchup-aware melee spacing (v4 stage 2): where should an ARC wielder
 * stand against THIS opponent? Positioning is aiming in this game, and
 * "walk to the middle of them" throws away every reach advantage on the
 * roster (Tom's tricks, 2026-09-21: the blade diving a hammer bot that
 * obligingly slogs it out; the fang living at a hammer's feet).
 *
 *  · they have a DEAD ZONE (trident, bombard) → live inside it: I hit, they
 *    can't even start a swing
 *  · I OUT-REACH them → hold the outer edge of my own reach, where I connect
 *    and they don't; give ground as they push, the slow/bleed does the rest
 *  · otherwise → null: contact, and the strike predictor does the defending
 *
 * Centre distances, px. Null = no spacing game here (fight at contact).
 */
const MIN_REACH_EDGE = 33;

export const meleeSpacing = (
  me: PlayerSnapshot,
  target: PlayerSnapshot,
): { near: number; far: number } | null => {
  if (me.weapon === null || THREAT_KINDS[me.weapon] !== "arc" || target.weapon === null) return null;
  const mine = strikeBand(me, target);
  if (mine === null) return null;
  const dead = deadZone(target, me);
  if (dead > 0) {
    // Inside their dead zone AND inside my own reach (and outside my own
    // dead zone, should a bot ever hold a trident).
    const far = Math.min(mine.far, dead) - 8;
    return far > mine.near ? { near: mine.near, far } : null;
  }
  const theirs = strikeBand(target, me);
  if (theirs === null) return null; // shooters are closed on, not spaced
  // No edge worth dancing on: under ~a body's width the window is thinner
  // than the footwork that has to hold it (gauntlet: a blade spacing a fang
  // on a 20px window LOST a matchup it wins 8–0 by simply slogging).
  if (mine.far - theirs.far < MIN_REACH_EDGE) return null;
  return { near: Math.max(theirs.far + 6, mine.far - 22), far: mine.far - 4 };
};
