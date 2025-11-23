// backend/routes/register.js
// Router Express do obsługi rejestracji użytkownika (lokalny model: PBKDF2 + derivedKeyB64 + E2EE-infra)
//
// Założenia (spójne z naszym projektem):
// - frontend generuje parę kluczy RSA (identity key)
// - frontend liczy PBKDF2 hasła -> derivedKeyB64
// - frontend podpisuje challenge/przesłane dane kluczem prywatnym
// - backend weryfikuje podpis, sprawdza unikalność username
// - backend zapisuje:
//     username,
//     derivedKeyB64,
//     publicKeyPem,
//     identityKeyFingerprint,
//     prekeyBundle (opcjonalnie),
//     serverSignature,
//     friends: [],
//     inbox: [],
//     settings: {}
//
// Endpoint jest montowany np. pod /api/register:
// app.use("/api/register", registerRouter);
// -> POST /api/register/

import express from "express";
import crypto from "crypto";
import { fileURLToPath } from "url";
import path from "path";
import { requireAuth } from "../middleware/auth.js";
import {
  userExists,
  saveNewUser,
  ensureDbFolders,
} from "../utils/fileUtils.js";
import {
  verifyClientSignature,
  computeIdentityKeyFingerprint,
} from "../utils/security.js";
import { signServerData } from "../security/security.js";

const router = express.Router();

// ===== ESM ścieżki (jak w innych routerach) =====

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== HELPERY / WALIDACJA =====

/**
 * Prosta walidacja nazwy użytkownika.
 * Możesz dostosować regex wedle uznania.
 */
function isValidUsername(username) {
  if (typeof username !== "string") return false;
  if (username.length < 3 || username.length > 32) return false;
  // tylko litery/cyfry/underscore
  return /^[a-zA-Z0-9_]+$/.test(username);
}

/**
 * Prosta walidacja derivedKeyB64 (PBKDF2 output w Base64).
 */
function isValidDerivedKey(derivedKeyB64) {
  if (typeof derivedKeyB64 !== "string") return false;
  if (derivedKeyB64.length < 16) return false;
  return true;
}

/**
 * Minimalna walidacja PEM (czy wygląda jak klucz publiczny).
 */
function looksLikePublicKeyPem(pem) {
  if (typeof pem !== "string") return false;
  return pem.includes("BEGIN PUBLIC KEY") && pem.includes("END PUBLIC KEY");
}

// ===== ROUTE: POST / (rejestracja) =====

/**
 * POST /api/register/
 *
 * Body (przykładowo):
 * {
 *   "username": "alice",
 *   "derivedKeyB64": "...",        // PBKDF2(password, salt, iters, len)
 *   "publicKeyPem": "-----BEGIN PUBLIC KEY...-----",
 *   "clientSignatureB64": "...",   // podpis nad 'registrationPayload'
 *   "registrationPayload": "...",  // np. JSON.stringify({ username, derivedKeyB64, ... })
 *   "prekeyBundle": {              // opcjonalne, pod E2EE v2
 *     "signedPreKeyPub": "...",
 *     "signedPreKeySignature": "...",
 *     "oneTimePreKeys": [ { "id": 1, "pub": "..." }, ... ]
 *   }
 * }
 *
 * Zwraca:
 * {
 *   "success": true,
 *   "user": {
 *     "username": "...",
 *     "identityKeyFingerprint": "...",
 *     "hasPrekeyBundle": true/false
 *   }
 * }
 */

router.post("/", async (req, res) => {
  try {
    await ensureDbFolders();

    const {
      username,
      derivedKeyB64,
      publicKeyPem,
      clientSignatureB64,
      registrationPayload,
      prekeyBundle,
    } = req.body || {};

    // === Walidacja pól wejściowych ===

    if (!username || !derivedKeyB64 || !publicKeyPem || !clientSignatureB64) {
      return res.status(400).json({
        success: false,
        error:
          "Brak wymaganych pól: username, derivedKeyB64, publicKeyPem, clientSignatureB64.",
      });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({
        success: false,
        error: "Nieprawidłowa nazwa użytkownika.",
      });
    }

    if (!isValidDerivedKey(derivedKeyB64)) {
      return res.status(400).json({
        success: false,
        error: "Nieprawidłowy derivedKeyB64.",
      });
    }

    if (!looksLikePublicKeyPem(publicKeyPem)) {
      return res.status(400).json({
        success: false,
        error: "publicKeyPem nie wygląda na poprawny klucz publiczny PEM.",
      });
    }

    // === Sprawdzenie czy user już istnieje ===

    const exists = await userExists(username);
    if (exists) {
      return res.status(409).json({
        success: false,
        error: "Użytkownik o takiej nazwie już istnieje.",
      });
    }

    // === Weryfikacja podpisu klienta ===
    //
    // Zakładamy, że frontend:
    // - przygotował registrationPayload (np. JSON z parametrami rejestracji),
    // - podpisał go kluczem prywatnym usera -> clientSignatureB64,
    // - wysłał oba do backendu.
    //
    // Jeżeli registrationPayload nie jest przesyłany osobno,
    // można weryfikować np. JSON.stringify({ username, derivedKeyB64, publicKeyPem })

    const messageToVerify =
      typeof registrationPayload === "string"
        ? registrationPayload
        : JSON.stringify({ username, derivedKeyB64, publicKeyPem });

    const sigOk = verifyClientSignature(
      messageToVerify,
      clientSignatureB64,
      publicKeyPem
    );

    if (!sigOk) {
      return res.status(400).json({
        success: false,
        error: "Podpis klienta nieprawidłowy.",
      });
    }

    // === Obliczenie fingerprintu klucza tożsamości ===

    const identityKeyFingerprint = computeIdentityKeyFingerprint(publicKeyPem);
    if (!identityKeyFingerprint) {
      return res.status(500).json({
        success: false,
        error: "Nie udało się obliczyć fingerprintu klucza tożsamości.",
      });
    }

    // === Przygotowanie rekordu użytkownika do zapisania ===

    const now = Date.now();

    const userRecord = {
      username,
      // Zamiast przechowywać hasło, trzymamy derivedKey (PBKDF2)
      derivedKeyB64,
      // Klucz tożsamości (RSA publiczny)
      publicKeyPem,
      identityKeyFingerprint,
      // Prekey bundle (opcjonalnie, pod E2EE v2)
      prekeyBundle: prekeyBundle || null,
      // Dane pomocnicze / meta
      createdAt: now,
      updatedAt: now,
      // Relacje i ustawienia
      friends: [],
      inbox: [],
      settings: {},
    };

    // === Podpis serwera nad danymi użytkownika ===
    //
    // serverSignature ma zapewniać integralność wpisu użytkownika.
    // signServerData powinno zwrócić Base64 z podpisu nad np. JSONem userRecord (bez serverSignature).
    const serverSignature = signServerData(JSON.stringify(userRecord));

    const userToSave = {
      ...userRecord,
      serverSignature,
    };

    // === Zapis użytkownika do bazy (plik JSON) ===

    await saveNewUser(username, userToSave);

    // === Odpowiedź ===

    return res.status(201).json({
      success: true,
      user: {
        username,
        identityKeyFingerprint,
        hasPrekeyBundle: !!prekeyBundle,
      },
    });
  } catch (err) {
    console.error("[REGISTER] Błąd POST /api/register:", err);
    return res.status(500).json({
      success: false,
      error: "Błąd serwera podczas rejestracji.",
    });
  }
});

export default router;
