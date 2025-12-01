# Danaid Chat — Warstwa logowania (DEV)

> **Cel:** zrozumieć **data flow logowania** w wersji DEV: od formularza logowania w HTML, przez logikę JS (PBKDF2 + challenge–response + podpis kluczem prywatnym), aż po backend (Express, weryfikacja hasła, podpisu i wydanie tokena).

---

## 0. Ogólny przepływ danych (routing logowania)

1. **Użytkownik otwiera stronę logowania**  
   → plik: `frontend/login.html` (formularz, inputy + upload PEM).

2. **Użytkownik wpisuje login/hasło i wybiera plik z kluczem prywatnym**  
   → plik: `frontend/js/login.js` (obsługa `submit`, odczyt PEM, wywołania fetch).

3. **Krok 1 logowania — pobranie parametrów i challenge**  
   → `POST /api/login/start`  
   → plik backend: `backend/routes/login.js` (sprawdzenie istnienia usera, odczyt PBKDF2 param, wygenerowanie challenge).

4. **Krok 2 logowania — wysłanie derivedKey + podpisu challenge**  
   → `POST /api/login/finish`  
   → plik backend: `backend/routes/login.js` (weryfikacja hasła, podpisu kluczem publicznym, wydanie tokena sesji/JWT).

5. **Frontend zapisuje token i przełącza widok na czat**  
   → plik: `frontend/js/login.js` (np. `localStorage.setItem('danaidToken', token)` i `window.location.href = 'chat.html'`).

---

## 1. Widok logowania — `frontend/login.html`

### 1.1. Formularz logowania

```html
<!-- ŚCIEŻKA: frontend/login.html -->
<section id="login-section" class="form-section">
  <h2 class="form-title">Logowanie</h2>

  <form id="login-form">
    <!-- Login / nazwa użytkownika -->
    <label for="login-username" class="form-label">Nazwa użytkownika</label>
    <input
      type="text"
      id="login-username"
      name="username"
      class="form-input"
      autocomplete="username"
      required
    />

    <!-- Hasło -->
    <label for="login-password" class="form-label">Hasło</label>
    <input
      type="password"
      id="login-password"
      name="password"
      class="form-input"
      autocomplete="current-password"
      required
    />

    <!-- Plik z kluczem prywatnym (PEM) -->
    <label for="login-pem-file" class="form-label">Klucz prywatny (PEM)</label>
    <input
      type="file"
      id="login-pem-file"
      class="form-input"
      accept=".pem"
      required
    />

    <!-- Komunikaty błędu / sukcesu -->
    <p id="login-message" class="form-message"></p>

    <button type="submit" class="btn primary-btn">Zaloguj</button>
  </form>
</section>
```

**Co tu się dzieje:**

- `id="login-form"` – kluczowe dla JS (`document.getElementById('login-form')`).
- `autocomplete="username"` / `current-password` – hint dla przeglądarki / menedżera haseł.
- `id="login-pem-file"` + `accept=".pem"` – pozwala wybrać lokalny klucz prywatny w formacie PEM.
- `id="login-message"` – miejsce, gdzie JS wrzuca komunikaty (np. "Błędne hasło", "OK").
- Klasy (`form-section`, `form-input`, `primary-btn`) spina CSS; możesz je śledzić w `frontend/css/*.css` jeżeli chcesz wiedzieć, skąd się biorą kolory/spacing.

---

## 2. Frontend logowania — `frontend/js/login.js`

### 2.1. Podpięcie eventu `submit` i odczyt PEM

```js
// ŚCIEŻKA: frontend/js/login.js

const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault(); // nie przeładowuj strony

  loginMessage.textContent = '';
  loginMessage.className = 'form-message';

  try {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const pemFileInput = document.getElementById('login-pem-file');

    if (!username || !password || pemFileInput.files.length === 0) {
      loginMessage.textContent = 'Uzupełnij login, hasło i wybierz plik PEM.';
      loginMessage.classList.add('error');
      return;
    }

    const pemFile = pemFileInput.files[0];
    const privateKeyPem = await readPemFileAsText(pemFile);

    // 1) Start logowania – pobierz parametry PBKDF2 i challenge z backendu
    const startData = await startLogin({ username });

    // 2) Wylicz derivedKey PBKDF2 po stronie klienta
    const derivedKeyB64 = await deriveKeyPBKDF2(
      password,
      startData.saltB64,
      startData.iterations,
      startData.derivedKeyLength,
      startData.hashAlg,
    );

    // 3) Podpisz challenge kluczem prywatnym użytkownika
    const challengeSignatureB64 = await signChallengeWithPrivateKey(
      privateKeyPem,
      startData.challenge,
    );

    // 4) Wyślij dane kończące logowanie
    const finishResult = await finishLogin({
      username,
      challengeId: startData.challengeId,
      derivedKeyB64,
      challengeSignatureB64,
    });

    // 5) Zapisz token sesji (np. JWT) i przejdź do czatu
    window.localStorage.setItem('danaidToken', finishResult.token);

    loginMessage.textContent = 'Zalogowano pomyślnie.';
    loginMessage.classList.add('success');

    window.location.href = 'chat.html';
  } catch (error) {
    console.error('Login error:', error);
    loginMessage.textContent = 'Błąd logowania po stronie klienta.';
    loginMessage.classList.add('error');
  }
});
```

