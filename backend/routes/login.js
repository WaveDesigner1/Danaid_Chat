// backend/routes/login.js
// Logowanie użytkownika w Danaid Chat (lokalny model: derivedKeyB64 + challenge + podpis RSA + JWT)
//
// Flow:
//
// 1. FRONTEND -> POST /api/login/start { username }
//    - backend sprawdza, czy user istnieje
//    - weryfikuje serverSignature (integralność rekordu użytkownika)
//    - generuje jednorazowy challenge i challengeId
//    - zapisuje challenge w pamięci (Map)
//    - zwraca { success, challengeId, challengeB64 }
//
// 2. FRONTEND:
//    - liczy PBKDF2(password) -> derivedKeyB64 (tak samo jak przy rejestracji)
//    - importuje privateKey PEM
//    - podpisuje challenge -> challengeSignatureB64
//
// 3. FRONTEND -> POST /api/login/finish
//    {
//      username,
//      derivedKeyB64,
//      challengeId,
//      challengeSignatureB64
//    }
//
// 4. BACKEND:
//    - wczytuje usera, ponownie weryfikuje serverSignature
//    - porównuje derivedKeyB64 (timingSafeEqual)
//    - wyciąga challenge z pamięci po challengeId, sprawdza TTL i username
//    - weryfikuje podpis challenge’a kluczem publicznym usera
//    - jeśli OK -> generuje JWT i zwraca { success, token, username, identityKeyFingerprint }

import "dotenv/config";
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";
import path from "path";

import { loadUser } from "../utils/fileUtils.js";
import { verifyClientSignature } from "../utils/security.js";
import { signServerData } from "../security/security.js";

const router = express.Router();

// ===== ESM ścieżki =====

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== JWT =====

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.warn(
    "[LOGIN] Uwaga: JWT_SECRET nie jest ustawiony w process.env. " +
      "Generowanie tokenów JWT może się nie udać."
  );
}

// ===== PAMIĘĆ NA CHALLENGE =====
//
// Map<challengeId, { username, challengeB64, createdAt }>
const challenges = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minut

// ===== HELPERY =====

/**
 * Weryfikuje integralność rekordu usera poprzez porównanie serverSignature.
 * Musimy podpisać dokładnie ten sam JSON, który był podpisany przy rejestracji.
 */
function verifyServerSignature(userData) {
  try {
    const { serverSignature, ...withoutSignature } = userData;

    if (!serverSignature) {
      console.warn(
        "[LOGIN] Brak serverSignature w rekordzie użytkownika:",
        userData.username
      );
      return false;
    }

    // Przy rejestracji signServerData dostawało JSON.stringify(userRecord)
    const dataString = JSON.stringify(withoutSignature);
    const expectedSignature = signServerData(dataString);

    const a = Buffer.from(serverSignature, "base64");
    const b = Buffer.from(expectedSignature, "base64");

    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    console.error("[LOGIN] Błąd verifyServerSignature:", err);
    return false;
  }
}

function createRandomChallenge() {
  const buf = crypto.randomBytes(32);
  return buf.toString("base64");
}

function createChallengeId() {
  const buf = crypto.randomBytes(16);
  return buf.toString("hex");
}

function storeChallenge(username, challengeId, challengeB64) {
  const entry = {
    username,
    challengeB64,
    createdAt: Date.now(),
  };

  challenges.set(challengeId, entry);
}

function getAndDeleteChallenge(challengeId) {
  const entry = challenges.get(challengeId);
  if (!entry) {
    return null;
  }

  challenges.delete(challengeId);
  return entry;
}

function isChallengeExpired(entry) {
  if (!entry) {
    return true;
  }

  const now = Date.now();
  return now - entry.createdAt > CHALLENGE_TTL_MS;
}

// ===== ROUTES =====

/**
 * POST /api/login/start
 *
 * Body:
 * {
 *   "username": "alice"
 * }
 *
 * Zwraca:
 * {
 *   "success": true,
 *   "challengeId": "...",
 *   "challengeB64": "..."
 * }
 */
router.post("/start", async (req, res) => {
  try {
    const { username } = req.body || {};

    if (!username) {
      return res.status(400).json({
        success: false,
        error: "Brak username w body.",
      });
    }

    let userData = null;

    try {
      userData = await loadUser(username);
    } catch (err) {
      console.warn(
        "[LOGIN] Błąd przy wczytywaniu użytkownika w /start:",
        username,
        err.message
      );
      return res.status(500).json({
        success: false,
        error: "Błąd serwera podczas odczytu użytkownika.",
      });
    }

    if (!userData) {
      console.warn("[LOGIN] Próba logowania na nieistniejącego usera:", username);
      return res.status(404).json({
        success: false,
        error: "Użytkownik o podanej nazwie nie istnieje.",
      });
    }

    const integrityOk = verifyServerSignature(userData);
    if (!integrityOk) {
      console.error(
        "[LOGIN] Wykryto niezgodność serverSignature dla usera:",
        username
      );
      return res.status(500).json({
        success: false,
        error: "Niespójność danych użytkownika (serverSignature).",
      });
    }

    const challengeB64 = createRandomChallenge();
    const challengeId = createChallengeId();

    storeChallenge(username, challengeId, challengeB64);

    return res.json({
      success: true,
      challengeId,
      challengeB64,
    });
  } catch (err) {
    console.error("[LOGIN] Błąd POST /start:", err);
    return res.status(500).json({
      success: false,
      error: "Błąd serwera podczas inicjacji logowania.",
    });
  }
});

