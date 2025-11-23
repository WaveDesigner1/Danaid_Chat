// backend/security/security.js (ESM)

import { createSign, createVerify, timingSafeEqual } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ===== Fix ścieżek ESM =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Ścieżki do kluczy serwera =====
// Używamy katalogu: backend/security/serverKeys/
const SERVER_KEYS_DIR = path.join(__dirname, "serverKeys");
const SERVER_PUB_KEY_PATH = path.join(SERVER_KEYS_DIR, "server_public.pem");
const SERVER_PRIV_KEY_PATH = path.join(SERVER_KEYS_DIR, "server_private.pem");

let serverPubPem = "";
let serverPrivPem = "";

try {
  serverPubPem = fs.readFileSync(SERVER_PUB_KEY_PATH, "utf8");
} catch (err) {
  console.error(
    "[security.js] Brak server_public.pem – verifyServerSignature nie zadziała:",
    err.message
  );
}

try {
  serverPrivPem = fs.readFileSync(SERVER_PRIV_KEY_PATH, "utf8");
} catch (err) {
  console.error(
    "[security.js] Brak server_private.pem – signServerData nie zadziała:",
    err.message
  );
}

// =====================================================================
// 1) verifyServerSignature — sprawdzanie integralności user.json
// =====================================================================
function verifyServerSignature(serverSignatureB64, dataToVerify) {
  if (!serverPubPem) return false;

  const verifier = createVerify("RSA-SHA256");
  verifier.update(dataToVerify);
  verifier.end();

  const signature = Buffer.from(serverSignatureB64, "base64");
  return verifier.verify(serverPubPem, signature);
}

// =====================================================================
// 2) signServerData — podpis danych serwerem (RSA)
// =====================================================================
function signServerData(dataString) {
  if (!serverPrivPem) {
    throw new Error(
      "[security.js] Server private key not loaded – nie mogę podpisać danych"
    );
  }

  const signer = createSign("RSA-SHA256");
  signer.update(dataString);
  signer.end();
  return signer.sign(serverPrivPem).toString("base64");
}

// =====================================================================
// 3) timingSafeEqualB64 — bezpieczne porównanie base64
// =====================================================================
function timingSafeEqualB64(a, b) {
  const bufA = Buffer.from(a, "base64");
  const bufB = Buffer.from(b, "base64");

  if (bufA.length !== bufB.length) {
    // dummy, żeby nie zdradzać długości
    const dummy = Buffer.alloc(Math.max(bufA.length, bufB.length) || 1);
    timingSafeEqual(dummy, dummy);
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

// =====================================================================
// 4) verifyUserChallengeSignature — challenge podpisany kluczem usera
// =====================================================================
function verifyUserChallengeSignature(userPubPem, challenge, signatureB64) {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(challenge);
  verifier.end();

  const signature = Buffer.from(signatureB64, "base64");
  return verifier.verify(userPubPem, signature);
}

// =====================================================================
// EXPORTY (ESM)
// =====================================================================
export {
  verifyServerSignature,
  signServerData,
  timingSafeEqualB64,
  verifyUserChallengeSignature,
  serverPubPem,
};
