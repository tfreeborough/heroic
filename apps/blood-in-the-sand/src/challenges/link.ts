/**
 * Challenge deep links (bits-challenges.md § marketing): a social post's
 * "can you beat this?" opens `bloodinthesand://challenge?id=<challenge-id>`
 * and the app lands on that challenge's card. Unlike the showcase link this
 * ships in every build — it IS the marketing door.
 */
import { challengeById, type ChallengeDef } from "@heroic/blood-in-the-sand-sim";

const CHALLENGE_URL = /^bloodinthesand:\/\/challenge\/?(?:\?(.*))?$/;

export const parseChallengeUrl = (url: string): ChallengeDef | null => {
  const m = CHALLENGE_URL.exec(url.trim());
  if (!m) return null;
  const params = new URLSearchParams(m[1] ?? "");
  const id = params.get("id");
  return id ? (challengeById(id) ?? null) : null;
};

export const challengeUrl = (id: string): string => `bloodinthesand://challenge?id=${encodeURIComponent(id)}`;
