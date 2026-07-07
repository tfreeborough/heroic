/**
 * Triggers — invisible rectangular regions a designer paints into a zone that
 * fire an **action** when the player walks into them (docs/design/triggers.md).
 * The first thing that lets a zone *react* to the player rather than just
 * describe geometry: cross this line → something happens.
 *
 * This is the **pure** half — the action/config types, the flat-`props` parser,
 * and the tiny edge-triggered state machine:
 *
 *     OUTSIDE ──player centre enters region──► FIRE (once, or every entry if
 *        ▲                                            `repeat`)
 *        └──────────player centre leaves────────► re-armed (repeat only)
 *
 * A trigger *is* a `ZoneObject` of kind `"trigger"` (see zone/format.ts): the
 * region is the object's `x`/`y`/`w`/`h`, the action config rides its `props`
 * bag — exactly the reuse a spawner makes. The game computes whether the player
 * is inside each step and feeds it to `stepTrigger`; the reducer decides whether
 * *this* step fires. No RNG, no clock — replayable and unit-tested like the rest
 * of core.
 *
 * v1 ships one action, `text` (show a line on screen). The action is a
 * discriminated union so `spawn` / `buff` / `sound` slot in later as new
 * variants without reshaping the lifecycle (see docs/design/triggers.md).
 */
import type { Vec2 } from "../math/vec2";
import type { Aabb } from "../physics/crowd";

/**
 * What a trigger *does* when it fires. Discriminated by `type`; v1 has only
 * `text`. Add a variant here, then a case in the game's fire switch — placement
 * and detection are untouched.
 */
export type TriggerAction = {
  /** Show a line of text on screen (a centered, auto-dismissing banner). */
  type: "text";
  /** The message shown. */
  text: string;
  /** How long the banner holds before fading, ms. */
  durationMs: number;
};

/** The kinds a `TriggerAction` can be — the parseable `props.action` values. */
export type TriggerActionType = TriggerAction["type"];

/** Authored tuning for a trigger, parsed from a `ZoneObject`'s `props` bag. */
export interface TriggerConfig {
  /** What fires when the player enters. */
  action: TriggerAction;
  /**
   * Re-arm on exit: `false` (default) fires once per visit then stays spent;
   * `true` fires on every entry, re-arming each time the player leaves.
   */
  repeat: boolean;
}

/** Default banner hold time (ms) when a trigger doesn't author one. */
export const TRIGGER_TEXT_DURATION_MS = 3000;

/** Sensible starting values (also the editor's placement defaults). */
export const TRIGGER_DEFAULTS: TriggerConfig = {
  action: { type: "text", text: "", durationMs: TRIGGER_TEXT_DURATION_MS },
  repeat: false,
};

/** Live, mutable trigger state (the game holds one per placed trigger). */
export interface TriggerState {
  /** Has this trigger fired at least once this visit (gates the one-shot case). */
  fired: boolean;
  /** Was the player inside the region on the previous step (for edge detection). */
  inside: boolean;
}

export const initTriggerState = (): TriggerState => ({ fired: false, inside: false });

/** Per-step perception the game feeds the FSM. */
export interface TriggerInput {
  /** Is the player's centre inside the region *this* step? */
  inside: boolean;
}

export interface TriggerStep {
  state: TriggerState;
  /** True on exactly the step the trigger fires (the rising edge, when armed). */
  fire: boolean;
}

/**
 * Advance a trigger one step. Pure and deterministic: same (state, config,
 * input) in → same step out. Fires on the rising edge of "inside" — once per
 * visit by default, or on every entry when `config.repeat` (leaving re-arms).
 */
export const stepTrigger = (
  state: TriggerState,
  config: TriggerConfig,
  input: TriggerInput,
): TriggerStep => {
  const enter = input.inside && !state.inside;
  const fire = enter && (config.repeat || !state.fired);
  return {
    state: { fired: state.fired || fire, inside: input.inside },
    fire,
  };
};

/** Is point `p` inside the centre-based region rect? (The "player entered" test.) */
export const regionContains = (region: Aabb, p: Vec2): boolean =>
  Math.abs(p.x - region.x) <= region.w / 2 && Math.abs(p.y - region.y) <= region.h / 2;

const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;

/**
 * Resolve a `ZoneObject.props` bag (untyped scalars, as Realmsmith writes them)
 * into a typed `TriggerConfig`, filling anything missing or malformed from
 * `fallback`. An unknown `action` type falls back to the default action, so a
 * forward-authored (or stale) file degrades gracefully instead of crashing.
 */
export const parseTriggerConfig = (
  props: Record<string, string | number | boolean>,
  fallback: TriggerConfig = TRIGGER_DEFAULTS,
): TriggerConfig => {
  // v1 knows only the `text` action; any other `action` value resolves to it.
  const action: TriggerAction = {
    type: "text",
    text: str(props.text, fallback.action.type === "text" ? fallback.action.text : ""),
    durationMs: num(
      props.durationMs,
      fallback.action.type === "text" ? fallback.action.durationMs : TRIGGER_TEXT_DURATION_MS,
    ),
  };
  return { action, repeat: bool(props.repeat, fallback.repeat) };
};
