/**
 * The title screen's dust squall: an SkSL runtime shader (fractal value-noise,
 * GPU-evaluated per pixel) rather than views flying across the screen. Two
 * noise fields do the work — a billowing cloud body and a wind-stretched
 * streak field (low x frequency, high y frequency = long horizontal wisps) —
 * plus a fine grit shimmer. A storm FRONT sweeps left-to-right with the dust
 * trailing behind it, and the whole thing breathes in and out over the gust,
 * so it arrives, blows through, and dies instead of flicking on and off.
 *
 * Cost discipline (this ran hot as a 30fps JS re-record): HomeScreen mounts
 * the effect only while a gust is live, feeds the uniforms from a Reanimated
 * clock on the UI thread (no React renders, no picture re-recording), and
 * rasterizes at half resolution scaled up by the compositor — soft dust can't
 * tell. The fbm octave count below is part of the same budget: 3, not the
 * textbook 4-5, because at dust softness the 4th octave is invisible and
 * costs another two noise taps per field per pixel.
 */
import { Skia } from "@shopify/react-native-skia";

const DUST_SKSL = `
uniform float2 u_res;
uniform float u_t;    // seconds since the gust began
uniform float u_prog; // 0..1 through the gust

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + float2(1.0, 0.0)), u.x),
    mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x),
    u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 3; k++) {
    v += a * noise(p);
    // rotate ~37deg while doubling frequency — value noise carries its lattice
    // axes into every octave if you only scale, and the stacked grids read as
    // BLOCKS; rotating each octave scatters them
    p = float2x2(1.6, 1.2, -1.2, 1.6) * p + float2(17.0, 9.2);
    a *= 0.5;
  }
  return v;
}

half4 main(float2 xy) {
  float2 uv = xy / u_res;
  float2 q = float2(uv.x * u_res.x / u_res.y, uv.y);

  // curl the sample domain with a slow secondary noise so the cloud BILLOWS
  // — straight scrolling fbm slides past as a flat sheet with visible cells
  float2 wobble = float2(
    noise(q * 2.6 - float2(u_t * 0.7, 0.0)),
    noise(q * 2.6 + float2(31.4, u_t * 0.55)));

  // billowing cloud body, drifting with the wind
  float body = fbm(q * float2(2.0, 3.2) + (wobble - 0.5) * 0.55 - float2(u_t * 1.1, u_t * 0.10));
  // wind-stretched wisps riding over it, faster
  float streak = fbm(q * float2(5.0, 22.0) - float2(u_t * 2.6, u_t * 0.16));
  // grit shimmer so the cloud crawls instead of sliding as one sheet (scale
  // capped well below the half-res pixel grid — finer and it aliases blocky)
  float grit = noise(q * 22.0 - float2(u_t * 5.0, 0.0));
  float d = body * 0.66 + streak * 0.58 + grit * 0.10;

  // the front sweeps L->R (same wind as the banners), dust trailing behind
  // it; sin(pi*prog) breathes the whole squall up and back down
  float front = mix(-0.7, 1.7, u_prog);
  float behind = 1.0 - smoothstep(front - 1.0, front, uv.x);
  float breathe = sin(3.14159 * u_prog);
  // denser low where the sand gets kicked up, thinner in the sky
  float grade = mix(0.5, 1.0, uv.y);

  float a = min(smoothstep(0.52, 0.95, d) * behind * breathe * grade, 0.62);

  // sunlit sand: dense cores lift toward the pale highlight
  half3 col = mix(half3(0.79, 0.64, 0.42), half3(0.95, 0.88, 0.70), smoothstep(0.6, 1.0, d));
  return half4(col * a, a);
}
`;

/** Compiled once at module load; null only if the SkSL fails to compile (in
 * which case the storm silently never appears rather than crashing the door). */
export const DUST_EFFECT = Skia.RuntimeEffect.Make(DUST_SKSL);
