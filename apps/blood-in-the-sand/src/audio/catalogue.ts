/**
 * Blood in the Sand's SFX catalogue: which clip each moment plays. This is
 * *content*, the authoring surface — the pure scheduler in `@heroic/core`
 * (`createSoundScheduler`) reads it and the engine's AudioDirector makes the
 * noise. Same split as Enter the Gauntlet's `audio/sounds.ts`; BITS just brings
 * its own event vocabulary (the scheduler is generic over it) because a PvP
 * arena speaks different moments than a dungeon crawl.
 *
 * The two-level model carries over: an event `type` plus an optional open-string
 * `qualifier` that picks a `variants` bank — which weapon connected, which
 * ability fired. Add a weapon or ability and it's a new variant here, never a
 * change to the event union.
 *
 * `clips` are *manifest names* (see `manifest.ts`), not files. A name with no
 * manifest entry warns once and stays silent, so this whole catalogue is safe to
 * author ahead of the actual audio — every slot below is wired now and lights up
 * the moment its clip is forged (Realmsmith → Asset Forge → BITS sound). Bank
 * names mirror the Forge's sound manifest (forge/styleBible SOUND_SUBJECTS): a
 * bank `cast_dash` forged as `cast_dash_1.mp3` fills the `["cast_dash_1"]` slot.
 */
import type { SoundBank, SoundCatalogue } from "@heroic/core";
import type { AbilityId, WeaponId } from "@heroic/blood-in-the-sand-sim";

/**
 * The moments Blood in the Sand can make noise at. Small and intentional; per
 * weapon/ability variation rides on the qualifier, so this doesn't grow when the
 * roster does.
 */
export type BitsSoundEvent =
  // ── Combat ────────────────────────────────────────────────────────────────
  | "weaponFire" //     a ranged weapon looses         (qualifier: WeaponId)
  | "weaponStrike" //   an attack connects             (qualifier: WeaponId)
  | "hitTaken" //       the LOCAL player is struck
  | "death" //          a combatant falls
  // ── Abilities ─────────────────────────────────────────────────────────────
  | "abilityCast" //    an ability fires              (qualifier: AbilityId)
  | "abilityDetonate" //a deployable goes off         (qualifier: AbilityId)
  | "harpoonWhip" //    the chain snaps out
  | "heal" //           a blood-font tick lands
  // ── Announcer (booming VO — user-supplied clips, not Forge-generated) ──────
  | "firstBlood" //     the match's first kill
  | "multiKill" //      a continuous kill chain       (qualifier: MultiKillTier)
  // ── Match flow ────────────────────────────────────────────────────────────
  | "countdownTick" //  a 3·2·1 pre-round digit
  | "roundStart" //     a new round arms
  | "fightStart" //     the "FIGHT" go
  | "roundEnd" //       a round resolves              (qualifier: win|loss|draw)
  | "matchEnd" //       the match resolves            (qualifier: win|loss)
  // ── UI ────────────────────────────────────────────────────────────────────
  | "uiTap" //          a generic button / nav tap
  | "uiConfirm" //      a positive commit (lock in, ready)
  | "uiBack" //         cancel / back
  | "uiError"; //       a rejected action

/** Per-weapon IMPACT banks (the thwack into a body). Base `clips` cover a hit
 * from an unseen weapon. Ranged weapons connect here too — distinct from their
 * release (weaponFire) — so a landed shot gets its own "it hit" confirmation. */
const STRIKE_VARIANTS: Record<WeaponId, SoundBank> = {
  blade: { clips: ["hit_blade_1"] },
  bow: { clips: ["hit_bow_1"] },
  staff: { clips: ["hit_staff_1"] },
  hammer: { clips: ["hit_hammer_1"] },
};

/** Per-weapon RELEASE banks (the bow twang / staff cast whoosh), played on the
 * `shoot` event — only ranged weapons loose a projectile, so melee has no entry
 * (keyed by weapon id as a string; an unknown qualifier just finds nothing). */
const FIRE_VARIANTS: Record<string, SoundBank> = {
  bow: { clips: ["fire_bow_1"] },
  staff: { clips: ["fire_staff_1"] },
};

