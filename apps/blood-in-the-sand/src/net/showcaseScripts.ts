/**
 * Showcase scripts — choreographed promo footage (docs/design/
 * bits-showcase-scripts.md). One script per weapon and ability: who sits in
 * which seat with what kit, where everyone stands at every round start, and
 * what every seat's stick + cast presses are at scene time `t`. Both sides
 * are scripted; no bot brain runs in a showcase (Tom, 2026-08-29: the
 * brains looked too stupid to sell the realism and fired abilities at the
 * wrong moments — a spotlight needs the item shown ONCE, clearly, with
 * nothing else in frame).
 *
 * Rules every script obeys:
 *  - movement is clear and simple: straight lines and holds along the
 *    Primer's clean lane (scenario.ts LANE_X, north–south, crowd out of shot);
 *  - the foe never casts unless the beat needs it (none does);
 *  - attacks are automatic in reach, so scripts never "press attack" —
 *    distance IS the attack decision (holding a gap = firing; closing =
 *    swinging);
 *  - one beat per round: foe hp is set so the kill lands on cue, the round
 *    restarts, `place` re-stages. Scripts may keep per-round memory in a
 *    closure; `place(0)` is where it resets.
 *
 * Seat 0 is always the star (team 1) — the match camera follows it.
 */
import { WEAPONS, type AbilityId, type PlayerSnapshot, type SnapshotMsg, type Team, type WeaponId } from "@heroic/blood-in-the-sand-sim";
import { LANE_BOTTOM, LANE_TOP, LANE_X } from "../primer/scenario";

export interface ShowcaseSeat {
  team: Team;
  weapon: WeaponId;
  abilities: AbilityId[];
}

export interface ShowcasePlacement {
  x: number;
  y: number;
  /** Radians, 0 = +x; south (+y) is π/2. Defaults to facing seat 0 (or,
   * for seat 0, the nearest enemy seat). */
  facing?: number;
  /** Start the round at this HP (a weakened foe so the kill lands on cue). */
  hp?: number;
  /** Host-side speed multiplier — a slowed approach so a beat reads. */
  moveFactor?: number;
}

export interface ScriptInput {
  sx: number;
  sy: number;
  /** Ability slot presses (index = slot). Omit for none. */
  casts?: boolean[];
}

/** What a script sees each tick. */
export interface ScriptWorld {
  /** Seconds since the round went active. */
  t: number;
  me: PlayerSnapshot;
  players: readonly PlayerSnapshot[];
  projectiles: SnapshotMsg["projectiles"];
}

