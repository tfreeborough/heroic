/**
 * The Writ Forge's ember field — an SkSL runtime shader (the dustStorm.ts
 * discipline: GPU-evaluated, clock fed from a Reanimated clock on the UI
 * thread, zero React renders per frame, rasterized at half resolution).
 * A drift of warm embers rises through the whole screen; the held charge
 * (`u_boost`) stokes it — embers climb faster, glow brighter, and a rank
 * of extra embers wakes as the seal heats. Deliberately Skia, not expo-gl:
 * Skia IS the GPU path this app already ships, and a second GL context
 * would buy nothing but a dev-client rebuild.
 */
import { Canvas, Fill, Shader, Skia, useClock } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

const EMBER_SCALE = 0.5;

const EMBER_SKSL = `
uniform float2 u_res;
uniform float u_t;     // seconds
uniform float u_boost; // 0..1 — the held charge stokes the fire

float hash(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

half4 main(float2 xy) {
  half3 acc = half3(0.0);
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    float h1 = hash(fi + 1.0);
    float h2 = hash(fi + 57.0);
    float h3 = hash(fi + 113.0);
    // The last eight embers only wake as the charge builds — a stoked
    // forge visibly breathes harder.
    float gate = fi < 14.0 ? 1.0 : step((fi - 13.0) / 9.0, u_boost);
    // Rise speed in screens/second; the charge adds urgency to everyone.
    float rise = 0.045 + 0.075 * h1 + 0.05 * u_boost;
    float cycle = fract(u_t * rise + h2 * 7.0);
    float y = (1.0 - cycle) * (u_res.y + 40.0) - 20.0;
    float x = h3 * u_res.x + sin(u_t * (0.5 + h1) + fi * 2.1) * (10.0 + 22.0 * h2);
    float d = distance(xy, float2(x, y));
    float size = 1.1 + 2.0 * h2;
    float twinkle = 0.55 + 0.45 * sin(u_t * (3.0 + 4.0 * h3) + fi * 1.7);
    // Fade near spawn and despawn so embers never pop in or out.
    float life = smoothstep(0.0, 0.12, cycle) * (1.0 - smoothstep(0.82, 1.0, cycle));
    float core = smoothstep(size, 0.0, d);
    float glow = smoothstep(size * 6.0, 0.0, d) * 0.20;
    float a = gate * life * twinkle * (0.35 + 0.65 * u_boost);
    acc += (half3(1.0, 0.64, 0.30) * core + half3(0.85, 0.32, 0.10) * glow) * a;
  }
  // Premultiplied colour with zero alpha = additive glow over the scrim.
  return half4(acc, 0.0);
}`;

const EMBER_EFFECT = Skia.RuntimeEffect.Make(EMBER_SKSL);

export const ForgeEmbers = ({ w, h, boost }: { w: number; h: number; boost: number }) => {
  const clock = useClock();
  const uniforms = useDerivedValue(
    () => ({
      u_res: [w * EMBER_SCALE, h * EMBER_SCALE],
      u_t: clock.value / 1000,
      u_boost: boost,
    }),
    [clock, boost],
  );
  if (!EMBER_EFFECT) return null;
  return (
    <Canvas
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: w * EMBER_SCALE,
        height: h * EMBER_SCALE,
        transformOrigin: "top left",
        transform: [{ scale: 1 / EMBER_SCALE }],
      }}
    >
      <Fill>
        <Shader source={EMBER_EFFECT} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
};
