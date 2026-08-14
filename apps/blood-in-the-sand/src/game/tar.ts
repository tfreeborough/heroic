/**
 * The tar trail's visuals (bits-store-arms.md § Tar Pit — Tom, 2026-08-10:
 * "suitably sticky and chaotic like the blood splatter", never plain
 * circles; plus black tar SPLUTTERING off the caster's heels while the
 * trail lays). Client-derived and never networked — the blood rule: the
 * sim's tar deployables are the authoritative slow zones (honest circles);
 * everything here is how they LOOK.
 *
 * Each sim blob grows a seeded SPLAT CLUSTER: one big irregular blob
 * (blood.ts's blobPath — wobble keyed on the deployable id, so the shape
 * is stable frame to frame) ringed by satellite spatters and outward
 * teardrop streaks, scaled up live as the sim's radius grows. The heel
 * splutter is pure garnish: small flying drops launched behind a laying
 * caster that land as long-lived specks.
 *
 * NO splat-map bake, deliberately: blood bakes because it accumulates
 * THOUSANDS of decals; a trail is ≤ ~10 clusters + a couple hundred capped
 * specks, which Skia draws live for nothing. Revisit only if trails
 * multiply (the counts, not the principle, are the reason).
 */
import { createPicture, Skia, type SkCanvas, type SkPath, type SkPicture } from "@shopify/react-native-skia";
import {
  TAR_PIT,
  type DeployableSnapshot,
  type PlayerSnapshot,
} from "@heroic/blood-in-the-sand-sim";
import { blobPath, teardropPath } from "./blood";

const C_TAR = Skia.Color("#17110a");
const C_SHEEN = Skia.Color("#453a26");

/** A dried stain's opacity — live tar is dark and grips; dried tar is a
 * matte ghost that's safe to cross. The gap between the two IS the
 * readability contract (Tom, 2026-08-10: the marks persist all match like
 * blood, the slow dies with the round; 0.32 → 0.18 same day — fainter
 * still, history not signage). */
const STAIN_ALPHA = 0.18;
/** Specks persist all match too (the blood rule) — capped, not timed. */
const SPECK_CAP = 240;

/** Deterministic per-cluster rng — mulberry32 on the deployable id, so a
 * cluster's chaos is frozen at birth (no crawling between frames). */
const mulberry = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

interface Cluster {
  id: number;
  cx: number;
  cy: number;
  bornMs: number;
  /** All paths in LOCAL coords at FULL size — drawn under translate+scale. */
  main: SkPath;
  parts: { path: SkPath; alpha: number }[];
}

interface FlyingTar {
  x0: number;
  y0: number;
  tx: number;
  ty: number;
  r: number;
  bornMs: number;
  landMs: number;
}

interface Speck {
  path: SkPath;
  bornMs: number;
}

const fill = Skia.Paint();

export class TarField {
  private readonly clusters = new Map<number, Cluster>();
  /** Dried trails from finished rounds — an accumulating picture that lives
   * all match (the blood-scar pattern): rebuilt only when clusters dry,
   * one drawPicture per frame otherwise. */
  private stains: SkPicture | null = null;
  /** playerId → wall-clock ms when their laying window shuts. */
  private readonly laying = new Map<number, number>();
  private readonly lastSplutter = new Map<number, number>();
  private flying: FlyingTar[] = [];
  private readonly specks: Speck[] = [];

  /** GameScreen's cast handler: this player is laying tar until then. */
  noteLay(playerId: number, untilMs: number): void {
    this.laying.set(playerId, untilMs);
  }

  /** Once per rendered frame (the blood.update slot): track the sim's tar
   * blobs into clusters, splutter behind laying casters, land the drops. */
  update(
    players: readonly PlayerSnapshot[],
    deployables: readonly DeployableSnapshot[],
    nowMs: number,
  ): void {
    // Sim blobs → clusters. A blob the sim dropped (the round reset — tar
    // doesn't dry mid-round) DRIES: its cluster is stamped into the
    // persistent stain layer at matte alpha and leaves the live map.
    const seen = new Set<number>();
    for (const d of deployables) {
      if (d.kind !== "tar") continue;
      seen.add(d.id);
      if (!this.clusters.has(d.id)) this.clusters.set(d.id, makeCluster(d, nowMs));
    }
    const dried: Cluster[] = [];
    for (const c of this.clusters.values()) {
      if (!seen.has(c.id)) {
        dried.push(c);
        this.clusters.delete(c.id);
      }
    }
    if (dried.length > 0) {
      const prior = this.stains;
      this.stains = createPicture((canvas) => {
        if (prior) canvas.drawPicture(prior);
        for (const c of dried) {
          canvas.save();
          canvas.translate(c.cx, c.cy);
          for (const part of c.parts) {
            fill.setColor(C_TAR);
            fill.setAlphaf(part.alpha * STAIN_ALPHA);
            canvas.drawPath(part.path, fill);
          }
          fill.setColor(C_TAR);
          fill.setAlphaf(STAIN_ALPHA);
          canvas.drawPath(c.main, fill);
          canvas.restore();
        }
      });
    }

    // The heel splutter: while a caster's window is open, flick drops out
    // BEHIND them on a quick irregular cadence.
    for (const [id, until] of this.laying) {
      if (nowMs > until) {
        this.laying.delete(id);
        continue;
      }
      const p = players.find((q) => q.id === id);
      if (!p || !p.alive) continue;
      const last = this.lastSplutter.get(id) ?? 0;
      if (nowMs - last < 40) continue;
      this.lastSplutter.set(id, nowMs);
      const back = p.facing + Math.PI;
      for (let i = 0; i < 2; i++) {
        const ang = back + (Math.random() - 0.5) * 1.1;
        const dist = 14 + Math.random() * 42;
        this.flying.push({
          x0: p.x,
          y0: p.y + 6, // off the heels, not the chest
          tx: p.x + Math.cos(ang) * dist,
          ty: p.y + 6 + Math.sin(ang) * dist,
          r: 1.6 + Math.random() * 1.6,
          bornMs: nowMs,
          landMs: nowMs + 130 + Math.random() * 150,
        });
      }
    }

    // Touch down finished drops as long-lived specks (capped FIFO).
    if (this.flying.some((f) => nowMs >= f.landMs)) {
      for (const f of this.flying) {
        if (nowMs < f.landMs) continue;
        this.specks.push({ path: blobPath(f.tx, f.ty, f.r, f.tx * 7.3 + f.ty, 0.45), bornMs: nowMs });
      }
      this.flying = this.flying.filter((f) => nowMs < f.landMs);
      if (this.specks.length > SPECK_CAP) this.specks.splice(0, this.specks.length - SPECK_CAP);
    }
  }

