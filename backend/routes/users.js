// backend/routes/users.js
// Publiczne (i pół-publiczne) informacje o użytkownikach dla Danaid Chat
// - /api/users/info/:username           -> publiczny profil crypto
// - /api/users/prekey-bundle/:username  -> prekey bundle pod E2EE v2

import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import { requireAuth } from "../middleware/auth.js";
import { readJson } from "../utils/fileUtils.js";

const router = express.Router();

// ===== ŚCIEŻKI DB =====

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_ROOT = path.join(__dirname, "..", "db");
const USERS_DIR = path.join(DB_ROOT, "users");

function getUserFilePath(username) {
  return path.join(USERS_DIR, `${username}.json`);
}

// ===== ROUTES =====

/**
 * GET /api/users/info/:username
 *
 * Zwraca publiczne informacje o użytkowniku:
 * - username
 * - identityKeyFingerprint
 * - publicKeyPem (klucz tożsamości, jeśli chcesz go udostępniać)
 *
 * Odpowiedź:
 * {
 *   success: true,
 *   user: {
 *     username,
 *     identityKeyFingerprint,
 *     publicKeyPem
 *   }
 * }
 */
router.get("/info/:username", async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: "Brak username w parametrze.",
    });
  }

  try {
    const userPath = getUserFilePath(username);
    const userData = await readJson(userPath);

    const publicKeyPem =
      userData.publicKey || userData.publicKeyPem || null;
    const identityKeyFingerprint = userData.identityKeyFingerprint || null;

    return res.json({
      success: true,
      user: {
        username,
        identityKeyFingerprint,
        publicKeyPem,
      },
    });
  } catch (err) {
    console.error("[USERS] Błąd GET /info:", err);
    return res.status(404).json({
      success: false,
      error: "Nie znaleziono użytkownika.",
    });
  }
});

/**
 * GET /api/users/prekey-bundle/:username
 *
 * Zwraca prekey bundle użytkownika (publiczna część), wykorzystywaną
 * przy startowaniu sesji E2EE (X3DH-lite).
 *
 * Zakładamy, że w pliku usera mamy:
 * {
 *   ...,
 *   prekeyBundle: {
 *     signedPreKeyPub,
 *     signedPreKeySignature,
 *     oneTimePreKeys: [ { id, pub }, ... ]
 *   }
 * }
 *
 * Odpowiedź:
 * {
 *   success: true,
 *   bundle: { ... }
 * }
 */
router.get("/prekey-bundle/:username", async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: "Brak username w parametrze.",
    });
  }

  try {
    const userPath = getUserFilePath(username);
    const userData = await readJson(userPath);

    const prekeyBundle = userData.prekeyBundle || null;

    if (!prekeyBundle) {
      return res.status(404).json({
        success: false,
        error: "Użytkownik nie ma zdefiniowanego prekey bundle.",
      });
    }

    return res.json({
      success: true,
      bundle: prekeyBundle,
    });
  } catch (err) {
    console.error("[USERS] Błąd GET /prekey-bundle:", err);
    return res.status(404).json({
      success: false,
      error: "Nie znaleziono użytkownika lub jego prekey bundle.",
    });
  }
});

export default router;