/**
 * POST /api/login/finish
 *
 * Body:
 * {
 *   "username": "alice",
 *   "derivedKeyB64": "...",
 *   "challengeId": "...",
 *   "challengeSignatureB64": "..."
 * }
 *
 * Zwraca:
 * {
 *   "success": true,
 *   "token": "...",
 *   "username": "alice",
 *   "identityKeyFingerprint": "..."
 * }
 */
router.post("/finish", async (req, res) => {
  try {
    const {
      username,
      derivedKeyB64,
      challengeId,
      challengeSignatureB64,
    } = req.body || {};

    if (!username || !derivedKeyB64 || !challengeId || !challengeSignatureB64) {
      return res.status(400).json({
        success: false,
        error:
          "Brak wymaganych pól: username, derivedKeyB64, challengeId, challengeSignatureB64.",
      });
    }

    // 1) Wczytanie usera
    let userData = null;

    try {
      userData = await loadUser(username);
    } catch (err) {
      console.warn(
        "[LOGIN] Błąd przy wczytywaniu użytkownika w /finish:",
        username,
        err.message
      );
      return res.status(500).json({
        success: false,
        error: "Błąd serwera podczas odczytu użytkownika.",
      });
    }

    if (!userData) {
      console.warn(
        "[LOGIN] Próba logowania (finish) na nieistniejącego usera:",
        username
      );
      return res.status(404).json({
        success: false,
        error: "Użytkownik o podanej nazwie nie istnieje.",
      });
    }

    // 2) Weryfikacja integralności rekordu (serverSignature)
    const integrityOk = verifyServerSignature(userData);
    if (!integrityOk) {
      console.error(
        "[LOGIN] Wykryto niezgodność serverSignature (finish) dla usera:",
        username
      );
      return res.status(500).json({
        success: false,
        error: "Niespójność danych użytkownika (serverSignature).",
      });
    }

    // 3) Porównanie derivedKeyB64 (timingSafeEqual)
    const storedDerivedKeyB64 = userData.derivedKeyB64;
    if (typeof storedDerivedKeyB64 !== "string") {
      console.error(
        "[LOGIN] Brak derivedKeyB64 w rekordzie użytkownika:",
        username
      );
      return res.status(500).json({
        success: false,
        error: "Błędna konfiguracja hasła użytkownika.",
      });
    }

    const a = Buffer.from(storedDerivedKeyB64, "base64");
    const b = Buffer.from(derivedKeyB64, "base64");

    if (a.length !== b.length) {
      return res.status(401).json({
        success: false,
        error: "Nieprawidłowe dane logowania (hasło).",
      });
    }

    if (!crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({
        success: false,
        error: "Nieprawidłowe dane logowania (hasło).",
      });
    }

    // 4) Challenge
    const entry = getAndDeleteChallenge(challengeId);
    if (!entry) {
      return res.status(401).json({
        success: false,
        error: "Nieprawidłowy lub wygasły challengeId.",
      });
    }

    if (isChallengeExpired(entry)) {
      return res.status(401).json({
        success: false,
        error: "Challenge wygasł. Spróbuj zalogować się ponownie.",
      });
    }

    if (entry.username !== username) {
      console.error(
        "[LOGIN] Niezgodność username przy challenge’u:",
        entry.username,
        "vs",
        username
      );
      return res.status(401).json({
        success: false,
        error: "Nieprawidłowy challenge dla użytkownika.",
      });
    }

    const { challengeB64 } = entry;

    // 4b) Weryfikacja podpisu challenge’a kluczem publicznym usera
    const publicKeyPem = userData.publicKeyPem;
    if (!publicKeyPem) {
      console.error(
        "[LOGIN] Brak publicKeyPem w rekordzie użytkownika:",
        username
      );
      return res.status(500).json({
        success: false,
        error: "Brak klucza publicznego użytkownika.",
      });
    }

    const sigOk = verifyClientSignature(
      challengeB64,
      challengeSignatureB64,
      publicKeyPem
    );

    if (!sigOk) {
      return res.status(401).json({
        success: false,
        error: "Podpis challenge’a nieprawidłowy.",
      });
    }

    // 5) JWT
    if (!JWT_SECRET) {
      console.error(
        "[LOGIN] JWT_SECRET nie jest ustawiony – nie można wygenerować tokenu."
      );
      return res.status(500).json({
        success: false,
        error: "Błąd konfiguracji serwera (brak JWT_SECRET).",
      });
    }

    const payload = { username };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

    const identityKeyFingerprint = userData.identityKeyFingerprint || null;

    return res.json({
      success: true,
      token,
      username,
      identityKeyFingerprint,
    });
  } catch (err) {
    console.error("[LOGIN] Błąd POST /finish:", err);
    return res.status(500).json({
      success: false,
      error: "Błąd serwera podczas finalizacji logowania.",
    });
  }
});

export default router;