export interface ShowcaseScript {
  /** Seat ids in order; seat 0 is the star. */
  seats: ShowcaseSeat[];
  /** createSim's per-team size (the larger side; smaller sides force-start). */
  teamSize: number;
  place: (seat: number) => ShowcasePlacement;
  /** null = idle. */
  input: (seat: number, w: ScriptWorld) => ScriptInput | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const IDLE: ScriptInput = { sx: 0, sy: 0 };
const SOUTH = Math.PI / 2;
const NORTH = -Math.PI / 2;

const toward = (from: { x: number; y: number }, to: { x: number; y: number }, gain = 1): ScriptInput => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { sx: (dx / len) * gain, sy: (dy / len) * gain };
};
const away = (from: { x: number; y: number }, to: { x: number; y: number }, gain = 1): ScriptInput => {
  const t = toward(from, to, gain);
  return { sx: -t.sx, sy: -t.sy };
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

const nearestFoe = (w: ScriptWorld): PlayerSnapshot | null => {
  let best: PlayerSnapshot | null = null;
  let bd = Infinity;
  for (const p of w.players) {
    if (p.team === w.me.team || !p.alive) continue;
    const d = dist(p, w.me);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
};

/** Press the slot holding `id`, if it's ready. */
const cast = (me: PlayerSnapshot, id: AbilityId): boolean[] | undefined => {
  const slot = me.abilities.findIndex((s) => s.id === id);
  if (slot < 0) return undefined;
  const s = me.abilities[slot]!;
  if (s.cd > 0 || s.charges <= 0) return undefined;
  const casts: boolean[] = [];
  for (let i = 0; i <= slot; i++) casts.push(i === slot);
  return casts;
};
const withCast = (input: ScriptInput, casts: boolean[] | undefined): ScriptInput =>
  casts ? { ...input, casts } : input;

/** The star's default hand: the featured ability first, quiet fillers after. */
const hand = (lead: AbilityId | null, ...fillers: AbilityId[]): AbilityId[] => {
  const out: AbilityId[] = [];
  for (const a of [lead, ...fillers]) if (a && !out.includes(a) && out.length < 2) out.push(a);
  return out;
};
const QUIET: AbilityId[] = ["dash", "ironhide"];

/** Foe hp is sized in blade hits (~14 a hit after defence): 55 ≈ four,
 * so a beat lasts a few seconds rather than ending on the first swing
 * (the first shoot's harpoon kill was over in 1.5s). */
/** Stage: the star near the lane's head, the foe `gap` px south of it. */
const STAR_Y = 600;
const starAt = (extra: Partial<ShowcasePlacement> = {}): ShowcasePlacement => ({ x: LANE_X, y: STAR_Y, facing: SOUTH, ...extra });
const foeAt = (gap: number, extra: Partial<ShowcasePlacement> = {}): ShowcasePlacement => ({
  x: LANE_X,
  y: STAR_Y + gap,
  facing: NORTH,
  ...extra,
});

/** The foe's walk-in: close to `stopAt`, then stand and swing. Both fighters
 * hold at reach — a foe that pushes forever ends up standing INSIDE the
 * star (the first shoots stacked the bodies on every melee beat). */
const approach = (w: ScriptWorld, foe: PlayerSnapshot, stopAt: number): ScriptInput =>
  dist(w.me, foe) > stopAt ? toward(w.me, foe, 1) : IDLE;
/** A blade foe's stopping distance — just inside its reach. */
const BLADE_STOP = WEAPONS.blade.attack.reach + 6;
const HAMMER_STOP = WEAPONS.hammer.attack.reach * 0.85;

/** Hold the band: walk in to `band`, then step back at the foe's pace so the
 * gap sits at the edge of reach — every swing lands at full stretch. Never
 * retreats past the lane's head. */
const holdBand = (w: ScriptWorld, foe: PlayerSnapshot, band: number, backGain: number): ScriptInput => {
  const d = dist(w.me, foe);
  if (d > band + 8) return toward(w.me, foe, 1);
  if (d < band - 8 && w.me.y > LANE_TOP + 40) return away(w.me, foe, backGain);
  return IDLE;
};

/** A simple 1v1: the star at the head of the lane, one foe walking up it. */
const duel = (
  star: ShowcaseSeat,
  foe: ShowcaseSeat,
  placeStar: ShowcasePlacement,
  placeFoe: ShowcasePlacement,
  input: (seat: 0 | 1, w: ScriptWorld, foe: PlayerSnapshot) => ScriptInput | null,
  teamSize = 1,
): ShowcaseScript => ({
  seats: [star, foe],
  teamSize,
  place: (seat) => (seat === 0 ? placeStar : placeFoe),
  input: (seat, w) => {
    const other = nearestFoe(w);
    if (!other || !w.me.alive) return null;
    return input(seat as 0 | 1, w, other);
  },
});

const BLADE_FOE: ShowcaseSeat = { team: 2, weapon: "blade", abilities: QUIET };
const HAMMER_FOE: ShowcaseSeat = { team: 2, weapon: "hammer", abilities: QUIET };
const BOW_FOE: ShowcaseSeat = { team: 2, weapon: "bow", abilities: QUIET };

// ── Weapons ───────────────────────────────────────────────────────────────

/** Melee — hold the band (bits-showcase-scripts.md § weapons). */
const meleeScript = (weapon: WeaponId): ShowcaseScript => {
  const atk = WEAPONS[weapon].attack;
  // Trident holds INSIDE its annular band (min-reach is its story).
  const band = atk.minReach !== undefined ? (atk.minReach + atk.reach) / 2 + 12 : atk.reach * 0.85 + 12;
  return duel(
    { team: 1, weapon, abilities: QUIET },
    BLADE_FOE,
    starAt(),
    foeAt(230, { hp: 55, moveFactor: 0.5 }),
    (seat, w, foe) => (seat === 0 ? holdBand(w, foe, band, 0.5) : approach(w, foe, BLADE_STOP)),
  );
};

/** Is any projectile inbound on `p` — within `within` px and travelling
 * toward it? (Snapshots carry position + heading only.) */
const inboundShot = (w: ScriptWorld, p: PlayerSnapshot, within: number): { id: number } | null => {
  for (const s of w.projectiles) {
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const d = Math.hypot(dx, dy);
    if (d > within) continue;
    if (dx * Math.cos(s.angle) + dy * Math.sin(s.angle) > 0) return s;
  }
  return null;
};

/** Ranged — the shot is the story, so the FOE has to make it interesting
 * (Tom, 2026-08-29: the straight-walking foe made bow and staff "look
 * awful" — every shot landed, the staff's orb never had to turn). The foe
 * walks up the lane and DASHES sideways out of the first two shots: the
 * bow's arrows whiff past a dodging body — then the third lands; the
 * staff's orb bends after the hop and catches it anyway ("you can't
 * outrun it"). The star stands and fires, and when the foe closes inside
 * half reach it dashes ONCE back up the lane to reopen the gap — the
 * ranged player's dash — then gives ground slowly; the foe dies a step
 * short. */
const rangedScript = (weapon: WeaponId): ShowcaseScript => {
  const reach = WEAPONS[weapon].attack.reach;
  // A homing orb catches every hop, so two hops then two hits (17–26 each:
  // hp 33 dies to the second — 45 survived on 2hp and reached grips, first
  // shoot). Fast arrows really whiff, so sell three dodges before two land.
  const homing = WEAPONS[weapon].projectile?.homingTurnRate !== undefined;
  const DODGES = homing ? 2 : 3;
  // Rolls are fixed per take (seed 7): staff lands 26/17/14, bow 31/14 —
  // so the staff foe dies on the THIRD orb (two hops shown, dash cooldown
  // is 3s so a hop per ~1.5s orb is impossible), the bow foe on the second
  // arrow after the whiff. Check with `bun scripts/dry-run.ts`.
  // Scorpion's bolts are small and rapid (10/7/6/6/6…): 35 dies on the
  // burst after the second hop, still a step short of grips.
  const FOE_HP = weapon === "scorpion" ? 35 : homing ? 56 : 45;
  let dodgesLeft = DODGES;
  let dodgedAt = -9;
  let dodgeSign = 1;
  let starDashed = false;
  const script = duel(
    { team: 1, weapon, abilities: QUIET },
    BLADE_FOE,
    starAt(),
    // Two hits kill (orb/arrow ≈ 24+); the slow walk-in leaves the shooter
    // time to land them — at 0.7 a blade foe reached grips before the
    // staff's second orb (first shoot: the star died).
    foeAt(reach * 0.85, { hp: FOE_HP, moveFactor: 0.3 }),
    (seat, w, foe) => {
      if (seat === 1) {
        // The dodge: a shot is close and coming — hop perpendicular to it,
        // alternating sides so the second dodge reads as a different move.
        // Then keep walking in (the dash rides the stick, so the hop is the
        // stick direction for that tick).
        const shot = inboundShot(w, w.me, 150);
        if (shot && dodgesLeft > 0 && w.t - dodgedAt > 0.8) {
          const casts = cast(w.me, "dash");
          if (casts) {
            dodgesLeft -= 1;
            dodgedAt = w.t;
            dodgeSign = -dodgeSign;
            return { sx: dodgeSign, sy: 0, casts };
          }
        }
        // Straight after a hop, let the whiff show before pressing on.
        if (w.t - dodgedAt < 0.45) return IDLE;
        return approach(w, foe, BLADE_STOP);
      }
      const d = dist(w.me, foe);
      // The foe is nearly at grips: one dash back up the lane, then give
      // ground slowly; never past the lane's head. (Dashing at half reach
      // carried the star out of the staff's range — the kill came late and
      // the foe reached its feet; dry-run.)
      if (!starDashed && d < 150 && w.me.y > LANE_TOP + 110) {
        const casts = cast(w.me, "dash");
        if (casts) {
          starDashed = true;
          return { sx: 0, sy: -1, casts };
        }
      }
      return d < reach * 0.35 && w.me.y > LANE_TOP + 40 ? away(w.me, foe, 0.5) : IDLE;
    },
  );
  const place = script.place;
  script.place = (seat) => {
    if (seat === 0) {
      dodgesLeft = DODGES;
      dodgedAt = -9;
      starDashed = false;
    }
    return place(seat);
  };
  return script;
};

/** Bombard — indirect fire needs a STILL shooter: shells land where the foe
 * was, and it walks through two blasts to the third. */
const bombardScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "bombard", abilities: QUIET },
    BLADE_FOE,
    starAt(),
    foeAt(300, { hp: 70, moveFactor: 0.45 }),
    (seat, w, foe) => (seat === 0 ? IDLE : toward(w.me, foe, 1)),
  );