**Wyjaśnienia:**

- `readPemFileAsText` – helper oparty na `FileReader`, który czyta zawartość pliku `.pem` jako string.
- `startLogin(...)` – helper robiący `fetch('/api/login/start', ...)` (patrz niżej).
- `deriveKeyPBKDF2(...)` – wrapper na WebCrypto `crypto.subtle.importKey` + `crypto.subtle.deriveBits/deriveKey`, wynik kodujemy do Base64.
- `signChallengeWithPrivateKey(...)` – używa klucza prywatnego RSA z PEM i np. `crypto.subtle.sign('RSASSA-PKCS1-v1_5', ...)`, też kodujemy do Base64.
- `finishLogin(...)` – helper woła `fetch('/api/login/finish', ...)`.
- `localStorage.setItem('danaidToken', ...)` – zapis tokena sesyjnego; potem inne pliki (np. `chat.js`) dodają go jako `Authorization: Bearer <token>`.

### 2.2. Helper: `startLogin`

```js
async function startLogin({ username }) {
  const response = await fetch('/api/login/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Błąd /api/login/start');
  }

  return data; // { saltB64, iterations, derivedKeyLength, hashAlg, challenge, challengeId, ... }
}
```

- Wysyłamy **tylko username** – hasła jeszcze nie ma, bo najpierw trzeba pobrać sól/iteracje i challenge.

### 2.3. Helper: `finishLogin`

```js
async function finishLogin({ username, challengeId, derivedKeyB64, challengeSignatureB64 }) {
  const response = await fetch('/api/login/finish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      challengeId,
      derivedKeyB64,
      challengeSignatureB64,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Błąd /api/login/finish');
  }

  return data; // np. { token }
}
```

- Tutaj faktycznie przekazujemy dowód: `derivedKeyB64` (hasło po PBKDF2) i podpis challenge.

---

## 3. Backend — router logowania `backend/routes/login.js`

### 3.1. Krok 1: `POST /api/login/start`

```js
// ŚCIEŻKA: backend/routes/login.js

const express = require('express');
const router = express.Router();

const { findUserRecord } = require('../utils/fileUtils');
const { createLoginChallenge } = require('../utils/security');

// POST /api/login/start
router.post('/login/start', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ message: 'Brak nazwy użytkownika.' });
    }

    const userRecord = await findUserRecord(username);
    if (!userRecord) {
      return res.status(404).json({ message: 'Użytkownik nie istnieje.' });
    }

    // Z userRecord bierzemy: salt, iterations, derivedKeyLength, hashAlg
    const challengeData = await createLoginChallenge(userRecord);

    res.status(200).json(challengeData);
  } catch (error) {
    console.error('Login /start error:', error);
    res.status(500).json({ message: 'Błąd serwera podczas login/start.' });
  }
});
```

**Komentarz:**

- `findUserRecord(username)` – helper, który czyta JSON użytkownika z `backend/db/users/<username>.json`.
- `createLoginChallenge(userRecord)` – buduje strukturę:
  - PBKDF2 parametry (`saltB64`, `iterations`, `derivedKeyLength`, `hashAlg`),
  - `challenge` (losowy string/Buffer → Base64),
  - `challengeId` (ID do powiązania w pamięci/tymczasowym storage).

### 3.2. Krok 2: `POST /api/login/finish`

```js
const { verifyLogin } = require('../utils/security');

// POST /api/login/finish
router.post('/login/finish', async (req, res) => {
  try {
    const { username, challengeId, derivedKeyB64, challengeSignatureB64 } = req.body;

    if (!username || !challengeId || !derivedKeyB64 || !challengeSignatureB64) {
      return res.status(400).json({ message: 'Brak wymaganych pól.' });
    }

    const verification = await verifyLogin({
      username,
      challengeId,
      derivedKeyB64,
      challengeSignatureB64,
    });

    if (!verification.ok) {
      return res.status(401).json({ message: verification.message || 'Nieudane logowanie.' });
    }

    // Tutaj tworzymy token sesji (np. JWT)
    const token = verification.token; // w DEV zazwyczaj generowany w verifyLogin

    res.status(200).json({
      message: 'Zalogowano.',
      token,
    });
  } catch (error) {
    console.error('Login /finish error:', error);
    res.status(500).json({ message: 'Błąd serwera podczas login/finish.' });
  }
});

module.exports = router;
```

