// Round- and match-end flavour copy for the premium centre banner.
//
// Each outcome (won a round, lost a round, mutual wipe, won/lost the match) has
// a small pool of title + subtitle pairs; we cycle through the pool so back-to
// back rounds never read the same line twice. The desert-arena voice: dry,
// brutal, blood-and-sand, never cute (mirrors the Forge style bible).

export type OutcomeKind =
  | "roundWin"
  | "roundLoss"
  | "roundDraw"
  | "victory"
  | "defeat";

export interface OutcomeVariant {
  title: string;
  subtitle: string;
}

const POOLS: Record<OutcomeKind, OutcomeVariant[]> = {
  roundWin: [
    { title: "ROUND WON", subtitle: "The sand drinks their blood." },
    { title: "ROUND WON", subtitle: "The crowd roars your name." },
    { title: "THEY FALL", subtitle: "Their line breaks before yours." },
    { title: "ROUND WON", subtitle: "Wipe your blade. Again." },
  ],
  roundLoss: [
    { title: "ROUND LOST", subtitle: "The sand runs red with yours." },
    { title: "ROUND LOST", subtitle: "The crowd smells weakness." },
    { title: "YOU FALL", subtitle: "Rise. It is not over." },
    { title: "ROUND LOST", subtitle: "Blood for blood — take it back." },
  ],
  roundDraw: [
    { title: "NO SURVIVORS", subtitle: "The sand claims you all." },
    { title: "MUTUAL RUIN", subtitle: "No side left standing." },
  ],
  victory: [
    { title: "VICTORY", subtitle: "The arena is yours." },
    { title: "VICTORY", subtitle: "They will remember your name." },
    { title: "VICTORY", subtitle: "Champion of the sand." },
  ],
  defeat: [
    { title: "DEFEAT", subtitle: "The sand swallows another." },
    { title: "DEFEAT", subtitle: "The crowd has turned away." },
    { title: "DEFEAT", subtitle: "Return. Bleed. Rise again." },
  ],
};

// Per-kind cursor so consecutive outcomes of the same kind step through the
// pool rather than repeating. Advances exactly once per real outcome (the HUD
// latches the pick by outcome key, so this is called once per round-end).
const cursor: Record<OutcomeKind, number> = {
  roundWin: 0,
  roundLoss: 0,
  roundDraw: 0,
  victory: 0,
  defeat: 0,
};

export function pickOutcome(kind: OutcomeKind): OutcomeVariant {
  const pool = POOLS[kind];
  const variant = pool[cursor[kind] % pool.length]!;
  cursor[kind] = (cursor[kind] + 1) % pool.length;
  return variant;
}