/** Fang — hit-and-step: close, one nick, back out of reach while the poison
 * ticks show, close again. Stacking is the story. */
const fangScript = (): ShowcaseScript => {
  const reach = WEAPONS.fang.attack.reach;
  return duel(
    { team: 1, weapon: "fang", abilities: QUIET },
    BLADE_FOE,
    starAt(),
    foeAt(200, { hp: 60, moveFactor: 0.4 }),
    (seat, w, foe) => {
      if (seat === 1) return toward(w.me, foe, 1);
      const phase = w.t % 2.6;
      if (phase < 1.0) return toward(w.me, foe, 1); // step in and nick
      return dist(w.me, foe) < reach + 70 && w.me.y > LANE_TOP + 40 ? away(w.me, foe, 0.7) : IDLE;
    },
  );
};

/** Lifeline — 2v2 (Tom): one fighter a side trades blows in the middle,
 * one healer a side stands behind and pours. Seat 0 is OUR healer (the
 * camera's on the pour); seats 1/2 are the fighters, 3 the enemy healer. */
const lifelineScript = (): ShowcaseScript => {
  const bladeBand = WEAPONS.blade.attack.reach * 0.85 + 12;
  const MID = STAR_Y + 200;
  return {
    seats: [
      { team: 1, weapon: "lifeline", abilities: QUIET },
      { team: 1, weapon: "blade", abilities: QUIET },
      { team: 2, weapon: "blade", abilities: QUIET },
      { team: 2, weapon: "lifeline", abilities: QUIET },
    ],
    teamSize: 2,
    place: (seat) => {
      switch (seat) {
        case 0:
          return { x: LANE_X - 40, y: MID - 190, facing: SOUTH };
        case 1:
          return { x: LANE_X, y: MID - 60, facing: SOUTH };
        case 2:
          return { x: LANE_X, y: MID + 60, facing: NORTH };
        default:
          return { x: LANE_X + 40, y: MID + 190, facing: NORTH };
      }
    },
    input: (seat, w) => {
      if (!w.me.alive) return null;
      if (seat === 0 || seat === 3) return IDLE; // the beam finds its patient by itself
      const foe = w.players.find((p) => p.id === (seat === 1 ? 2 : 1));
      if (!foe || !foe.alive) return IDLE;
      return holdBand(w, foe, bladeBand, 0.6);
    },
  };
};

