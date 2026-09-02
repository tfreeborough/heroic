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
  | "reflect" //        Mirror Guard turns a shot around (Wave-2 reflect event)
  | "death" //          a combatant falls
  | "crowdCheer" //     the pit mob roars when YOUR side scores (8-take bank, randomised)
  | "crowdJeer" //      the pit mob groans when the ENEMY scores on you (bank, randomised)
  | "squelch" //        bloody footsteps — stepping through a fresh pool (bits-blood.md)
  // ── Abilities ─────────────────────────────────────────────────────────────
  | "abilityCast" //    an ability fires              (qualifier: AbilityId)
  | "abilityDetonate" //a deployable goes off         (qualifier: AbilityId)
  | "harpoonWhip" //    the chain snaps out
  | "quakeRumble" //    tremor's 4s earthquake bed (rolls under the cast stomp)
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
  | "startCancelled" // a bot-filled start vetoed — the veil collapses (bits-bot-backfill.md)
  // ── Ranked (bits-ranked.md § audio owed) ──────────────────────────────────
  | "queueMatchFound" //the matcher paired you — the summons (the accept sheet's rise)
  | "rankUp" //         the displayed rank climbed (server-computed rankChange)
  | "rankDown" //       …or slipped — deliberately subtle, never punishing
  | "gloryEarned" //    the Glory payout lands on the ceremony plate
  | "ceremonyShift" //  the ceremony's fade from Glory to the rating reveal
  | "deedUnlock" //     a deed card stamps in on the ceremony (achievements.md)
  // ── Store (bits-store.md § premium bar) ───────────────────────────────────
  | "signetExchange" //   Glory becomes a Signet — the licence is stamped
  | "signetUnlock" //     a Signet is spent — the seal breaks, the item is yours
  | "signetPurchase" //   a bought Signet pack banks (IAP credit / crash-replay)
  // ── UI ────────────────────────────────────────────────────────────────────
  | "uiTap" //          a generic button / nav tap
  | "uiConfirm" //      a positive commit (lock in, ready)
  | "uiBack" //         cancel / back
  | "uiError" //        a rejected action
  | "modeReveal" //     the mode-select stack lands (bits-mode-select.md)
  | "titleGust"; //     a dust squall crosses the title screen

/** Per-weapon IMPACT banks (the thwack into a body). Base `clips` cover a hit
 * from an unseen weapon. Ranged weapons connect here too — distinct from their
 * release (weaponFire) — so a landed shot gets its own "it hit" confirmation. */
const STRIKE_VARIANTS: Record<WeaponId, SoundBank> = {
  blade: { clips: ["hit_blade_1"] },
  bow: { clips: ["hit_bow_1"] },
  staff: { clips: ["hit_staff_1"] },
  hammer: { clips: ["hit_hammer_1"] },
  // Owed from the Forge — silent until hit_trident_1 lands: a wet piercing
  // punch-through, sharper and shorter than the blade's slice.
  trident: { clips: ["hit_trident_1"] },
  // A 3-take bank (forged 2026-08-09) — the scheduler picks at random,
  // never the same take twice running, so the fang's rapid cycle doesn't
  // machine-stamp. Fast shallow nicks; the venom is the loud part.
  fang: { clips: ["hit_fang_1", "hit_fang_2", "hit_fang_3"] },
  // Owed from the Forge — silent until hit_scorpion_1 lands: a short hard
  // bolt punch, snappier and smaller than the bow's thwack (three land in
  // under half a second, so it must stay tight).
  scorpion: { clips: ["hit_scorpion_1"] },
  // Owed from the Forge — the blast concussion on a caught body. Plays
  // UNDER the detonate boom (the shell reuses the sandtrap's detonate
  // event), so keep it a short bodily thump, not a second explosion.
  bombard: { clips: ["hit_bombard_1"] },
  // The lifeline deals NO damage (the snap was cut, Tom 2026-08-14) — no
  // hit event ever carries this weapon, so the bank is deliberately empty.
  // Its audio IS the heal event's own tick (heal_tick_1), already wired.
  lifeline: { clips: [] },
};

/** Per-weapon RELEASE banks (the bow twang / staff cast whoosh), played on the
 * `shoot` event — only ranged weapons loose a projectile, so melee has no entry
 * (keyed by weapon id as a string; an unknown qualifier just finds nothing). */
