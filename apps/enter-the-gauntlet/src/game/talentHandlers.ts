// The talent effect handlers this sim actually implements. Core authors the
// whole catalogue ahead of the game (progression/chains.ts); offer generation
// gates on this set so a card never promises behaviour the sim can't deliver
// yet. Step 2 of the talent build turns this into a real dispatch table
// (hook → handler code); until then it is purely the offer gate.
//
// Add a handler's name here ONLY once the sim honours it end-to-end.

export const IMPLEMENTED_TALENT_HANDLERS: ReadonlySet<string> = new Set([
  // dash.ts reads this via talentEffectTotal in makeDashConfig (Swift Roll).
  "dashCooldown",
]);