// ── Abilities ─────────────────────────────────────────────────────────────

const sandtrapScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("sandtrap", "dash") },
    BLADE_FOE,
    starAt(),
    foeAt(280, { hp: 60, moveFactor: 0.6 }),
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, BLADE_STOP);
      // Plant at the feet, back off two steps, let it walk over.
      if (w.t < 0.35) return withCast(IDLE, cast(w.me, "sandtrap"));
      if (w.t < 1.6) return away(w.me, foe, 0.7);
      return IDLE;
    },
  );

const tremorScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("tremor", "dash") },
    BLADE_FOE,
    starAt(),
    foeAt(260, { hp: 55, moveFactor: 0.5 }),
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, BLADE_STOP);
      // Close to the zone's edge, stomp, hold still while it shakes.
      const d = dist(w.me, foe);
      if (d > 200) return toward(w.me, foe, 1);
      return withCast(IDLE, cast(w.me, "tremor"));
    },
  );

const harpoonScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("harpoon", "dash") },
    BLADE_FOE,
    starAt(),
    foeAt(300, { hp: 60, moveFactor: 0.5 }),
    (seat, w) => {
      if (seat === 1) return IDLE; // nothing moves but the victim
      return w.t > 0.8 ? withCast(IDLE, cast(w.me, "harpoon")) : IDLE;
    },
  );

