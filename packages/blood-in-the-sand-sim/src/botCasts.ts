/**
 * Bot cast rules — one "should I press this now?" predicate per ability
 * (docs/design/bot-brains.md, rollout step 2). The brain calls decideCasts
 * once per tick; the first satisfied rule in priority order wins, so a bot
 * presses at most one non-dash button per tick, like a thumb would.
 *
 * Everything reads snapshot data the bot legitimately has (plus the public
 * WEAPONS/ability config — the codex every player can open). Rules split
 * into REACTIVE (answers to a live telegraph — never paced, reflexes don't
 * queue) and PACED (proactive plays, gated by the brain's cast-pacing hold
 * so a bot doesn't dump its whole hand in one beat).
 */
import {
  BLOOD_FONT,
  HARPOON,
  PLAYER_RADIUS,
  SANDSTORM,
  STRAW_MAN,
  TREMOR,
  WARDING_SHOUT,
  WAR_DRUMS,
  WEAPONS,
  type AbilityId,
} from "./config";
import type { DeployableSnapshot, PlayerSnapshot, ProjectileSnapshot } from "./protocol";

/**
 * Target selection: the nearest living opponent. Shared by every caller
 * (practice mode, the headless server bot) so all brains hunt by one rule;
 * nearest-enemy means team bots dogpile rather than coordinate — real target
 * discipline arrives with the archetype pass.
 */
