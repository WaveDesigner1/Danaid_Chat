// backend/routes/messages.js
// Router Express do obsługi wiadomości (E2EE v2 + fallback plaintext)
//
// Endpointy:
//   POST   /api/messages/send
//   GET    /api/messages/get/:friendUsername
//   POST   /api/messages/clear
//
// Format z FRONTU (nowy):
//   body = { to, encryptedPayload }   // E2EE v2
//   albo  { to, text }                // fallback plaintext
//
// Format w pliku konwersacji (conv_*.json):
//   {
//     messages: [
//       {
//         id: number,
//         from: string,
//         to: string,
//         timestamp: number,
//         encryptedPayload?: { header, ivB64, ciphertextB64, authTagB64, ad },
//         text?: string
//       },
//       ...
//     ]
//   }

import express from "express";
import { fileURLToPath } from "url";
import path from "path";

import {
  ensureDbFolders,
  readJson,
  writeJson,
} from "../utils/fileUtils.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// ===== ESM ścieżki =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== Ścieżki do bazy =====
const DB_ROOT = path.join(__dirname, "..", "db");
const CONVERSATIONS_DIR = path.join(DB_ROOT, "conversations");

// Upewniamy się, że katalogi istnieją
ensureDbFolders();

/**
 * Zwraca kanoniczną nazwę pliku konwersacji dla pary użytkowników.
 * Para jest sortowana alfabetycznie, żeby Alice-WaveDesigner == WaveDesigner-Alice.
 */
function getConversationFilePath(userA, userB) {
  const pair = [userA, userB].slice().sort();
  const convId = `conv_${pair[0]}__${pair[1]}.json`;
  return path.join(CONVERSATIONS_DIR, convId);
}

/**
 * Wczytanie pliku konwersacji lub domyślna struktura.
 */
async function loadConversation(userA, userB) {
  const convPath = getConversationFilePath(userA, userB);
  const conv = await readJson(convPath, { messages: [] });
  if (!Array.isArray(conv.messages)) {
    conv.messages = [];
  }
  return { conv, convPath };
}

/**
 * Zwraca kolejny ID wiadomości (auto-increment).
 */
function getNextMessageId(messages) {
  if (!messages.length) return 1;
  const maxId = messages.reduce(
    (max, msg) => (typeof msg.id === "number" && msg.id > max ? msg.id : max),
    0
  );
  return maxId + 1;
}

// =============================
// POST /api/messages/send
// =============================

router.post("/send", requireAuth, async (req, res) => {
  try {
    const fromUsername = req.user?.username;
    if (!fromUsername) {
      return res.status(401).json({
        success: false,
        error: "Brak użytkownika w sesji.",
      });
    }

    // Nowy format z frontu:
    //   { to, encryptedPayload } lub { to, text }
    //
    // Dla kompatybilności próbujemy też wyciągnąć ewentualne stare pola.
    const {
      to,
      text,
      encryptedPayload,
      // legacy / eksperymentalne pola:
      recipient,
      ciphertextB64,
      authTagB64,
      ivB64,
      header,
      ad,
    } = req.body || {};

    const toUsername = to || recipient;
    if (!toUsername) {
      return res.status(400).json({
        success: false,
        error: "Brak pola 'to' (adresata) w żądaniu.",
      });
    }

    if (!encryptedPayload && !text && !ciphertextB64) {
      return res.status(400).json({
        success: false,
        error: "Brak treści wiadomości (encryptedPayload / text).",
      });
    }

    // Normalizujemy encryptedPayload, jeżeli przyleciały legacy pola
    let finalEncryptedPayload = encryptedPayload || null;

    if (!finalEncryptedPayload && ciphertextB64) {
      // Uwaga: to jest tryb kompatybilności z wcześniejszymi eksperymentami.
      finalEncryptedPayload = {
        header: header || { n: 0, pn: 0, timestamp: Date.now() },
        ivB64: ivB64 || null,
        ciphertextB64,
        authTagB64: authTagB64 || null,
        ad: ad || {
          version: 1,
          from: fromUsername,
          to: toUsername,
        },
      };
    }

    const { conv, convPath } = await loadConversation(
      fromUsername,
      toUsername
    );

    const nextId = getNextMessageId(conv.messages);
    const now = Date.now();

    const message = {
      id: nextId,
      from: fromUsername,
      to: toUsername,
      timestamp: now,
    };

    if (finalEncryptedPayload) {
      message.encryptedPayload = finalEncryptedPayload;
    }

    if (typeof text === "string" && text.length > 0) {
      message.text = text;
    }

    conv.messages.push(message);
    await writeJson(convPath, conv);

    return res.json({
      success: true,
      message,
    });
  } catch (err) {
    console.error("[MESSAGES] Błąd w /send:", err);
    return res.status(500).json({
      success: false,
      error: "Błąd serwera podczas wysyłania wiadomości.",
    });
  }
});

// =============================
// GET /api/messages/get/:friendUsername
// =============================

router.get("/get/:friendUsername", requireAuth, async (req, res) => {
  try {
    const currentUser = req.user?.username;
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Brak użytkownika w sesji.",
      });
    }

    const friendUsername = decodeURIComponent(
      req.params.friendUsername || ""
    ).trim();

    if (!friendUsername) {
      return res.status(400).json({
        success: false,
        error: "Brak nazwy znajomego w URL.",
      });
    }

    const { conv } = await loadConversation(currentUser, friendUsername);

    // conv.messages już zawiera tylko wiadomości między tą parą
    // (bo plik jest per para), więc nie trzeba dodatkowo filtrować.
    // Ale dla bezpieczeństwa można przefiltrować:
    const messages = (conv.messages || []).filter((msg) => {
      return (
        (msg.from === currentUser && msg.to === friendUsername) ||
        (msg.from === friendUsername && msg.to === currentUser)
      );
    });

    return res.json({
      success: true,
      messages,
    });
  } catch (err) {
    console.error("[MESSAGES] Błąd w /get/:friendUsername:", err);
    return res.status(500).json({
      success: false,
      error: "Błąd serwera podczas pobierania wiadomości.",
    });
  }
});

// =============================
// POST /api/messages/clear
// =============================

router.post("/clear", requireAuth, async (req, res) => {
  try {
    const currentUser = req.user?.username;
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        error: "Brak użytkownika w sesji.",
      });
    }

    const { friendUsername } = req.body || {};
    if (!friendUsername) {
      return res.status(400).json({
        success: false,
        error: "Brak 'friendUsername' w body.",
      });
    }

    const { conv, convPath } = await loadConversation(
      currentUser,
      friendUsername
    );

    // Ponieważ plik jest per para, po prostu czyścimy messages
    conv.messages = [];
    await writeJson(convPath, conv);

    return res.json({
      success: true,
      cleared: true,
    });
  } catch (err) {
    console.error("[MESSAGES] Błąd w /clear:", err);
    return res.status(500).json({
      success: false,
      error: "Błąd serwera podczas czyszczenia rozmowy.",
    });
  }
});

export default router;