/** Dash — the game's central skill: out of the hammer's telegraph, then
 * the punish. (First shoot: rolling AT the foe just landed on top of it —
 * the dodge has to be LATERAL to read.) */
const dashScript = (): ShowcaseScript => {
  const hammerBand = WEAPONS.hammer.attack.reach * 0.85; // inside its reach, so it commits
  let dodgedAt = -1;
  const script = duel(
    { team: 1, weapon: "blade", abilities: hand("dash", "ironhide") },
    HAMMER_FOE,
    starAt(),
    foeAt(240, { hp: 70, moveFactor: 0.6 }),
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, HAMMER_STOP);
      const d = dist(w.me, foe);
      // The swing is coming: roll sideways out of the cone (the dash rides
      // the stick — perpendicular to the foe line, east).
      if (foe.atk === "windup" && d < hammerBand + 30 && w.t - dodgedAt > 2.5) {
        const dx = foe.x - w.me.x;
        const dy = foe.y - w.me.y;
        const len = Math.hypot(dx, dy) || 1;
        dodgedAt = w.t;
        return withCast({ sx: -dy / len, sy: dx / len }, cast(w.me, "dash"));
      }
      // Just rolled: close to blade reach and punish while it recovers;
      // then sit at the hammer's edge again and let it commit once more.
      const bladeBand = WEAPONS.blade.attack.reach * 0.85 + 12;
      if (dodgedAt >= 0 && w.t - dodgedAt < 1.3) return holdBand(w, foe, bladeBand, 0.8);
      return holdBand(w, foe, hammerBand, 0.6);
    },
  );
  const place = script.place;
  script.place = (seat) => {
    if (seat === 0) dodgedAt = -1;
    return place(seat);
  };
  return script;
};

const mirrorGuardScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("mirror-guard", "dash") },
    BOW_FOE,
    starAt(),
    foeAt(300, { hp: 15 }),
    (seat, w) => {
      if (seat === 1) return IDLE; // stands and fires
      // Take the first arrow on the chin, then raise the guard as the next
      // one flies — the return is the beat, and it lands mid-clip rather
      // than the instant the fight starts (first shoot).
      return w.t > 1.6 && w.projectiles.length > 0 ? withCast(IDLE, cast(w.me, "mirror-guard")) : IDLE;
    },
  );

const ironhideScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("ironhide", "dash") },
    HAMMER_FOE,
    starAt(),
    foeAt(240, { hp: 55, moveFactor: 0.6 }),
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, HAMMER_STOP);
      const d = dist(w.me, foe);
      const walk = d > 100 ? toward(w.me, foe, 0.6) : IDLE;
      // Harden as the swing comes, take it standing, keep walking.
      return foe.atk === "windup" && d < 170 ? withCast(walk, cast(w.me, "ironhide")) : walk;
    },
  );

const strawManScript = (): ShowcaseScript => {
  let plantedAt = -1;
  const script = duel(
    { team: 1, weapon: "blade", abilities: hand("straw-man", "dash") },
    BLADE_FOE,
    starAt(),
    foeAt(260, { hp: 55, moveFactor: 0.8 }),
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, BLADE_STOP);
      const d = dist(w.me, foe);
      if (plantedAt < 0) {
        if (d > 200) return toward(w.me, foe, 1);
        plantedAt = w.t;
        return withCast(IDLE, cast(w.me, "straw-man"));
      }
      // A short step west while it swings at straw (the first shoot walked
      // 1.4s east into the crowd band), then come back in at blade reach.
      if (w.t - plantedAt < 0.7) return { sx: -0.8, sy: 0.1 };
      return holdBand(w, foe, WEAPONS.blade.attack.reach * 0.85 + 12, 0.6);
    },
  );
  const place = script.place;
  script.place = (seat) => {
    if (seat === 0) plantedAt = -1;
    return place(seat);
  };
  return script;
};

