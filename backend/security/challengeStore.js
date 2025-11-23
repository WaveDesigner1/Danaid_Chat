// backend/security/challengeStore.js (ESM)

import { randomBytes } from "crypto";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min

// prosta pamięć na challenge w RAM
const challenges = new Map(); // key: challengeId -> { username, challenge, createdAt }

function createChallenge(username) {
  const challenge = randomBytes(32).toString("base64");
  const challengeId = randomBytes(16).toString("hex");
  const createdAt = Date.now();

  challenges.set(challengeId, { username, challenge, createdAt });

  return { challengeId, challenge };
}

function takeChallenge(challengeId) {
  const entry = challenges.get(challengeId);
  if (!entry) return null;
  challenges.delete(challengeId);
  return entry;
}

function isChallengeExpired(entry) {
  return Date.now() - entry.createdAt > CHALLENGE_TTL_MS;
}

export {
  createChallenge,
  takeChallenge,
  isChallengeExpired,
};
