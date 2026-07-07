/**
 * ElevenLabs text→SFX. One call = one take; the plugin fires several in
 * parallel for the candidate spread. Returns raw mp3 bytes
 * (`POST /v1/sound-generation`, binary response).
 */

export const SFX_MODEL_ID = "eleven_text_to_sound_v2";

const ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";

export interface SfxCall {
  text: string;
  /** 0.5–30s; omitted → the model picks a natural length. */
  durationSeconds?: number;
  promptInfluence: number;
}

export const generateSfx = async (apiKey: string, call: SfxCall): Promise<Buffer> => {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      text: call.text,
      model_id: SFX_MODEL_ID,
      duration_seconds: call.durationSeconds ?? null,
      prompt_influence: call.promptInfluence,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    // 401/422 bodies carry useful validation detail — surface a trimmed copy.
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
};