  /** Ground pass — call where floor decals draw (under bodies and zones). */
  draw(canvas: SkCanvas, nowMs: number): void {
    // Dried rounds first — the oldest marks sit deepest.
    if (this.stains) canvas.drawPicture(this.stains);

    // Specks: match-persistent grime (the blood rule), capped not timed.
    fill.setColor(C_TAR);
    fill.setAlphaf(0.55);
    for (const s of this.specks) canvas.drawPath(s.path, fill);

    for (const c of this.clusters.values()) {
      const age = (nowMs - c.bornMs) / 1000;
      const grow = Math.min(1, age / TAR_PIT.growSeconds);
      // Match the sim's radius curve exactly — the LOOK never overstates
      // the zone (paths were built at full size; scale down while young).
      const scale =
        (TAR_PIT.radiusMin + grow * (TAR_PIT.radiusMax - TAR_PIT.radiusMin)) / TAR_PIT.radiusMax;
      canvas.save();
      canvas.translate(c.cx, c.cy);
      canvas.scale(scale, scale);
      for (const part of c.parts) {
        fill.setColor(C_TAR);
        fill.setAlphaf(part.alpha);
        canvas.drawPath(part.path, fill);
      }
      fill.setColor(C_TAR);
      fill.setAlphaf(0.88);
      canvas.drawPath(c.main, fill);
      if (grow < 1) {
        // Wet sheen while spreading — fresh tar glistens, settled tar is matte.
        fill.setColor(C_SHEEN);
        fill.setAlphaf(0.16 * (1 - grow));
        canvas.drawPath(c.main, fill);
      }
      canvas.restore();
    }

    // In-flight splutter, over the ground grime.
    fill.setColor(C_TAR);
    for (const f of this.flying) {
      const t = Math.min(1, (nowMs - f.bornMs) / (f.landMs - f.bornMs));
      const x = f.x0 + (f.tx - f.x0) * t;
      const y = f.y0 + (f.ty - f.y0) * t - Math.sin(Math.PI * t) * 9;
      fill.setAlphaf(0.9);
      canvas.drawPath(teardropPath(x, y, (f.tx - f.x0) * 0.25, (f.ty - f.y0) * 0.25, f.r), fill);
    }
    fill.setAlphaf(1);
  }
}

/** Freeze a blob's chaos at birth: one big wobbled body, satellite spatters
 * hugging (and breaching) the rim, and a few outward streaks — all local
 * coords at FULL size, scaled live by the sim's growth curve. */
const makeCluster = (d: DeployableSnapshot, nowMs: number): Cluster => {
  const rand = mulberry(d.id * 2654435761);
  const R = TAR_PIT.radiusMax;
  const parts: Cluster["parts"] = [];
  const satellites = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < satellites; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = R * (0.55 + rand() * 0.75); // some land past the rim — chaos
    parts.push({
      path: blobPath(Math.cos(ang) * dist, Math.sin(ang) * dist, 4 + rand() * 8, d.id + i * 17, 0.5),
      alpha: 0.5 + rand() * 0.35,
    });
  }
  const streaks = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < streaks; i++) {
    const ang = rand() * Math.PI * 2;
    const from = R * (0.5 + rand() * 0.3);
    parts.push({
      path: teardropPath(
        Math.cos(ang) * from,
        Math.sin(ang) * from,
        Math.cos(ang) * R * (0.35 + rand() * 0.4),
        Math.sin(ang) * R * (0.35 + rand() * 0.4),
        3 + rand() * 3,
      ),
      alpha: 0.6,
    });
  }
  return {
    id: d.id,
    cx: d.x,
    cy: d.y,
    bornMs: nowMs,
    main: blobPath(0, 0, R * 0.92, d.id * 3.7, 0.34),
    parts,
  };
};
