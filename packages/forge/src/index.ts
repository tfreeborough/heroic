/**
 * The forge's outside calls, shared: GPT Image for pictures (Realmsmith's
 * asset forge, the Desk's sketches) and ElevenLabs for sound effects.
 * Plain fetch, a key passed in; nothing here reads the environment.
 */
export * from "./openai";
export * from "./elevenlabs";