const wardingShoutScript = (): ShowcaseScript => {
  let shoutedAt = -1;
  const script = duel(
    { team: 1, weapon: "blade", abilities: hand("warding-shout", "dash") },
    BLADE_FOE,
    starAt(),
    foeAt(260, { hp: 55, moveFactor: 0.8 }),
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, BLADE_STOP);
      const d = dist(w.me, foe);
      // Let it come into the lock, then shout it away — and again every
      // time it walks back in (three charges; the beat repeats in-clip).
      if (d < 110 && (shoutedAt < 0 || w.t - shoutedAt > 3)) {
        shoutedAt = w.t;
        return withCast(IDLE, cast(w.me, "warding-shout"));
      }
      if (shoutedAt < 0) return IDLE;
      // Three steps back — nothing can target you — then hold at blade
      // reach and let it come again (the first shoot chased the flung foe
      // to the south wall and stacked on it).
      if (w.t - shoutedAt < 1.2 && w.me.y > LANE_TOP + 40) return away(w.me, foe, 0.6);
      return holdBand(w, foe, WEAPONS.blade.attack.reach * 0.85 + 12, 0.6);
    },
  );
  const place = script.place;
  script.place = (seat) => {
    if (seat === 0) shoutedAt = -1;
    return place(seat);
  };
  return script;
};

/** War Drums — speed only reads against a chaser: run, the gap holds; drum,
 * the gap opens; turn and fight. The foe starts north (behind) of the star.
 * Both jog at ~half speed: the lane is only ~470px, and at full tilt the
 * star hit its foot before the drums could open the gap (first shoot). */
const warDrumsScript = (): ShowcaseScript => {
  const JOG = 0.5;
  return duel(
    { team: 1, weapon: "blade", abilities: hand("war-drums", "dash") },
    BLADE_FOE,
    starAt({ y: 520, facing: SOUTH }),
    { x: LANE_X, y: 410, facing: SOUTH, hp: 55, moveFactor: JOG },
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, BLADE_STOP);
      const run: ScriptInput = { sx: 0, sy: JOG };
      if (w.t < 0.9) return run;
      if (w.t < 4.0 && w.me.y < LANE_BOTTOM - 30) return withCast(run, cast(w.me, "war-drums"));
      return holdBand(w, foe, WEAPONS.blade.attack.reach * 0.85 + 12, 0.6);
    },
  );
};

/** Blood Font — start hurt, pour, stand in it: three ticks show before the
 * fight it would otherwise have lost. */
const bloodFontScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("blood-font", "dash") },
    BLADE_FOE,
    starAt({ hp: 40 }),
    foeAt(420, { hp: 60, moveFactor: 0.4 }),
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, BLADE_STOP);
      return w.t > 0.3 ? withCast(IDLE, cast(w.me, "blood-font")) : IDLE;
    },
  );

const sandstormScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("sandstorm", "dash") },
    BOW_FOE,
    starAt(),
    foeAt(300, { hp: 45 }),
    (seat, w, foe) => {
      if (seat === 1) return IDLE; // stands and fires — until it can't
      if (w.t < 0.9) return IDLE; // take an arrow or two first
      if (w.t < 2.8) return withCast(IDLE, cast(w.me, "sandstorm"));
      return toward(w.me, foe, 1); // step out the near side and close
    },
  );

/** Sinkhole — everyone static, thrown into a triangle of three (Tom). The
 * pot lands 200px along the facing; the hole's radius (260) swallows the
 * whole triangle wherever it lands inside it. The hole pulls BOTH teams and
 * its radius (260) is longer than the throw (200), so the thrower always
 * stands inside its own hole: the star is a BOW that throws, backs north
 * out of the pull during the pot's flight, and shoots into the clump from
 * outside (Tom, 2026-08-29: "place me further away so I don't get sucked
 * in, and give me a bow"; the first two shoots ended with the star hauled
 * into three blades). */