const FIRE_VARIANTS: Record<string, SoundBank> = {
  bow: { clips: ["fire_bow_1"] },
  staff: { clips: ["fire_staff_1"] },
  // Owed from the Forge — the volley plays this THREE times ~0.13s apart
  // (one shoot event per bolt), so forge a single dry clack, not a burst.
  scorpion: { clips: ["fire_scorpion_1"] },
  // Owed from the Forge — the launch thoomp; the landing boom is the
  // detonate event's own sound, so no explosion here.
  bombard: { clips: ["fire_bombard_1"] },
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
  // Owed from the Forge — silent until cast_warding_shout_1 lands (the rule
  // above: a missing manifest entry warns once, the slot lights up on forge).
  "warding-shout": { clips: ["cast_warding_shout_1"] },
  "war-drums": { clips: ["cast_war_drums_1"] },
  "blood-font": { clips: ["cast_blood_font_1"] },
  sandstorm: { clips: ["cast_sandstorm_1"] },
  // Owed from the Forge — silent until cast_sinkhole_1 lands: sand
  // collapsing inward into a hungry spiral, a deep grinding pour.
  sinkhole: { clips: ["cast_sinkhole_1"] },
  // A 3-take bank (forged 2026-08-10) — random pick per cast, never the
  // same take twice running (the scheduler's rule).
  "tar-pit": { clips: ["cast_tar_pit_1", "cast_tar_pit_2", "cast_tar_pit_3"] },
  // A 3-take bank (grew from 2, 2026-08-14) — random pick per cast, never
  // the same take twice running; the third take breaks the strict
  // alternation two forced.
  "titans-draught": {
    clips: ["cast_titans_draught_1"],
  },
  // Owed from the Forge — silent until cast_true_ice_1 lands: a crystalline
  // crack-and-chime, the shard leaving the hand and the tomb slamming shut.
  "true-ice": { clips: ["cast_true_ice_1"] },
  // Owed from the Forge — silent until cast_magic_mirror_1 lands: a rising
  // glassy shimmer the length of the telegraph, so the victim HEARS it too.
  "magic-mirror": { clips: ["cast_magic_mirror_1"] },
  // Owed from the Forge — silent until cast_elven_cloak_1 lands: a soft
  // woven whoosh, quieter than every other cast (hiding should sound like it).
  "elven-cloak": { clips: ["cast_elven_cloak_1"] },
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
  // Owed from the Forge — silent until reflect_1 lands: Mirror Guard turning
  // a shot (the Wave-2 reflect event) — a bright metallic parry ting with a
  // whip of departure, short; the turned shot's own flight sound carries on.
  reflect: { clips: ["reflect_1"], pitchVariance: 0.05 },
  // A combatant dies (player kill; straw men don't route here).
  death: { clips: ["death_1"], pitchVariance: 0.05 },
  // The pit crowd erupting at a kill — an 8-take bank the scheduler picks from at
  // random (never the same take twice running) plus a wide pitch wobble, so a
  // busy match never sounds like one looped roar. Non-positional. Only fires when
  // YOUR side scores (the team gate lives in GameScreen's death handler).
  // throttleMs 0 = NO backoff: every enemy death gets its own cheer, and kills in
  // quick succession just LAYER (one-shots on separate voices — a second cheer
  // never cuts the first) so a teamfight wipe reads as the crowd swelling louder.
  // (An earlier 3s throttle was swallowing the 2nd kill of a cluster — the "why
  // didn't it cheer?" — and there's no reason to gate overlapping crowd roars.)
  crowdCheer: {
    clips: [
      "crowd_cheer_1",
      "crowd_cheer_2",
      "crowd_cheer_3",
      "crowd_cheer_4",
      "crowd_cheer_5",
      "crowd_cheer_6",
      "crowd_cheer_7",
      "crowd_cheer_8",
    ],
    pitchVariance: 0.12,
    throttleMs: 0,
    volume: 0.85,
  },
  // The flip side of crowdCheer — the pit's disappointed groan when YOUR side is
  // scored on (a teammate or you falls). Same random-take + pitch-wobble + team
  // gate (GameScreen); a lower "oooh"/grumble, not a cheer. Its OWN throttle key,
  // so a jeer and a cheer never gate each other. throttleMs 0 like the cheers —
  // every loss groans, overlapping groans just deepen the collective dismay.
  // ADJUST the clip list to match however many takes you forge.
  crowdJeer: {
    clips: ["crowd_jeer_1", "crowd_jeer_2", "crowd_jeer_3", "crowd_jeer_4"],
    pitchVariance: 0.12,
    throttleMs: 0,
    volume: 0.8,
  },

  // Stepping through a fresh pool re-inks your soles (blood.ts footprints,
  // bits-blood.md §6): one wet squelch per pool-crossing, not per stamped
  // print. Throttled so a teamfight wading through the same kill site doesn't
  // stack into a swamp.
  squelch: {
    clips: ["blood_squelch_1"],
    volume: 0.7,
    pitchVariance: 0.1,
    throttleMs: 300,
  },

  // ── Abilities ───────────────────────────────────────────────────────────
  // The cast confirm — one per ability. Everyone hears every cast (positional
  // audio isn't modelled): the tell IS gameplay information.
  abilityCast: { clips: ["cast_generic_1"], variants: CAST_VARIANTS },
  // A sandtrap blowing — its own boom, distinct from the arming cast.
  abilityDetonate: { variants: { sandtrap: { clips: ["detonate_sandtrap_1"] } } },
  // The harpoon chain whipping out (fires alongside its cast: cast = the throw
  // grunt, whip = the chain itself).
  harpoonWhip: { clips: ["harpoon_whip_1"] },
  // The tremor's earthquake itself — a rolling bed fired alongside the cast
  // (cast = the sharp stomp tell, this = the ground going). The shipped clip
  // is re-mastered HOT (-12 LUFS vs the fleet's -16, +4dB high shelf at
  // 1kHz): a sustained rumble at fleet loudness disappears on a phone
  // speaker — equal-loudness + speaker bass rolloff — so it needs both the
  // level and the midrange crackle to read. Keep any re-forge mastered hot.
  quakeRumble: { clips: ["quake_rumble_1"] },
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
  // Owed from the Forge — silent until start_cancelled_1 lands (the missing-
  // manifest rule); a deflating "stand down" beat, not a defeat sting.
  startCancelled: { clips: ["start_cancelled_1"] },

  // ── Ranked (all four owed from the Forge — silent until their clips land;
  // the settle sounds fire off the server's rankedResult, never client math) ─
  queueMatchFound: { clips: ["queue_match_found_1"] },
  // The promotion fanfare — a ~5-net-win event since divisions, so it can
  // afford to be BIG. Layers after the match_win sting by arrival order.
  rankUp: { clips: ["rank_up_1"] },
  // Deliberately subtle (bits-ranked.md: "subtle, non-punishing") — losing
  // already stings; the badge slipping shouldn't twist it.
  rankDown: { clips: ["rank_down_1"], volume: 0.6 },
  // A low wordless choral swell — the legend growing. Deliberately NOT a
  // coin sound (Tom, 2026-08-01): Glory is renown, and players must never
  // read it as money. The one human-voice texture outside the announcer.
  gloryEarned: { clips: ["glory_earned_1"], volume: 0.8 },
  // Owed from the Forge — silent until ceremony_shift_1 lands: a soft airy
  // whoosh as the post-match ceremony crossfades from the Glory count to the
  // rating reveal (RankedCeremony). Transition texture, not a stinger.
  ceremonyShift: { clips: ["ceremony_shift_1"], volume: 0.7 },
  // Owed from the Forge — silent until deed_unlock_1 lands: the DEED
  // COMPLETE stamp (achievements.md § unlock ceremony) — a wax-seal thunk
  // with a short bright tail; triumphant but shorter and smaller than
  // rank_up, since first matches pop 2–3 back-to-back.
  deedUnlock: { clips: ["deed_unlock_1"] },

  // ── Store (bits-store.md § premium bar) ─────────────────────────────────
  // THE STRIKE at the top of the Signet Forge's hold-to-forge ritual
  // (SignetForge.tsx) — plays the instant the held charge completes and the
  // stamp slams. The 850ms hold before it is deliberately silent (haptics
  // carry the climb; a charge-loop hiss is a possible later layer).
  signetExchange: { clips: ["signet_exchange_1"] },
  // The SEAL BREAKS on the unlock ceremony — forged 2026-08-15 (brief
  // lesson lives in the forge styleBible: build crack sounds from real
  // crackable sources; "wax seal" alone generates mush).
  signetUnlock: { clips: ["signet_unlock_1"] },
  // A bought pack lands (S3): 1–6 sealed Signets thudding onto the counter.
  // STAND-IN until signet_purchase_1 is forged — the strike reads close
  // enough that the moment isn't silent meanwhile.
  signetPurchase: { clips: ["signet_exchange_1"] },

  // ── UI ──────────────────────────────────────────────────────────────────
  uiTap: { clips: ["ui_tap_1"], volume: 0.7 },
  uiConfirm: { clips: ["ui_confirm_1"] },
  uiBack: { clips: ["ui_back_1"], volume: 0.7 },
  uiError: { clips: ["ui_error_1"] },
  // A low drum hit with air — one per mode card as it settles, a four-beat
  // roll down the stack (~95–230ms between beats). No throttle so a slow
  // frame can never eat a beat; slight pitch drift keeps the roll from
  // sounding machine-stamped. Quiet: it plays four times per screen entry.
  modeReveal: { clips: ["mode_reveal_1"], volume: 0.5, throttleMs: 0, pitchVariance: 0.04 },
  // The title screen's dust squall (HomeScreen's DustStorm) — quiet ambience,
  // not a stinger. Note the first gust after a cold launch can land before any
  // tap has unlocked audio; it stays silent and the next one sounds.
  titleGust: { clips: ["title_gust_1"], volume: 0.5 },
};