- `verifyLogin(...)` robi całą robotę: sprawdza challenge, derivedKey i podpis.

---

## 4. Backend — logika bezpieczeństwa logowania `backend/utils/security.js`

### 4.1. Tworzenie challenge i weryfikacja logowania

```js
// ŚCIEŻKA: backend/utils/security.js

const crypto = require('crypto');

const loginChallenges = new Map(); // DEV: w pamięci procesu

function createLoginChallenge(userRecord) {
  const challengeBytes = crypto.randomBytes(32);
  const challenge = challengeBytes.toString('base64');

  const challengeId = crypto.randomUUID();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minut

  loginChallenges.set(challengeId, {
    username: userRecord.username,
    challenge,
    expiresAt,
  });

  return {
    username: userRecord.username,
    saltB64: userRecord.salt,
    iterations: userRecord.iterations,
    derivedKeyLength: userRecord.derivedKeyLength,
    hashAlg: userRecord.hashAlg,
    challenge,
    challengeId,
  };
}

async function verifyLogin({ username, challengeId, derivedKeyB64, challengeSignatureB64 }) {
  const challengeEntry = loginChallenges.get(challengeId);

  if (!challengeEntry || challengeEntry.username !== username) {
    return { ok: false, message: 'Nieprawidłowy challenge.' };
  }

  if (challengeEntry.expiresAt < Date.now()) {
    loginChallenges.delete(challengeId);
    return { ok: false, message: 'Challenge wygasł.' };
  }

  loginChallenges.delete(challengeId); // jednorazowe użycie

  // Wczytanie rekordu użytkownika
  const userRecord = await findUserRecord(username); // import z fileUtils w prawdziwym kodzie
  if (!userRecord) {
    return { ok: false, message: 'Użytkownik nie istnieje.' };
  }

  // 1) Sprawdzenie derivedKeyB64 (PBKDF2) vs zapisany passwordHash
  const storedDerivedKeyB64 = userRecord.passwordHash;

  const okPassword = timingSafeCompareB64(derivedKeyB64, storedDerivedKeyB64);
  if (!okPassword) {
    return { ok: false, message: 'Błędne hasło.' };
  }

  // 2) Weryfikacja podpisu challenge kluczem publicznym użytkownika
  const okSignature = verifyChallengeSignature(
    userRecord.publicKeyPem,
    challengeEntry.challenge,
    challengeSignatureB64,
  );

  if (!okSignature) {
    return { ok: false, message: 'Nieprawidłowy podpis challenge.' };
  }

  // 3) Jeśli oba testy przeszły, wydaj token sesji (w DEV prosty JWT)
  const token = createJwtForUser(username);

  return { ok: true, token };
}
```

**Najważniejsze idee:**

- `loginChallenges` jako `Map` w pamięci — w DEV wystarczy, w PROD trzeba by przenieść do jakiegoś store (np. Redis / plik z TTL).
- Challenge ma `expiresAt` – po czasie odrzucamy.
- PBKDF2 jest liczone **po stronie klienta**, a serwer tylko porównuje `derivedKeyB64` z tym z rejestracji.
- Podpis challenge zapewnia, że klient faktycznie ma klucz prywatny powiązany z kontem.

Helpery typu `timingSafeCompareB64`, `verifyChallengeSignature`, `createJwtForUser` są w prawdziwym projekcie opisane szerzej (m.in. JWT_SECRET, algorytm RSA/HS256 itd.).

---

## 5. Podsumowanie warstwy logowania (DEV)

- **HTML (`login.html`)**  
  - Formularz z loginem, hasłem i uploadem PEM.
- **Frontend (`login.js`)**  
  - Odczytuje dane użytkownika + plik PEM.  
  - Wywołuje `/api/login/start`, liczy PBKDF2, podpisuje challenge, wywołuje `/api/login/finish`.  
  - Zapisuje token i przełącza widok na czat.
- **Backend (`routes/login.js`)**  
  - Start: czyta usera, tworzy challenge + zwraca parametry PBKDF2.  
  - Finish: weryfikuje challenge, hasło (derivedKey) i podpis, zwraca token.
- **Security (`utils/security.js`)**  
  - Przechowuje challenge w pamięci, dba o TTL, weryfikuje podpis i hasło.

Ta warstwa to fundament pod późniejsze twarde zabezpieczenia PROD (pinning klucza serwera, rotacja kluczy, lepszy storage challenge, pełne logowanie z audytem itd.).

