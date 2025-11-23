// frontend/register.js
// Rejestracja użytkownika w Danaid Chat
//
// Flow:
// 1. Użytkownik wpisuje username, hasło + powtórzenie.
// 2. Frontend generuje parę kluczy RSA (identity key).
// 3. Oblicza PBKDF2(password) -> derivedKeyB64 (tak samo jak w login.js).
// 4. Tworzy registrationPayload = JSON.stringify({ username, derivedKeyB64, publicKeyPem }).
// 5. Podpisuje registrationPayload kluczem prywatnym -> clientSignatureB64.
// 6. Wysyła do /api/register/:
//    { username, derivedKeyB64, publicKeyPem, clientSignatureB64, registrationPayload }
// 7. Backend zapisuje usera, odsyła success.
// 8. Frontend pobiera prywatny klucz jako plik .pem (user trzyma go lokalnie).

const API_BASE = "/api";

const ENDPOINTS = {
  REGISTER: `${API_BASE}/register/`,
};

// Te same parametry PBKDF2, co w login.js
const KDF_CONFIG = {
  saltText: "Danaid-PBKDF2-Salt-v1", // musi być identyczne z login.js
  iterations: 200_000,
  derivedKeyLength: 32, // bytes
  hash: "SHA-256",
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ========= HELPERY OGÓLNE =========

function logRegister(...args) {
  console.log("[REGISTER]", ...args);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function arrayBufferToBase64(buffer) {
  return bytesToBase64(new Uint8Array(buffer));
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

// ========= PBKDF2 =========

async function deriveKeyFromPassword(password) {
  const passwordBytes = textEncoder.encode(password);
  const saltBytes = textEncoder.encode(KDF_CONFIG.saltText);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
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

// ========= RSA KEYPAIR (IDENTITY KEY) =========

async function generateIdentityKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true, // exportowalne
    ["sign", "verify"]
  );

  return keyPair; // { publicKey, privateKey }
}

async function exportPublicKeyToPem(publicKey) {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  const b64 = arrayBufferToBase64(spki);

  const formatted = b64.match(/.{1,64}/g).join("\n");
  const pem = `-----BEGIN PUBLIC KEY-----\n${formatted}\n-----END PUBLIC KEY-----\n`;
  return pem;
}

async function exportPrivateKeyToPem(privateKey) {
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
  const b64 = arrayBufferToBase64(pkcs8);

  const formatted = b64.match(/.{1,64}/g).join("\n");
  const pem = `-----BEGIN PRIVATE KEY-----\n${formatted}\n-----END PRIVATE KEY-----\n`;
  return pem;
}

// ========= PODPIS REJESTRACYJNY =========

async function signRegistrationPayload(privateKey, payloadStr) {
  const payloadBytes = textEncoder.encode(payloadStr);

  const sigBuf = await crypto.subtle.sign(
    {
      name: "RSASSA-PKCS1-v1_5",
    },
    privateKey,
    payloadBytes
  );

  const sigBytes = new Uint8Array(sigBuf);
  return bytesToBase64(sigBytes);
}

// ========= KOMUNIKACJA Z BACKENDEM =========

async function sendRegisterRequest(body) {
  const res = await fetch(ENDPOINTS.REGISTER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Rejestracja HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || "Rejestracja nieudana.");
  }

  return data;
}

// ========= FORM / UI =========

function getRegisterFormElements() {
  const form = document.getElementById("register-form");
  const usernameInput = document.getElementById("register-username");
  const passwordInput = document.getElementById("register-password");
  const passwordRepeatInput = document.getElementById(
    "register-password-repeat"
  );
  const statusEl = document.getElementById("register-status"); // opcjonalne pole na komunikaty

  return {
    form,
    usernameInput,
    passwordInput,
    passwordRepeatInput,
    statusEl,
  };
}

function setStatus(statusEl, text, isError = false) {
  if (!statusEl) {
    if (isError) console.error("[REGISTER] ", text);
    else console.log("[REGISTER] ", text);
    return;
  }
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ff5555" : "#cccccc";
}

async function handleRegisterSubmit(event) {
  event.preventDefault();

  const {
    usernameInput,
    passwordInput,
    passwordRepeatInput,
    statusEl,
  } = getRegisterFormElements();

  const username = usernameInput?.value.trim();
  const password = passwordInput?.value || "";
  const passwordRepeat = passwordRepeatInput?.value || "";

  if (!username || !password || !passwordRepeat) {
    setStatus(statusEl, "Wypełnij wszystkie pola.", true);
    return;
  }

  if (password !== passwordRepeat) {
    setStatus(statusEl, "Hasła nie są zgodne.", true);
    return;
  }

  try {
    setStatus(statusEl, "Rejestracja w toku...");

    logRegister("Start rejestracji dla:", username);

    // 1. PBKDF2 -> derivedKeyB64
    const derivedKeyB64 = await deriveKeyFromPassword(password);
    logRegister("Wyprowadzono derivedKeyB64 (PBKDF2).");

    // 2. Generowanie pary kluczy RSA
    const keyPair = await generateIdentityKeyPair();
    logRegister("Wygenerowano parę kluczy RSA.");

    const publicKeyPem = await exportPublicKeyToPem(keyPair.publicKey);
    const privateKeyPem = await exportPrivateKeyToPem(keyPair.privateKey);

    logRegister("Wyeksportowano klucze do PEM.");

    // 3. registrationPayload
    const registrationPayload = JSON.stringify({
      username,
      derivedKeyB64,
      publicKeyPem,
    });

    // 4. Podpis payloadu kluczem prywatnym
    const clientSignatureB64 = await signRegistrationPayload(
      keyPair.privateKey,
      registrationPayload
    );
    logRegister("Podpisano registrationPayload.");

    // 5. Przygotowanie body do wysłania
    const body = {
      username,
      derivedKeyB64,
      publicKeyPem,
      clientSignatureB64,
      registrationPayload,
      // prekeyBundle: na razie null / pominięte (dodamy przy X3DH v2)
    };

    // 6. Wyślij do backendu
    const data = await sendRegisterRequest(body);

    logRegister("Rejestracja zakończona sukcesem:", data);

    setStatus(statusEl, "Rejestracja udana! Pobierz swój klucz prywatny.");

    // 7. Pobierz klucz prywatny jako plik .pem
    const filename = `${username}_private_key.pem`;
    downloadTextFile(filename, privateKeyPem);

    // Możesz tu zrobić redirect na login lub przełączyć zakładkę formularzy:
    // window.location.href = "login.html";
  } catch (err) {
    console.error("[REGISTER] Błąd rejestracji:", err);
    setStatus(statusEl, err.message || "Nie udało się zarejestrować.", true);
  }
}

// ========= INIT =========

function initRegister() {
  const { form } = getRegisterFormElements();
  if (!form) {
    console.warn("[REGISTER] Nie znaleziono formularza #register-form.");
    return;
  }

  form.addEventListener("submit", handleRegisterSubmit);
  logRegister("Zainicjalizowano obsługę rejestracji.");
}

document.addEventListener("DOMContentLoaded", () => {
  initRegister();
});