const sinkholeScript = (): ShowcaseScript => {
  const CX = LANE_X;
  const CY = STAR_Y + 230;
  const tri: ShowcasePlacement[] = [
    { x: CX, y: CY - 80, facing: NORTH, hp: 35 },
    { x: CX - 95, y: CY + 60, facing: NORTH, hp: 35 },
    { x: CX + 95, y: CY + 60, facing: NORTH, hp: 35 },
  ];
  return {
    seats: [
      { team: 1, weapon: "bow", abilities: hand("sinkhole", "dash") },
      BLADE_FOE,
      BLADE_FOE,
      BLADE_FOE,
    ],
    teamSize: 3,
    place: (seat) => (seat === 0 ? starAt() : tri[seat - 1]!),
    input: (seat, w) => {
      if (!w.me.alive) return null;
      if (seat !== 0) return IDLE;
      if (w.t < 0.6) return IDLE;
      if (w.t < 0.8) return withCast(IDLE, cast(w.me, "sinkhole"));
      // Out of the pull: the hole opens at STAR_Y + 200; stand 320 north of
      // it (radius is 260), still inside the bow's 360.
      return w.me.y > STAR_Y - 120 ? { sx: 0, sy: -1 } : IDLE;
    },
  };
};

/** Tar Pit — the roster's only movement-expressed ability: one gentle curve
 * away from a chaser, laying tar; the chaser hits it and crawls. */
const tarPitScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("tar-pit", "dash") },
    BLADE_FOE,
    starAt({ y: 560, facing: SOUTH }),
    { x: LANE_X, y: 430, facing: SOUTH, hp: 55, moveFactor: 1 },
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, BLADE_STOP);
      const curve: ScriptInput = { sx: 0.3 * Math.sin(w.t * 1.1), sy: 1 };
      if (w.t < 0.25) return curve;
      if (w.t < 3.0 && w.me.y < LANE_BOTTOM - 40) return withCast(curve, cast(w.me, "tar-pit"));
      return toward(w.me, foe, 1);
    },
  );

const titansDraughtScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "hammer", abilities: hand("titans-draught", "dash") },
    BLADE_FOE,
    starAt(),
    foeAt(220, { hp: 40 }),
    (seat, w, foe) => {
      if (seat === 1) return IDLE;
      if (w.t < 0.4) return IDLE;
      if (w.t < 1.5) return withCast(IDLE, cast(w.me, "titans-draught")); // drink, grow
      return toward(w.me, foe, 1); // crush
    },
  );

/** Shard of True Ice — a charging blade is entombed mid-stride: the star
 * freezes the diver, strolls clear while the swings-that-would-have-landed
 * read IMMUNE on the block, then turns and finishes the thawed foe. */
const trueIceScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("true-ice", "dash") },
    BLADE_FOE,
    starAt(),
    foeAt(300, { hp: 30 }),
    (seat, w, foe) => {
      if (seat === 1) return approach(w, foe, BLADE_STOP);
      if (w.t < 1.0) return IDLE; // let the charge build
      if (w.t < 1.2) return withCast(IDLE, cast(w.me, "true-ice"));
      if (w.t < 3.6) return away(w.me, foe, 0.7); // stroll clear of the tomb
      return toward(w.me, foe, 1); // the thaw — now the fight resumes
    },
  );

/** Magic Mirror — a 1v1 swap trades places without changing the GAP, so the
 * story needs a pincer (the sinkhole's 1v3 staging): two blades herd the
 * bow star up the lane while the mirror's round-start lock burns off — the
 * whole wait IS the pitch — then the star trades places with the loiterer
 * hanging back at the FAR end: out of the jaws in a violet blink, shooting
 * the pack down from behind while the traded foe stands stranded in the
 * corner the star just left. */
