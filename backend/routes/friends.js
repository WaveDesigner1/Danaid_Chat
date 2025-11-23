// backend/routes/friends.js
// Router do obsługi znajomych w Danaid Chat
// - lista znajomych
// - dodanie znajomego (symetrycznie, status "accepted")
// - tworzenie pliku konwersacji conv_<user>_<friend>.json
import { signServerData } from "../security/security.js";
import express from "express";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { requireAuth } from "../middleware/auth.js";
import { readJson, writeJson, userExists } from "../utils/fileUtils.js";

const router = express.Router();

// ===== ŚCIEŻKI DB =====

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_ROOT = path.join(__dirname, "..", "db");
const USERS_DIR = path.join(DB_ROOT, "users");
const CONV_DIR = path.join(DB_ROOT, "conversations");

// Upewniamy się, że katalog conversations istnieje
if (!fs.existsSync(CONV_DIR)) {
  fs.mkdirSync(CONV_DIR, { recursive: true });
  console.log("[FRIENDS] Utworzono katalog:", CONV_DIR);
}

// ===== HELPERY =====

function getUserFilePath(username) {
  return path.join(USERS_DIR, `${username}.json`);
}

/**
 * conv_<alice>_<bob>.json – nazwa pliku na podstawie posortowanych nazw.
 */
function getConversationFilename(userA, userB) {
  const sorted = [userA, userB].sort();
  return `conv_${sorted[0]}_${sorted[1]}.json`;
}

function getConversationFilePath(userA, userB) {
  const filename = getConversationFilename(userA, userB);
  return path.join(CONV_DIR, filename);
}

/**
 * Ładuje plik użytkownika.
 */
async function loadUser(username) {
  const userPath = getUserFilePath(username);
  return readJson(userPath);
}

/**
 * Zapisuje plik użytkownika.
 */
/**
 * Zapisuje plik użytkownika z nowym serverSignature.
 * Ignoruje ewentualne serverSignature z `data` i liczy je od nowa.
 */
async function saveUser(username, data) {
  const userPath = getUserFilePath(username);

  // Rozdziel dane od starego podpisu (jeśli jest)
  const { serverSignature, ...withoutSignature } = data;

  // (opcjonalnie) aktualizacja timestampu
  withoutSignature.updatedAt = Date.now();

  // Podpisujemy dokładnie to, co później będzie w user.json bez serverSignature
  const dataString = JSON.stringify(withoutSignature);
  const newSignature = signServerData(dataString);

  const toSave = {
    ...withoutSignature,
    serverSignature: newSignature,
  };

  await writeJson(userPath, toSave);
}
/**
 * Tworzy (jeśli nie istnieje) plik konwersacji dla pary userów.
 * Zwraca nazwę pliku (bez ścieżki).
 */
async function ensureConversationFile(userA, userB) {
  const convPath = getConversationFilePath(userA, userB);
  const filename = path.basename(convPath);

  if (!fs.existsSync(convPath)) {
    const conv = {
      participants: [userA, userB],
      messages: [],
    };
    await writeJson(convPath, conv);
    console.log("[FRIENDS] Utworzono nową konwersację:", filename);
  }

  return filename;
}

/**
 * Dodaje wpis friend dla usera, jeśli jeszcze nie istnieje.
 * Ustawia status i conversationFile.
 */
function upsertFriendEntry(userData, friendUsername, status, conversationFile, friendPublicKeyPem, friendIdentityKeyFingerprint) {
  if (!Array.isArray(userData.friends)) {
    userData.friends = [];
  }

  const existing = userData.friends.find((f) => f.username === friendUsername);

  if (existing) {
    // Aktualizujemy tylko to, co ma sens, nie kasując innych pól
    existing.status = status || existing.status || "accepted";
    if (conversationFile) {
      existing.conversationFile = conversationFile;
    }
    if (friendPublicKeyPem) {
      existing.publicKeyPem = friendPublicKeyPem;
    }
    if (friendIdentityKeyFingerprint) {
      existing.identityKeyFingerprint = friendIdentityKeyFingerprint;
    }
  } else {
    userData.friends.push({
      username: friendUsername,
      status: status || "accepted",
      conversationFile: conversationFile || null,
      publicKeyPem: friendPublicKeyPem || null,
      identityKeyFingerprint: friendIdentityKeyFingerprint || null,
    });
  }

  return userData;
}

