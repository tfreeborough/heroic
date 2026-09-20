/**
 * The finisher shop window's catalogue and STILLS (bits-cosmetics.md
 * § F2/F3) — what the wardrobe and the Armory need to show a finisher
 * without forged art: a small client catalogue (name, pitch, band colour,
 * the still's signature moment) and one pure stage for tile art — sand, a
 * kill's real blood (the hit splatter + the full death burst, the very
 * BloodField calls a match makes) and the real FinisherField over the body.
 * The LIVE previews are not this: they're a real scripted match
 * (finisherScene.ts through the Primer's rig).
 *
 * Pure Skia on purpose (no React): FinisherPreview's `still` draws it into a
 * picture, and `bun run cosmetics:preview` draws the very same stage
 * headlessly, so the store's tiles can be judged off-device first.
 */
import { Skia, type SkCanvas } from "@shopify/react-native-skia";
import { FINISHER_NONE, type FinisherId, type OwnableFinisherId } from "@heroic/blood-in-the-sand-sim";
import { BloodField } from "./blood";
import { drawBlood, drawBloomingBlood, drawFlyingBlood } from "./bloodMaterials";
import { FinisherField } from "./finishers";

export interface FinisherCatalogueEntry {
  name: string;
  /** One line, the Armory hint / wardrobe caption. */
  pitch: string;
  /** Tile band + eyebrow colour, plain #rrggbb (the CATEGORY_META rule). */
  color: string;
  /** The still: the age at which this finisher is most itself. */
  stillAtMs: number;
}

export const FINISHER_CATALOGUE: Readonly<Record<OwnableFinisherId, FinisherCatalogueEntry>> = {
  butterflies: {
    name: "Butterflies",
    pitch: "A burst of mother nature.",
    color: "#e8a23c",
    stillAtMs: 330,
  },
  smite: {
    name: "Smite",
    pitch: "Invoke the wrath of the gods.",
    color: "#9fb4ff",
    stillAtMs: 120,
  },
  constellation: {
    name: "Among the Stars",
    pitch: "Your victory was written in the stars.",
    color: "#8a7be0",
    stillAtMs: 760,
  },
  medusa: {
    name: "Medusa",
    pitch: "Keep your opponents petrified.",
    color: "#7fae9a",
    stillAtMs: 650,
  },
  talons: {
    name: "Talons",
    pitch: "Death from above.",
    color: "#c97b4a",
    stillAtMs: 300,
  },
  scarabs: {
    name: "Scarabs",
    pitch: "Stripped to the bone.",
    color: "#3fc1c9",
    stillAtMs: 300,
  },
  snuffed: {
    name: "Snuffed",
    pitch: "A lone candle in the dark, extinguished.",
    color: "#b8ab95",
    stillAtMs: 440,
  },
};

/** Stage time runs from a beat BEFORE the kill (the body alive); the kill
 * lands at STAGE_LEAD_MS. */
export const STAGE_LEAD_MS = 450;

/** Tiles are ~110pt wide: pulled back so the whole show fits the frame. */
export const STAGE_TILE_ZOOM = 0.36;

const C_SAND = Skia.Color("#b39763");
const C_FOE = Skia.Color("#d94141");
const C_FRIEND = Skia.Color("#4d7fd9");
const C_CORPSE = Skia.Color("rgba(90, 84, 76, 0.55)");
const C_RIM = Skia.Color("rgba(20, 14, 8, 0.55)");
const BODY_R = 18;

const paint = Skia.Paint();
paint.setAntiAlias(true);

const body = (canvas: SkCanvas, x: number, y: number, color: ReturnType<typeof Skia.Color>, rim: boolean): void => {
  if (rim) {
    paint.setColor(C_RIM);
    canvas.drawCircle(x, y, BODY_R + 2, paint);
  }
  paint.setColor(color);
  canvas.drawCircle(x, y, BODY_R, paint);
};

/** Run `fn` with Math.random swapped for a seeded mulberry32. Finishers roll
 * their look at spawn; a STILL must be the same picture on every mount. */
export const withSeededRandom = <T>(seed: number, fn: () => T): T => {
  const real = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
};

/**
 * One finisher on its stage. Owns a FinisherField and the loop clock; the
 * caller asks it to draw at a STAGE time (ms since the loop began — the kill
 * lands at STAGE_LEAD_MS) and restarts it when the loop is over, which also
 * wipes the floor marks so each pass starts on clean sand.
 */
export class FinisherStage {
  private field = new FinisherField();
  private blood = new BloodField();
  private spawned = false;

  constructor(
    readonly id: FinisherId,
    /** Seed the spawn's dice (stills); omit for a fresh roll every loop. */
    private readonly seed?: number,
  ) {}

  restart(): void {
    this.field = new FinisherField();
    this.blood = new BloodField();
    this.spawned = false;
  }

  /** Draw the stage into a w×h (points) canvas. The victim stands a little
   * below centre — every finisher but Snuffed reaches UP the screen. */
  draw(canvas: SkCanvas, w: number, h: number, stageMs: number, zoom = STAGE_TILE_ZOOM, killer = false): void {
    paint.setColor(C_SAND);
    canvas.drawRect(Skia.XYWHRect(0, 0, w, h), paint);

    const age = stageMs - STAGE_LEAD_MS;
    // World origin = the victim. Everything below is in world px.
    canvas.save();
    canvas.translate(w / 2, h * 0.58);
    canvas.scale(zoom, zoom);
    if (age >= 0 && !this.spawned) {
      this.spawned = true;
      // The kill, as a match makes it: the blow's splatter, then the death
      // burst, sprayed away from the killer (down-left of the body) — and
      // the killer's finisher, if they wear one. Without the blood even a
      // good finisher reads as a toy, and NONE reads as broken.
      const kill = (): void => {
        const [dx, dy] = [0.84, -0.54];
        this.blood.splatter(0, 0, 40, true, 0, dx, dy);
        this.blood.deathBurst(0, 0, dx, dy, 0);
        if (this.id !== FINISHER_NONE) this.field.spawn(this.id, 0, 0, 0, dx, dy);
      };
      if (this.seed === undefined) kill();
      else withSeededRandom(this.seed, kill);
    }
    if (this.spawned) {
      this.blood.update([], age);
      drawBlood(canvas, this.blood.decals, age);
      drawBloomingBlood(canvas, this.blood.decals, age, age);
      this.field.update(age);
      this.field.drawGround(canvas, age);
    }
    // A corpse the finisher has taken (Talons, Scarabs) is the show's to draw.
    if (!this.field.hidesBody(0, 0, age)) body(canvas, 0, 0, age >= 0 ? C_CORPSE : C_FOE, age < 0);
    if (this.spawned) drawFlyingBlood(canvas, this.blood.flying, age);
    // The killer is optional and off by default: on a 110pt tile they only
    // clutter the still (they sat on the constellation, under Medusa's eye).
    if (killer) body(canvas, -104, 66, C_FRIEND, true);
    if (this.spawned) this.field.drawAir(canvas, age);
    canvas.restore();
  }
}
