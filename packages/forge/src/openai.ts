/**
 * OpenAI calls: GPT Image generation. (The chat prompt expander that lived
 * here was retired 2026-09-06 — the sound briefs are written in the local
 * Stable Audio engine's own register and go out verbatim.)
 */

const IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations";

/**
 * Default image model. GPT Image 2.5 (2026-09-08) ships two API models on the
 * same request shape as gpt-image-1: `gpt-image-2.5-flare` (OpenAI's default
 * pick — ~50% faster, same per-token price as gpt-image-2, cheaper output than
 * gpt-image-1) and `gpt-image-2.5-sunburst` (slower; tuned for edit precision,
 * which we never use — the forge only hits /generations). Override per machine
 * with FORGE_IMAGE_MODEL in .env.local to A/B sunburst or fall back to
 * gpt-image-1 on a bad batch. Sidecars record whichever model actually ran.
 */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-flare";

/** Canvas shapes we use: square (icons), portrait (full-figure sprites — a
 * standing human fits a portrait frame natively, so the model stops cropping
 * to fill a square) and landscape (mode-card scenes). 2.5 also accepts custom
 * WIDTHxHEIGHT canvases; we stay on the three standard ones so every template's
 * crop/sacrificial-band arithmetic keeps holding. */
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

/** Cut-out assets (icons, sprites) generate transparent; full-bleed scenes
 * must be opaque — asking for alpha invites the model to leave holes. */
export type ImageBackground = "transparent" | "opaque";

/**
 * One PNG from the image model. Transparency matters for cut-outs: icons land
 * on dark cards, roster rows AND the reveal overlay — never on a fixed ground.
 * Callers run several of these in parallel for a candidate spread.
 */
export const generateImage = async (
  apiKey: string,
  prompt: string,
  size: ImageSize = "1024x1024",
  background: ImageBackground = "transparent",
  model: string = DEFAULT_IMAGE_MODEL,
): Promise<Buffer> => {
  const res = await fetch(IMAGE_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
      size,
      quality: "medium",
      background,
      output_format: "png",
    }),
    // Image generation regularly takes 30–90s — well past the chat timeout.
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI images ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image payload");
  return Buffer.from(b64, "base64");
};
