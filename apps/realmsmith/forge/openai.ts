/**
 * OpenAI calls: the chat expander (styleBible.ts EXPANDER) and gpt-image-1
 * icon generation. Chat is kept to the minimal parameter set the GPT-5 models
 * accept (`max_completion_tokens`, no temperature); `reasoning_effort:
 * "minimal"` keeps a prompt-rewrite snappy instead of burning seconds thinking.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations";

export const IMAGE_MODEL_ID = "gpt-image-1";

/** Canvas shapes gpt-image-1 accepts that we use: square (icons) and portrait
 * (full-figure sprites — a standing human fits a portrait frame natively, so
 * the model stops cropping to fill a square). */
export type ImageSize = "1024x1024" | "1024x1536";

/**
 * One transparent PNG from gpt-image-1. Transparency matters: icons land on
 * dark cards, roster rows AND the reveal overlay — never on a fixed ground.
 * Callers run several of these in parallel for a candidate spread.
 */
export const generateImage = async (
  apiKey: string,
  prompt: string,
  size: ImageSize = "1024x1024",
): Promise<Buffer> => {
  const res = await fetch(IMAGE_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_MODEL_ID,
      prompt,
      n: 1,
      size,
      quality: "medium",
      background: "transparent",
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

export const expandPrompt = async (
  apiKey: string,
  model: string,
  system: string,
  user: string,
): Promise<string> => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: 2000,
      reasoning_effort: "minimal",
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
  if (!text) throw new Error("OpenAI returned an empty expansion");
  return text;
};