const magicMirrorScript = (): ShowcaseScript => {
  // The divers start OUTSIDE the bow's lock range (430 > 380 engagement) and
  // the star gives ground at exactly their pace — the herding holds the gap,
  // so no arrow flies before the trade (the wait must read as a problem the
  // bow can't solve).
  const divers: ShowcasePlacement[] = [
    { x: LANE_X - 75, y: STAR_Y + 440, facing: NORTH, hp: 30, moveFactor: 0.4 },
    { x: LANE_X + 75, y: STAR_Y + 440, facing: NORTH, hp: 30, moveFactor: 0.4 },
  ];
  // The mark: hangs deep south, creeping — always the furthest enemy.
  const anchor: ShowcasePlacement = { x: LANE_X, y: STAR_Y + 620, facing: NORTH, hp: 30, moveFactor: 0.3 };
  return {
    seats: [
      { team: 1, weapon: "bow", abilities: hand("magic-mirror", "dash") },
      BLADE_FOE,
      BLADE_FOE,
      BLADE_FOE,
    ],
    teamSize: 3,
    place: (seat) => (seat === 0 ? starAt() : seat === 3 ? anchor : divers[seat - 1]!),
    input: (seat, w) => {
      if (!w.me.alive) return null;
      const foe = nearestFoe(w);
      if (seat !== 0) return foe ? toward(w.me, foe, 1) : IDLE;
      if (!foe) return IDLE;
      // Give ground at the divers' own pace until the mirror lights — the
      // gap holds just outside the bow's lock, so nothing fires. Then trade.
      if (w.t < 5.1) return dist(w.me, foe) < 440 ? away(w.me, foe, 0.4) : IDLE;
      if (w.t < 5.5) return withCast(IDLE, cast(w.me, "magic-mirror"));
      // At the anchor's far corner now — walk back INTO bow range and shoot
      // the pack down from behind.
      return dist(w.me, foe) > 330 ? toward(w.me, foe, 0.6) : IDLE;
    },
  };
};

/** Elven Cloak — a bow foe is winning the range war until the star fades:
 * the lock breaks mid-volley, the arrows stop, and a ghost walks calmly
 * through the standoff and re-materialises at sword's length. */
const elvenCloakScript = (): ShowcaseScript =>
  duel(
    { team: 1, weapon: "blade", abilities: hand("elven-cloak", "dash") },
    BOW_FOE,
    starAt(),
    foeAt(300, { hp: 30 }),
    (seat, w, foe) => {
      if (seat === 1) return IDLE; // stands and fires — until there's nothing to fire at
      if (w.t < 1.2) return IDLE; // take an arrow first: the problem on screen
      if (w.t < 1.5) return withCast(IDLE, cast(w.me, "elven-cloak"));
      return toward(w.me, foe, 1); // the unseen walk
    },
  );

// ── The table ─────────────────────────────────────────────────────────────

const RANGED: readonly WeaponId[] = ["bow", "staff", "scorpion"];

export const weaponScript = (weapon: WeaponId): ShowcaseScript => {
  switch (weapon) {
    case "bombard":
      return bombardScript();
    case "fang":
      return fangScript();
    case "lifeline":
      return lifelineScript();
    default:
      return RANGED.includes(weapon) ? rangedScript(weapon) : meleeScript(weapon);
  }
};

const ABILITY_SCRIPTS: Record<AbilityId, () => ShowcaseScript> = {
  sandtrap: sandtrapScript,
  tremor: tremorScript,
  harpoon: harpoonScript,
  dash: dashScript,
  "mirror-guard": mirrorGuardScript,
  ironhide: ironhideScript,
  "straw-man": strawManScript,
  "warding-shout": wardingShoutScript,
  "war-drums": warDrumsScript,
  "blood-font": bloodFontScript,
  sandstorm: sandstormScript,
  sinkhole: sinkholeScript,
  "tar-pit": tarPitScript,
  "titans-draught": titansDraughtScript,
  "true-ice": trueIceScript,
  "magic-mirror": magicMirrorScript,
  "elven-cloak": elvenCloakScript,
};

export const abilityScript = (id: AbilityId): ShowcaseScript => ABILITY_SCRIPTS[id]();
