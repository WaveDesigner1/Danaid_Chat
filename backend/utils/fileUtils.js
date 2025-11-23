// backend/utils/fileUtils.js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================= ŚCIEŻKI BAZY =================

const DB_DIR = path.join(__dirname, "..", "db");
const USERS_DIR = path.join(DB_DIR, "users");
const USERS_LIST = path.join(DB_DIR, "users_list.json");

// ============== POMOCNICZE FS ===================

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bezpieczny odczyt JSON:
 * - jeśli plik nie istnieje → defaultValue (domyślnie {})
 * - jeśli plik pusty → defaultValue
 * - jeśli JSON uszkodzony → log błędu + defaultValue
 *
 * Dzięki temu uszkodzony plik nie wywali całego serwera.
 */
export async function readJson(filePath, defaultValue = {}) {
  try {
    const exists = await fileExists(filePath);
    if (!exists) {
      return defaultValue;
    }

    const raw = await fs.readFile(filePath, "utf8");
    const text = raw.trim();
    if (!text) {
      return defaultValue;
    }

    try {
      return JSON.parse(text);
    } catch (parseErr) {
      console.error("[FILEUTILS] Błąd parsowania JSON:", {
        filePath,
        error: parseErr,
      });
      return defaultValue;
    }
  } catch (err) {
    console.error("[FILEUTILS] Błąd odczytu pliku JSON:", {
      filePath,
      error: err,
    });
    return defaultValue;
  }
}

export async function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, json, "utf8");
}

// Tworzy katalogi db/, db/users/ i plik users_list.json jeśli go nie ma
export async function ensureDbFolders() {
  await fs.mkdir(DB_DIR, { recursive: true });
  await fs.mkdir(USERS_DIR, { recursive: true });

  const exists = await fileExists(USERS_LIST);
  if (!exists) {
    const initial = { users: [] };
    await fs.writeFile(USERS_LIST, JSON.stringify(initial, null, 2), "utf8");
  }
}

// ============== USER HELPERS ====================

// Ścieżka do pliku konkretnego usera
export function getUserFile(username) {
  return path.join(USERS_DIR, `${username}.json`);
}

// Sprawdza, czy user istnieje w users_list.json
export async function userExists(username) {
  await ensureDbFolders();

  let list;
  try {
    const raw = await fs.readFile(USERS_LIST, "utf8");
    const text = raw.trim();
    list = text ? JSON.parse(text) : { users: [] };
  } catch {
    list = { users: [] };
  }

  const users = Array.isArray(list.users) ? list.users : [];
  return users.includes(username);
}

// Zapis nowego usera + dopisanie do users_list.json
export async function saveNewUser(username, userDoc) {
  await ensureDbFolders();

  let list;
  try {
    const raw = await fs.readFile(USERS_LIST, "utf8");
    const text = raw.trim();
    list = text ? JSON.parse(text) : { users: [] };
  } catch {
    list = { users: [] };
  }

  if (!Array.isArray(list.users)) list.users = [];

  if (list.users.includes(username)) {
    throw new Error("Użytkownik już istnieje");
  }

  list.users.push(username);

  await fs.writeFile(USERS_LIST, JSON.stringify(list, null, 2), "utf8");

  const userPath = getUserFile(username);
  await fs.writeFile(userPath, JSON.stringify(userDoc, null, 2), "utf8");
}

// Odczyt pliku usera
export async function loadUser(username) {
  await ensureDbFolders();
  const userPath = getUserFile(username);
  if (!(await fileExists(userPath))) return null;
  return await readJson(userPath);
}
