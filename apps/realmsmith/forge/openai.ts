/**
 * OpenAI chat call for the prompt expander (styleBible.ts EXPANDER). Kept to the
 * minimal parameter set the GPT-5 models accept (`max_completion_tokens`, no
 * temperature); `reasoning_effort: "minimal"` keeps a prompt-rewrite snappy
 * instead of burning seconds thinking.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

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