export const nearestEnemy = (
  me: PlayerSnapshot | undefined,
  players: PlayerSnapshot[],
): PlayerSnapshot | undefined => {
  if (!me) return undefined;
  let best: PlayerSnapshot | undefined;
  let bestDist = Infinity;
  for (const p of players) {
    if (p.team === me.team || !p.alive) continue;
    const dist = Math.hypot(p.x - me.x, p.y - me.y);
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
};

/** Drafted, off cooldown, not mid-active, and still round-budgeted? */
const slotReady = (me: PlayerSnapshot, id: AbilityId): boolean =>
  me.abilities.some((s) => s.id === id && s.cd === 0 && s.active === 0 && s.charges > 0);

const hpFrac = (p: PlayerSnapshot): number => (p.maxHp > 0 ? p.hp / p.maxHp : 1);

export const rangedWeapon = (p: PlayerSnapshot): boolean =>
  p.weapon !== null && WEAPONS[p.weapon].projectile !== undefined;

/**
 * How close an enemy mid-windup is a real threat: their arc's reach plus a
 * step of drift, or a dodge-worthy bubble for a projectile (the shot fires
 * at the windup's end — inside this, moving feet or i-frames are due).
 */
export const threatRange = (enemy: PlayerSnapshot): number => {
  if (enemy.weapon === null) return 160;
  const w = WEAPONS[enemy.weapon];
  return w.projectile ? 220 : w.attack.reach + 50;
};

/** My own weapon's auto-acquisition edge — past it, my swings can't start. */
const myEngagement = (me: PlayerSnapshot): number =>
  me.weapon === null ? 160 : WEAPONS[me.weapon].engagementRadius;

/**
 * The enemy whose windup is a live threat to ME right now, or null: any
 * opponent mid-windup, within their weapon's threat range of me, whose
 * likeliest auto-target is me (approximated as "I'm their nearest enemy").
 * Scans ALL enemies — a brain hunting a focus target across the arena still
 * dodges the swing coming from the side. Shared by the reactive cast rules
 * and botThink's dodge-dash.
 */
export const windupThreat = (me: PlayerSnapshot, players: PlayerSnapshot[]): PlayerSnapshot | null => {
  for (const p of players) {
    if (p.team === me.team || !p.alive || p.atk !== "windup") continue;
    const dist = Math.hypot(p.x - me.x, p.y - me.y);
    if (dist < threatRange(p) + 40 && nearestEnemy(p, players)?.id === me.id) return p;
  }
  return null;
};

/** An in-flight projectile on course for me, distilled for the dodge. */
export interface IncomingShot {
  id: number;
  /** Seconds until it's abreast of me on its current heading. */
  eta: number;
  /** Unit direction pushing me OFF the flight line (perpendicular escape). */
  awayX: number;
  awayY: number;
}

/**
 * The most imminent projectile whose current line threatens me — the thing
 * the windup-based threat model can never see (docs/design/bot-brains.md,
 * sharpened after Tom + wife beat the top tiers 2026-07-21): a shot already
 * in the air, a STAFF orb curving back after a dodge, a mirror-reflected
 * arrow, the second archer. Re-assessed every tick from the snapshot's
 * projectiles (position + travel angle are public — every client renders
 * them), so a homing orb gets re-dodged as it turns. Ownership isn't in the
 * snapshot; dodging a teammate's passing arrow is wasted footwork we accept
 * (humans flinch at those too).
 */
export const incomingShot = (
  me: PlayerSnapshot,
  projectiles: ProjectileSnapshot[],
): IncomingShot | null => {
  let best: IncomingShot | null = null;
  for (const s of projectiles) {
    const w = WEAPONS[s.kind];
    if (!w.projectile || w.attack.projectileSpeed === undefined) continue;
    const hx = Math.cos(s.angle);
    const hy = Math.sin(s.angle);
    const rx = me.x - s.x;
    const ry = me.y - s.y;
    /** Distance along the heading until abreast of me; behind = harmless. */
    const along = rx * hx + ry * hy;
    if (along < -PLAYER_RADIUS) continue;
    /** Signed perpendicular offset of me from the flight line. */
    const lateral = rx * -hy + ry * hx;
    // Homers steer up to their turn rate — treat their corridor as wider.
    const corridor =
      w.projectile.radius + PLAYER_RADIUS + 24 + (w.projectile.homingTurnRate ? 70 : 0);
    if (Math.abs(lateral) > corridor) continue;
    const eta = Math.max(0, along) / w.attack.projectileSpeed;
    if (eta > 0.9) continue;
    if (best !== null && eta >= best.eta) continue;
    // Escape perpendicular to the heading, on the side I'm already offset
    // toward (dead-centre defaults to the heading's left).
    const sign = lateral >= 0 ? 1 : -1;
    best = { id: s.id, eta, awayX: -hy * sign, awayY: hx * sign };
  }
  return best;
};

/** Is this player's escape hop down (cooling or out of charges)? Cooldown
 * clocks are public in-match — reading them is the bait-and-punish game. */
export const dashDown = (p: PlayerSnapshot): boolean =>
  p.abilities.some((s) => s.id === "dash" && (s.cd > 0 || s.charges === 0));

/**
 * Pick this tick's ability press, or null. `enemy` is the brain's FOCUS
 * target (paced rules play toward it); reactive rules scan every opponent —
 * the threat may not be the one I'm hunting. `allowPaced` is the brain's
 * cast-pacing hold: reactive rules ignore it (a reflex doesn't queue),
 * proactive ones wait their beat. `allowReactive` is the difficulty layer's
 * per-swing dodge roll — a tier that failed the roll eats this telegraph
 * with its buttons too, not just its feet. Priority is survival-first —
 * answer the telegraph, then peel/heal, then offence, then utility.
 */
export const decideCasts = (
  me: PlayerSnapshot,
  enemy: PlayerSnapshot,
  players: PlayerSnapshot[],
  deployables: DeployableSnapshot[],
  allowPaced: boolean,
  allowReactive = true,
): AbilityId | null => {
  const dist = Math.hypot(enemy.x - me.x, enemy.y - me.y);
  const threat = allowReactive ? windupThreat(me, players) : null;

  // ── Reactive: answers to a live telegraph ─────────────────────────────────
  // Mirror Guard: their shot is winding up at me — put the mirror between us.
  if (threat && rangedWeapon(threat) && slotReady(me, "mirror-guard")) return "mirror-guard";
  // Straw Man: the blow is already coming down from inside the taunt's reach —
  // drop the decoy and let it fall on straw (the drop-taunt force-locks the
  // attacker and redirects an in-flight windup; pvp-abilities.md § Straw Man).
  if (
    threat &&
    Math.hypot(threat.x - me.x, threat.y - me.y) < STRAW_MAN.tauntRadius &&
    slotReady(me, "straw-man")
  ) {
    return "straw-man";
  }
  // Ironhide: a hit is coming and no dash is up — tank it on purpose.
  if (threat && !slotReady(me, "dash") && slotReady(me, "ironhide")) return "ironhide";

  if (!allowPaced) return null;

  // ── Paced: proactive plays, one per pacing beat ───────────────────────────
  // Warding Shout: hurt with an enemy in the cone — hurl them off me.
  if (dist < WARDING_SHOUT.range - 20 && hpFrac(me) < 0.6 && slotReady(me, "warding-shout")) {
    return "warding-shout";
  }
  // Blood Font: one pour per round, so only when truly low AND the ground is
  // worth standing on — never under an enemy quake/storm, never point-blank
  // (the gate stays low: a melee bot lives at arm's length, and a pour it can
  // fight on top of beats a pour it never makes).
  if (hpFrac(me) < 0.4 && dist > 120 && slotReady(me, "blood-font")) {
    const fouled = deployables.some(
      (d) =>
        d.team !== me.team &&
        (d.kind === "quake" || d.kind === "sandstorm") &&
        Math.hypot(d.x - me.x, d.y - me.y) < BLOOD_FONT.radius + 80,
    );
    if (!fouled) return "blood-font";
  }
  // Sandstorm: being worn down by a shooter — stand in the cloud, break the lock.
  if (hpFrac(me) < 0.7 && rangedWeapon(enemy) && dist < SANDSTORM.radius + 230 && slotReady(me, "sandstorm")) {
    return "sandstorm";
  }
  // Harpoon: they're holding the range my weapon can't start a swing at —
  // drag them in. (A press with no reachable mark neither fires nor costs.)
  if (dist > myEngagement(me) + 20 && dist < HARPOON.maxRange - 30 && slotReady(me, "harpoon")) {
    return "harpoon";
  }
  // Tremor: they're deep inside where the quake will land.
  if (dist < TREMOR.radius * 0.75 && slotReady(me, "tremor")) return "tremor";
  // Sandtrap: seed the ground between us — or, for a melee planter, drop it
  // at the fight's centre (its own feet ARE the centre at contact range).
  // Either way, don't churn a mine already down.
  const plantRange = (dist > 150 && dist < 350) || (!rangedWeapon(me) && dist < 150);
  if (plantRange && slotReady(me, "sandtrap")) {
    const mineNearby = deployables.some(
      (d) => d.kind === "sandtrap" && d.team === me.team && Math.hypot(d.x - me.x, d.y - me.y) < 300,
    );
    if (!mineNearby) return "sandtrap";
  }
  // War Drums: speed for the pack when allies are in the aura, or for the
  // chase itself when fighting alone with ground to close.
  if (slotReady(me, "war-drums")) {
    const packedUp = players.some(
      (p) =>
        p.id !== me.id &&
        p.team === me.team &&
        p.alive &&
        Math.hypot(p.x - me.x, p.y - me.y) < WAR_DRUMS.radius,
    );
    if (packedUp || dist > 250) return "war-drums";
  }
  return null;
};