/** Per-ability cast banks. A missing entry falls back to the base `cast_*` bank. */
const CAST_VARIANTS: Record<AbilityId, SoundBank> = {
  sandtrap: { clips: ["cast_sandtrap_1"] },
  tremor: { clips: ["cast_tremor_1"] },
  harpoon: { clips: ["cast_harpoon_1"] },
  dash: { clips: ["cast_dash_1"], pitchVariance: 0.1 },
  "mirror-guard": { clips: ["cast_mirror_guard_1"] },
  ironhide: { clips: ["cast_ironhide_1"] },
  "straw-man": { clips: ["cast_straw_man_1"] },
  "war-drums": { clips: ["cast_war_drums_1"] },
  "blood-font": { clips: ["cast_blood_font_1"] },
  sandstorm: { clips: ["cast_sandstorm_1"] },
};

export const SOUND_CATALOGUE: SoundCatalogue<BitsSoundEvent> = {
  // ── Combat ──────────────────────────────────────────────────────────────
  // A ranged weapon loosing a projectile — the release, on every shot (hit or
  // miss). No base bank: only bow/staff fire, so an unknown weapon is silent.
  weaponFire: { variants: FIRE_VARIANTS, pitchVariance: 0.06 },
  // Every hit thuds. Qualified by the attacker's weapon (resolved from the
  // snapshot); the generic bank covers hits from an unseen weapon. Slight pitch
  // variance so trading blows doesn't sound machine-stamped.
  weaponStrike: {
    clips: ["hit_generic_1"],
    pitchVariance: 0.08,
    variants: STRIKE_VARIANTS,
  },
  // Your own pained grunt — reserved for CRITS taken (a normal hit on you just
  // thuds; the crit is what earns the "oof"). See GameScreen's hit handler.
  hitTaken: { clips: ["player_hurt_1"], volume: 0.9, pitchVariance: 0.06 },
  // A combatant dies (player kill; straw men don't route here).
  death: { clips: ["death_1"], pitchVariance: 0.05 },

  // ── Abilities ───────────────────────────────────────────────────────────
  // The cast confirm — one per ability. Everyone hears every cast (positional
  // audio isn't modelled): the tell IS gameplay information.
  abilityCast: { clips: ["cast_generic_1"], variants: CAST_VARIANTS },
  // A sandtrap blowing — its own boom, distinct from the arming cast.
  abilityDetonate: { variants: { sandtrap: { clips: ["detonate_sandtrap_1"] } } },
  // The harpoon chain whipping out (fires alongside its cast: cast = the throw
  // grunt, whip = the chain itself).
  harpoonWhip: { clips: ["harpoon_whip_1"] },
  // A blood-font heal tick. Ticks every 0.5s inside the circle — a soft drip,
  // the default throttle keeps overlapping fonts from stacking into a drone.
  heal: { clips: ["heal_tick_1"], volume: 0.8 },

  // ── Announcer (a booming voice — clips you record/supply yourself, dropped
  // into assets/audio/sfx like any other; no pitch variance on speech) ──────
  firstBlood: { clips: ["announce_first_blood_1"] },
  multiKill: {
    variants: {
      double: { clips: ["announce_double_kill_1"] },
      multi: { clips: ["announce_multi_kill_1"] },
      mega: { clips: ["announce_mega_kill_1"] },
      ultra: { clips: ["announce_ultra_kill_1"] },
      monster: { clips: ["announce_monster_kill_1"] },
    },
  },

  // ── Match flow ──────────────────────────────────────────────────────────
  countdownTick: { clips: ["countdown_tick_1"] },
  roundStart: { clips: ["round_start_1"] },
  fightStart: { clips: ["fight_start_1"] },
  roundEnd: {
    variants: {
      win: { clips: ["round_win_1"] },
      loss: { clips: ["round_loss_1"] },
      draw: { clips: ["round_draw_1"] },
    },
  },
  matchEnd: {
    variants: {
      win: { clips: ["match_win_1"] },
      loss: { clips: ["match_loss_1"] },
    },
  },

  // ── UI ──────────────────────────────────────────────────────────────────
  uiTap: { clips: ["ui_tap_1"], volume: 0.7 },
  uiConfirm: { clips: ["ui_confirm_1"] },
  uiBack: { clips: ["ui_back_1"], volume: 0.7 },
  uiError: { clips: ["ui_error_1"] },
};
