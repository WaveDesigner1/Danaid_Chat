// frontend/login.js
// Logowanie użytkownika do Danaid Chat
// Flow:
// 1. Użytkownik wpisuje username + hasło, wybiera plik z kluczem prywatnym (.pem)
// 2. Frontend -> POST /api/login/start { username } -> challengeId + challengeB64
// 3. Frontend:
//    - liczy PBKDF2(password) -> derivedKeyB64 (jak przy rejestracji)
//    - importuje privateKey z PEM
//    - podpisuje challengeB64 -> challengeSignatureB64
// 4. Frontend -> POST /api/login/finish { username, derivedKeyB64, challengeId, challengeSignatureB64 }
// 5. Jak sukces -> zapisuje JWT + username w localStorage i leci na chat.html

const API_BASE = "/api";

const ENDPOINTS = {
  LOGIN_START: `${API_BASE}/login/start`,
  LOGIN_FINISH: `${API_BASE}/login/finish`,
};

const LS_USERNAME_KEY = "danaid_username";
const LS_JWT_KEY = "danaid_jwt";

// PBKDF2 parametry – MUSZĄ być takie same w rejestracji i logowaniu
const KDF_CONFIG = {
  saltText: "Danaid-PBKDF2-Salt-v1",
  iterations: 200_000,
  derivedKeyLength: 32, // bajty
  hash: "SHA-256",
};

const textEncoder = new TextEncoder();

// ========= HELPERY UI / SESJI =========

function logLogin(...args) {
  console.log("[LOGIN]", ...args);
}

function setStatus(message, isError = false) {
  const statusEl = document.getElementById("login-status");
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", !!isError);
}

function setLoading(isLoading) {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;
  overlay.style.display = isLoading ? "flex" : "none";
}

function clearSession() {
  localStorage.removeItem(LS_USERNAME_KEY);
  localStorage.removeItem(LS_JWT_KEY);
}

function saveSession(username, token) {
  localStorage.setItem(LS_USERNAME_KEY, username);
  localStorage.setItem(LS_JWT_KEY, token);
}

// ========= BASE64 / KDF =========

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function deriveKeyFromPassword(password) {
  const saltBytes = textEncoder.encode(KDF_CONFIG.saltText);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: KDF_CONFIG.iterations,
      hash: KDF_CONFIG.hash,
    },
    baseKey,
    KDF_CONFIG.derivedKeyLength * 8
  );

  const derivedBytes = new Uint8Array(derivedBits);
  return bytesToBase64(derivedBytes);
}

// ========= PEM / RSA =========

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/[\r\n\s]/g, "");
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function importPrivateKeyFromPem(pem) {
  const keyBuffer = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ========= PODPISYWANIE CHALLENGE (ważna poprawka!) =========
// Backend weryfikuje *string* (challengeB64) — więc podpisujemy UTF-8 string, NIE zdekodowane bajty.

async function signChallenge(privateKey, challengeB64) {
  const challengeBytes = textEncoder.encode(challengeB64);

  const signature = await crypto.subtle.sign(
    {
      name: "RSASSA-PKCS1-v1_5",
    },
    privateKey,
    challengeBytes
  );

  const sigBytes = new Uint8Array(signature);
  return bytesToBase64(sigBytes);
}

// ========= FETCHY: /login/start i /login/finish =========

async function loginStart(username) {
  const res = await fetch(ENDPOINTS.LOGIN_START, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username }),
  });

  if (!res.ok) {
    throw new Error(`Login start HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || "Nie udało się zainicjować logowania.");
  }

  const { challengeId, challengeB64 } = data;
  if (!challengeId || !challengeB64) {
    throw new Error("Brak danych challenge w odpowiedzi serwera.");
  }

  return { challengeId, challengeB64 };
}

async function loginFinish({
  username,
  derivedKeyB64,
  challengeId,
  challengeSignatureB64,
}) {
  const res = await fetch(ENDPOINTS.LOGIN_FINISH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      derivedKeyB64,
      challengeId,
      challengeSignatureB64,
    }),
  });

  if (!res.ok) {
    throw new Error(`Login finish HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || "Logowanie nieudane.");
  }

  const { token, identityKeyFingerprint } = data;
  if (!token) {
    throw new Error("Brak tokenu JWT w odpowiedzi.");
  }

  return { token, identityKeyFingerprint };
}

// ========= FORM / DOM =========

function getFormElements() {
  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");
  const pemFileInput = document.getElementById("login-pem-file");
  const form = document.getElementById("login-form-element");
  return { usernameInput, passwordInput, pemFileInput, form };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsText(file);
  });
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  const { usernameInput, passwordInput, pemFileInput } = getFormElements();

  const username = usernameInput?.value.trim();
  const password = passwordInput?.value || "";
  const pemFile = pemFileInput?.files?.[0] || null;

  if (!username || !password || !pemFile) {
    setStatus("Wypełnij wszystkie pola (login, hasło, klucz prywatny).", true);
    return;
  }

  try {
    setLoading(true);
    setStatus("Logowanie w toku...");

    clearSession();
    logLogin("Start logowania dla:", username);

    // 1. derivedKeyB64
    const derivedKeyB64 = await deriveKeyFromPassword(password);
    logLogin("Wyprowadzono derivedKeyB64 (PBKDF2).");

    // 2. Odczyt klucza prywatnego z pliku
    const pemText = await readFileAsText(pemFile);
    const privateKey = await importPrivateKeyFromPem(pemText);
    logLogin("Zaimportowano klucz prywatny z PEM.");

    // 3. /login/start -> challenge
    const { challengeId, challengeB64 } = await loginStart(username);
    logLogin("Otrzymano challenge:", { challengeId });

    // 4. Podpisanie challenge’a
    const challengeSignatureB64 = await signChallenge(
      privateKey,
      challengeB64
    );
    logLogin("Podpisano challenge.");

    // 5. /login/finish
    const { token, identityKeyFingerprint } = await loginFinish({
      username,
      derivedKeyB64,
      challengeId,
      challengeSignatureB64,
    });

    logLogin("Logowanie udane. IdentityKeyFingerprint:", identityKeyFingerprint);

    saveSession(username, token);
    setStatus("Zalogowano pomyślnie.");

    // Przejście na czat
    window.location.href = "chat.html";
  } catch (err) {
    console.error("[LOGIN] Błąd logowania:", err);
    setStatus(err.message || "Nie udało się zalogować.", true);
  } finally {
    setLoading(false);
  }
}

// ========= INIT =========

function initLogin() {
  const { form } = getFormElements();
  if (!form) {
    console.warn("[LOGIN] Nie znaleziono formularza #login-form-element.");
    return;
  }

  form.addEventListener("submit", handleLoginSubmit);
  logLogin("Zainicjalizowano obsługę logowania.");
}

document.addEventListener("DOMContentLoaded", () => {
  initLogin();
});