// ===== ROUTES =====

/**
 * GET /api/friends/list
 * Zwraca listę znajomych zalogowanego użytkownika.
 *
 * Odpowiedź:
 * {
 *   success: true,
 *   friends: [
 *     {
 *       username,
 *       status,
 *       conversationFile,
 *       publicKeyPem,
 *       identityKeyFingerprint
 *     },
 *     ...
 *   ]
 * }
 */
router.get("/list", requireAuth, async (req, res) => {
  const username = req.user?.username;

  if (!username) {
    return res.status(401).json({
      success: false,
      error: "Brak użytkownika w kontekście sesji.",
    });
  }

  try {
    const userData = await loadUser(username);
    const friends = Array.isArray(userData.friends) ? userData.friends : [];

    return res.json({
      success: true,
      friends,
    });
  } catch (err) {
    console.error("[FRIENDS] Błąd GET /list:", err);
    return res.status(500).json({
      success: false,
      error: "Błąd serwera podczas pobierania listy znajomych.",
    });
  }
});

/**
 * POST /api/friends/add
 * Dodaje znajomego (symetrycznie – obie strony) i tworzy konwersację.
 *
 * Body:
 * {
 *   friendUsername: "bob"
 * }
 *
 * Zakładamy, że:
 * - friendUsername istnieje w bazie,
 * - znajomość staje się od razu "accepted" (dla uproszczenia),
 * - plik konwersacji jest tworzony tutaj.
 *
 * Odpowiedź:
 * {
 *   success: true,
 *   friend: { ...wpis znajomego po stronie zalogowanego usera... }
 * }
 */
router.post("/add", requireAuth, async (req, res) => {
  const username = req.user?.username;
  const { friendUsername } = req.body || {};

  if (!username || !friendUsername) {
    return res.status(400).json({
      success: false,
      error: "Brak username lub friendUsername.",
    });
  }

  if (username === friendUsername) {
    return res.status(400).json({
      success: false,
      error: "Nie możesz dodać samego siebie do znajomych.",
    });
  }

  try {
    // Sprawdź, czy drugi user istnieje
    const exists = await userExists(friendUsername);
    if (!exists) {
      return res.status(404).json({
        success: false,
        error: "Użytkownik o podanej nazwie nie istnieje.",
      });
    }

    // Wczytaj dane obu użytkowników
    const userData = await loadUser(username);
    const friendData = await loadUser(friendUsername);

    // Sprawdź, czy już są znajomymi
    const alreadyFriend =
      Array.isArray(userData.friends) &&
      userData.friends.some((f) => f.username === friendUsername);

    if (alreadyFriend) {
      return res.status(400).json({
        success: false,
        error: "Ten użytkownik jest już na liście znajomych.",
      });
    }

    // Ustal conversationFile (wspólny)
    const conversationFile = await ensureConversationFile(
      username,
      friendUsername
    );

    // Przygotuj dane crypto znajomego (public key + fingerprint)
    const friendPublicKeyPem =
      friendData.publicKey ||
      friendData.publicKeyPem ||
      null; // zależne od Twojej struktury
    const friendIdentityKeyFingerprint =
      friendData.identityKeyFingerprint || null;

    // I na odwrót – dane crypto usera dla frienda
    const userPublicKeyPem =
      userData.publicKey || userData.publicKeyPem || null;
    const userIdentityKeyFingerprint = userData.identityKeyFingerprint || null;

    // Dodaj wpis friend po obu stronach (status = "accepted")
    upsertFriendEntry(
      userData,
      friendUsername,
      "accepted",
      conversationFile,
      friendPublicKeyPem,
      friendIdentityKeyFingerprint
    );

    upsertFriendEntry(
      friendData,
      username,
      "accepted",
      conversationFile,
      userPublicKeyPem,
      userIdentityKeyFingerprint
    );

    // Zapisz zmiany
    await saveUser(username, userData);
    await saveUser(friendUsername, friendData);

    // Zwróć wpis friend z perspektywy zalogowanego usera
    const newFriendEntry = userData.friends.find(
      (f) => f.username === friendUsername
    );

    return res.json({
      success: true,
      friend: newFriendEntry,
    });
  } catch (err) {
    console.error("[FRIENDS] Błąd POST /add:", err);
    return res.status(500).json({
      success: false,
      error: "Błąd serwera podczas dodawania znajomego.",
    });
  }
});

export default router;
