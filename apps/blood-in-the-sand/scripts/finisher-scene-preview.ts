/**
 * Off-device frames of the finisher shop window's LIVE scene
 * (bits-cosmetics.md § F2/F3): the real ScenarioRunner + the real
 * `recordArena`, under Skia's CanvasKit build — the wardrobe hero's exact
 * camera, one strip of moments per finisher. No tileset atlas headlessly, so
 * the floor is the renderer's flat fallback and props are absent; judge the
 * staging, the scale, the blood and the finisher — not the scenery.
 *
 *   bun run scripts/finisher-scene-preview.ts [outDir]
 */
import { plugin } from "bun";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CanvasKitInit = require("canvaskit-wasm/bin/full/canvaskit.js");
const { JsiSkApi } = require("@shopify/react-native-skia/lib/commonjs/skia/web");
const types = require("@shopify/react-native-skia/lib/commonjs/skia/types");
const CK = await CanvasKitInit({});
const Skia = JsiSkApi(CK);
const BIG = Skia.XYWHRect(0, 0, 4096, 4096);
plugin({
  name: "skia-headless",
  setup(build) {
    build.module("@shopify/react-native-skia", () => ({
      loader: "object",
      exports: {
        ...types,
        Skia,
        vec: (x: number, y: number) => ({ x, y }),
        // No system fonts headlessly: name tags and numbers simply don't draw.
        matchFont: (style: { fontSize?: number }) => Skia.Font(undefined, style.fontSize ?? 12),
        createPicture: (cb: (canvas: unknown) => void, rect?: unknown) => {
          const rec = Skia.PictureRecorder();
          cb(rec.beginRecording(rect ?? BIG));
          return rec.finishRecordingAsPicture();
        },
      },
    }));
    build.module("react-native", () => ({ loader: "object", exports: { Platform: { OS: "ios", select: (o: any) => o.ios ?? o.default } } }));
  },
});

const { ScenarioRunner } = await import("../src/primer/scenario");
const { FINISHER_KILL_SCENE } = await import("../src/game/finisherScene");
const { recordArena } = await import("../src/game/render");
const { BloodField } = await import("../src/game/blood");
const { CrackField } = await import("../src/game/cracks");
const { TarField } = await import("../src/game/tar");
const { StatusPulses } = await import("../src/game/statusRings");
const { FinisherField } = await import("../src/game/finishers");
const { arenaScene } = await import("../src/game/scene");
const { ARENA_00, FINISHER_IDS, TICK_DT } = await import("@heroic/blood-in-the-sand-sim");
// The kill scene runs on the Primer rig — scripted against arena-00.
const scene = arenaScene(ARENA_00.id);

const out = process.argv[2] ?? "cosmetics-preview";
mkdirSync(out, { recursive: true });
// The wardrobe hero on a 390×844 phone, at 3 device px.
const W = 350;
const H = 357;
const PX = 3;
/** Seconds after the kill to photograph. */
const MOMENTS = [-0.9, 0.12, 0.45, 0.9, 1.4, 2.4];

for (const id of FINISHER_IDS) {
  const runner = new ScenarioRunner(FINISHER_KILL_SCENE);
  const blood = new BloodField();
  const cracks = new CrackField();
  const tar = new TarField();
  const pulses = new StatusPulses();
  const finishers = new FinisherField();
  const surface = Skia.Surface.Make(W * PX * MOMENTS.length, H * PX)!;
  const canvas = surface.getCanvas();
  let now = 1000;
  let killAt: number | null = null;
  let shot = 0;
  // The kill lands at t=3.0s; photograph the pre-kill moment off scene time.
  const PRE_KILL_T = 3.0 + MOMENTS[0]!;
  // One sim tick per step, on the sim's own clock — wall time IS scene time.
  for (let i = 0; i < 8 / TICK_DT && shot < MOMENTS.length; i++) {
    now += TICK_DT * 1000;
    for (const e of runner.step(now)) {
      if (e.type !== "hit") continue;
      const view = runner.sample(now);
      const a = view?.players.find((p: any) => p.id === e.attackerId);
      const dx = a ? e.x - a.x : 0;
      const dy = a ? e.y - a.y : 1;
      const len = Math.hypot(dx, dy) || 1;
      blood.splatter(e.x, e.y, e.damage, e.lethal, now, dx / len, dy / len);
      if (e.lethal) {
        blood.deathBurst(e.x, e.y, dx / len, dy / len, now);
        finishers.spawn(id, e.x, e.y, now, dx / len, dy / len);
        killAt = now;
      }
    }
    const due = shot === 0 ? runner.time >= PRE_KILL_T : killAt !== null && now - killAt >= MOMENTS[shot]! * 1000;
    const view = runner.sample(now);
    if (!view) continue;
    blood.update(view.players, now);
    blood.crossings.length = 0;
    finishers.update(now);
    pulses.update(view.players, now);
    if (!due) continue;
    const picture = recordArena({
      scene, view, config: runner.config, myId: runner.youId, screenW: W, screenH: H, fx: [], blood, cracks, tar,
      scarEpoch: blood.epoch, pulses, nowMs: now + 250 * shot, atlas: null, abilityIcons: {}, finishers,
      camera: runner.camera(view, W, H),
    });
    canvas.save();
    canvas.translate(shot * W * PX, 0);
    canvas.clipRect(Skia.XYWHRect(0, 0, W * PX, H * PX), types.ClipOp.Intersect, true);
    canvas.scale(PX, PX);
    canvas.drawPicture(picture);
    canvas.restore();
    shot++;
  }
  writeFileSync(join(out, `store-live-${id}.png`), surface.makeImageSnapshot().encodeToBytes());
  console.log("wrote", join(out, `store-live-${id}.png`), `(${shot} frames)`);
}
