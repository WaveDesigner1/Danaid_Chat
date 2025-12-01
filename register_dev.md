# Danaid Chat — Warstwa rejestracji (DEV)

> **Cel tego pliku**: zrozumieć **data flow rejestracji** w wersji DEV — od formularza w HTML, przez JS na froncie, aż po backend (Express, utils, zapis do JSON). Każdy krok mówi **jaki plik**, **jaki fragment kodu** i **co dokładnie robi**.

---

## 0. Ogólny przepływ danych (routing warstwy rejestracji)

1. **Użytkownik otwiera stronę z formularzem rejestracji**  
   → plik: `frontend/register.html`  
   → HTML rysuje zakładkę / sekcję rejestracji.

2. **Użytkownik wypełnia formularz i klika „Zarejestruj”**  
   → plik: `frontend/js/register.js`  
   → JS łapie `submit`, generuje parę kluczy, przygotowuje payload do backendu.

3. **Frontend wysyła `fetch` na backend**  
   → adres np. `POST /api/register`  
   → pliki: `frontend/js/register.js` (fetch) ↔ `backend/routes/register.js` (Express router).

4. **Backend: walidacja, bezpieczeństwo, zapis pliku użytkownika**  
   → pliki: `backend/routes/register.js`, `backend/utils/security.js`, `backend/utils/fileUtils.js`.  
   → Tworzony jest rekord użytkownika i zapisywany w JSON (np. `data/users/<username>.json`).

5. **Backend zwraca odpowiedź JSON**  
   → `register.js` na froncie odczytuje wynik i pokazuje komunikat / przekierowuje.

Poniżej rozbijamy to na konkretne pliki i fragmenty kodu.

---

## 1. Widok rejestracji — `frontend/register.html`

### 1.1. Fragment: formularz rejestracji

```html
<!-- ŚCIEŻKA: frontend/register.html -->
<!-- Główna sekcja formularza rejestracji -->
<section id="register-section" class="form-section">
  <!-- Nagłówek sekcji / tytuł -->
  <h2 class="form-title">Rejestracja</h2>

  <!-- Formularz rejestracji; id będzie użyte w JS -->
  <form id="register-form">
    <!-- Pole nazwy użytkownika -->
    <label for="register-username" class="form-label">Nazwa użytkownika</label>
    <input
      type="text"
      id="register-username"
      name="username"
      class="form-input"
      autocomplete="username"
      required
    />

    <!-- Pole hasła -->
    <label for="register-password" class="form-label">Hasło</label>
    <input
      type="password"
      id="register-password"
      name="password"
      class="form-input"
      autocomplete="new-password"
      required
    />

    <!-- Upload / generowanie klucza prywatnego (opcjonalnie) -->
    <label for="register-private-key" class="form-label">
      Klucz prywatny (PEM)
    </label>
    <input
      type="file"
      id="register-private-key"
      class="form-input"
      accept=".pem"
    />

    <!-- Miejsce na komunikaty błędu / sukcesu -->
    <p id="register-message" class="form-message"></p>

    <!-- Przycisk wysłania formularza -->
    <button type="submit" class="btn primary-btn">
      Zarejestruj
    </button>
  </form>
</section>
```

**Komentarz linia po linii (co tu się dzieje):**

- `section id="register-section" class="form-section">`  
  Sekcja ekranu odpowiedzialna za rejestrację. `id` może być używane przez JS lub CSS do pokazywania/ukrywania całej sekcji. Klasa `form-section` to styl (layout, odstępy).

- `h2 class="form-title">Rejestracja</h2>`  
  Zwykły nagłówek. Klasa `form-title` odpowiada za wygląd (np. font, marginesy).

- `<form id="register-form">`  
  Element formularza. `id="register-form"` jest kluczowy — w JS robimy `document.getElementById('register-form')` i podpinamy `submit`.

- `<label for="register-username" ...>` + `<input id="register-username" ...>`  
  `for` w labelce wskazuje na `id` inputa. Dzięki temu kliknięcie w label ustawia focus na input.  
  `name="username"` ustawia nazwę parametru — przy klasycznym wysyłaniu form, ale też czasem przy `FormData` w JS.

- `class="form-input"` / `class="form-label"` / `class="btn primary-btn"`  
  To hooki dla CSS.  
  W CSS możesz mieć np.:  
  ```css
  .form-input { padding: 0.5rem; border-radius: 4px; }
  .primary-btn { background: var(--accent); color: white; }
  ```

- Input `type="password"`  
  Ukrywa wpisywane znaki, przeglądarka traktuje to jako pole hasła.

- `required`  
  Walidacja po stronie przeglądarki: nie da się wysłać formularza, jeśli pole jest puste.

- Input `type="file"` z `accept=".pem"`  
  Pozwala wybrać plik z dysku; `accept` ogranicza widok wyboru do plików `.pem`. Ten input można wykorzystać do wczytania klucza prywatnego użytkownika.

- `<p id="register-message" class="form-message"></p>`  
  Pusty paragraf, w który JS będzie wstawiał tekst (np. "Użytkownik zajęty", "Rejestracja OK").

- `<button type="submit">`  
  Kliknięcie tego przycisku powoduje zdarzenie `submit` na formularzu. Nie robimy `onclick` w HTML, bo logikę trzymamy w JS.

---

## 2. Logika frontendu — `frontend/js/register.js`

### 2.1. Podstawowy setup: pobranie elementów / podpięcie eventu

```js
// ŚCIEŻKA: frontend/js/register.js

// Szukamy formularza rejestracji po id z HTML
const registerForm = document.getElementById('register-form');

// Szukamy elementu na komunikaty (sukces/błąd)
const registerMessage = document.getElementById('register-message');

// Podpinamy się pod event 'submit' formularza
registerForm.addEventListener('submit', async (event) => {
  // Blokujemy domyślne odświeżenie strony po submit
  event.preventDefault();

  try {
    // Wyciągamy wartości wpisane w inputach
    const usernameInput = document.getElementById('register-username');
    const passwordInput = document.getElementById('register-password');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    // Prosta walidacja po stronie klienta
    if (!username || !password) {
      registerMessage.textContent = 'Podaj nazwę użytkownika i hasło.';
      registerMessage.classList.add('error');
      return;
    }

    // Tutaj (w DEV) możesz: wygenerować parę kluczy lub odczytać PEM z pliku
    // Upraszczamy do placeholdera – w realnym kodzie korzystasz z WebCrypto lub biblioteki.
    const { publicKeyPem, privateKeyPem } = await generateKeyPairForUser();

    // Przygotowanie payloadu do backendu
    const payload = {
      username,
      password,
      publicKeyPem,
    };

    // Wywołanie endpointu rejestracji na backendzie
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      // Backend zwrócił błąd – pokazujemy komunikat z serwera, jeśli jest
      registerMessage.textContent = result.message || 'Błąd rejestracji.';
      registerMessage.classList.add('error');
      return;
    }

    // Sukces – w DEV np. zapisujemy klucz prywatny lokalnie
    await savePrivateKeyLocally(privateKeyPem, username);

    registerMessage.textContent = 'Rejestracja zakończona powodzeniem!';
    registerMessage.classList.remove('error');
    registerMessage.classList.add('success');

    // Opcjonalnie: przekierowanie na ekran logowania
    // window.location.href = '/login.html';
  } catch (error) {
    console.error('Register error:', error);
    registerMessage.textContent = 'Nieoczekiwany błąd po stronie klienta.';
    registerMessage.classList.add('error');
  }
});
```

**Komentarz po kolei:**

- `const registerForm = document.getElementById('register-form');`  
  Pobieramy referencję do formularza z DOM. `const` oznacza, że nie podmienimy referencji, ale sam obiekt formularza w DOM jest mutowalny (np. zmiana klas, wartości itd.).

- `const registerMessage = document.getElementById('register-message');`  
  Drugi ważny element: miejsce na komunikaty. JS będzie zmieniał jego `textContent` i klasy.

- `registerForm.addEventListener('submit', async (event) => { ... });`  
  Dodajemy listener na event `submit`. Funkcja jest `async`, bo w środku używamy `await` (fetch, generowanie kluczy).

- `event.preventDefault();`  
  Domyślnie formularz wysyła POST i przeładowuje stronę. My obsługujemy wszystko ręcznie w JS, więc blokujemy ten mechanizm.

- Pobranie inputów i wartości (`usernameInput.value.trim()`, `passwordInput.value`)  
  `trim()` usuwa spacje na początku/końcu nazwy użytkownika, żeby nie było głupich błędów w stylu "admin " vs "admin".

- Prosta walidacja:  
  Jeśli brakuje username albo password, od razu pokazujemy błąd i `return` — funkcja kończy się, nie lecimy dalej.

- `generateKeyPairForUser()`  
  To helper (musisz mieć go zdefiniowanego w tym lub innym pliku).  
  W praktyce użyjesz `window.crypto.subtle.generateKey(...)` i później `exportKey('spki'/'pkcs8')` + konwersja do PEM.  
  `publicKeyPem` jest wysyłany do backendu, `privateKeyPem` zostaje lokalnie.

- `const payload = { username, password, publicKeyPem };`  
  Tworzymy zwykły obiekt JS. W JSON zamieni się na `{ "username": "...", "password": "...", "publicKeyPem": "-----BEGIN PUBLIC KEY..." }`.

- `fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })`  
  - `fetch` → API przeglądarki do robienia zapytań HTTP.  
  - `method: 'POST'` → wysyłamy POST.  
  - `headers` → mówimy backendowi, że body jest w formacie JSON.  
  - `body: JSON.stringify(payload)` → konwertujemy obiekt JS na string JSON.

- `const result = await response.json();`  
  Odczytujemy body odpowiedzi jako JSON. To jest kolejne `await` (zwraca Promise).

- `if (!response.ok) { ... }`  
  `response.ok` to skrót: `status` w zakresie 200–299. Jeśli nie, traktujemy to jako błąd i pokazujemy wiadomość z backendu (`result.message`).

- `await savePrivateKeyLocally(privateKeyPem, username);`  
  Abstrakcja na zapis klucza po stronie użytkownika (IndexedDB, localStorage, pobranie pliku itd.). Dzięki temu backend nie widzi klucza prywatnego.

- Blok `try/catch`  
  Standardowy pattern w async funkcjach: jeśli `fetch` rzuci błąd (np. brak połączenia) albo inne `await` się wywali, lądujemy w `catch` i mamy ładny komunikat.

---

## 3. Routing backendu — `backend/server.js`

### 3.1. Podpięcie routera rejestracji w Express

```js
// ŚCIEŻKA: backend/server.js

const express = require('express');            // Import biblioteki Express (framework HTTP dla Node.js)
const path = require('path');                  // Wbudowany moduł Node do pracy ze ścieżkami plików

// Import routera rejestracji
const registerRouter = require('./routes/register');

const app = express();                         // Tworzymy instancję aplikacji Express

// Middleware do parsowania JSON z body
app.use(express.json());                       // Dzięki temu req.body dla JSON nie jest undefined

// Serwowanie plików statycznych (frontend)
app.use(express.static(path.join(__dirname, '../frontend')));

// Podpięcie routera pod prefiks /api
app.use('/api', registerRouter);

// Start serwera HTTP
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Danaid DEV backend listening on http://localhost:${PORT}`);
});
```

**Komentarze:**

- `const express = require('express');`  
  W CommonJS (`require`) importujemy bibliotekę Express z `node_modules`. Express ułatwia tworzenie serwerów HTTP.

- `const registerRouter = require('./routes/register');`  
  Wciągamy moduł z `backend/routes/register.js`. To będzie `express.Router()` z endpointem `/register`.

- `app.use(express.json());`  
  Middleware, który per-request odczytuje body, jeśli `Content-Type: application/json`, i dekoduje do JS-owego obiektu `req.body`.

- `app.use(express.static(...))`  
  Wszystkie pliki z katalogu `frontend` będą dostępne po HTTP (np. `/register.html`).

- `app.use('/api', registerRouter);`  
  Mówimy: "użyj routera z `routes/register.js` pod ścieżką `/api`".  
  Jeżeli w routerze mamy `router.post('/register', ...)`, to pełny URL to `/api/register`.

- `app.listen(PORT, ...)`  
  Uruchamia serwer. Nasłuchuje na porcie 3000 (albo innym z env).

---

## 4. Logika backendu — `backend/routes/register.js`

### 4.1. Endpoint POST `/api/register`

```js
// ŚCIEŻKA: backend/routes/register.js

const express = require('express');
const router = express.Router();

const { createUserRecord } = require('../utils/security');
const { userExists, saveUserRecord } = require('../utils/fileUtils');

// POST /api/register
router.post('/register', async (req, res) => {
  try {
    const { username, password, publicKeyPem } = req.body;

    // Prosta walidacja wejścia
    if (!username || !password || !publicKeyPem) {
      return res.status(400).json({ message: 'Brak wymaganych pól.' });
    }

    // Sprawdzenie, czy użytkownik już istnieje
    const exists = await userExists(username);
    if (exists) {
      return res.status(409).json({ message: 'Użytkownik już istnieje.' });
    }

    // Tworzymy bezpieczny rekord użytkownika (hash hasła, podpis serwera itd.)
    const userRecord = await createUserRecord({ username, password, publicKeyPem });

    // Zapis do pliku JSON (np. backend/db/users/<username>.json)
    await saveUserRecord(userRecord);

    // Zwracamy ok – ale bez wrażliwych danych (np. hash hasła)
    res.status(201).json({ message: 'Utworzono użytkownika.', username });
  } catch (error) {
    console.error('Register route error:', error);
    res.status(500).json({ message: 'Błąd serwera podczas rejestracji.' });
  }
});

module.exports = router;
```

**Komentarz:**

- `const router = express.Router();`  
  Tworzymy "mini-apkę" Express. Do niej przypinamy endpointy (`router.post(...)`). Później w `server.js` podpinamy to pod `/api`.

- `router.post('/register', async (req, res) => { ... })`  
  Definiujemy handler dla `POST /api/register`.  
  `req` → request (żądanie od klienta), `res` → response (odpowiedź serwera).

- `const { username, password, publicKeyPem } = req.body;`  
  Destrukturyzacja — wyciągamy konkretne pola z body. To jest zwykły obiekt JS.

- Walidacja:  
  Jeśli brakuje któregoś z pól, zwracamy `400 Bad Request`. To jest klasyczny pattern API.

- `const exists = await userExists(username);`  
  Helper z `fileUtils`. Prawdopodobnie sprawdza, czy istnieje plik `users/<username>.json` albo wpis w `users_list.json`.

- `409 Conflict`  
  Status używany przy próbie stworzenia zasobu, który już istnieje.

- `createUserRecord({...})`  
  Cała magia bezpieczeństwa idzie do osobnego modułu (`security.js`): hashowanie hasła, generowanie soli, podpis serwera itd. Dzięki temu router jest "cienki".

- `saveUserRecord(userRecord);`  
  Druga abstrakcja: plikowe I/O wyniesione do `fileUtils.js`.

- `res.status(201).json({ ... })`  
  `201 Created` to standard dla pomyślnego stworzenia zasobu.

---

## 5. Bezpieczeństwo — `backend/utils/security.js`

### 5.1. Tworzenie rekordu użytkownika: `createUserRecord`

```js
// ŚCIEŻKA: backend/utils/security.js

const crypto = require('crypto');

// Długość soli w bajtach
const SALT_LENGTH = 16;
// Ile rund PBKDF2 – w DEV może być mniejsze, w PROD większe
const PBKDF2_ITERATIONS = 100_000;
// Długość zakodowanego klucza pochodnego
const DERIVED_KEY_LENGTH = 32;
// Algorytm mieszający
const HASH_ALG = 'sha256';

// Klucz serwera do podpisu rekordów (prosty przykład – w PROD trzymasz w .env)
const SERVER_SECRET = process.env.SERVER_SECRET || 'dev-server-secret';

/**
 * Tworzy rekord użytkownika do zapisania w JSON.
 * - Hashuje hasło PBKDF2
 * - Dodaje publiczny klucz użytkownika
 * - Dodaje podpis serwera (serverSignature) nad rekordem
 */
async function createUserRecord({ username, password, publicKeyPem }) {
  const salt = crypto.randomBytes(SALT_LENGTH);               // losowa sól

  // PBKDF2: z hasła i soli generujemy derivedKey
  const derivedKey = await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, DERIVED_KEY_LENGTH, HASH_ALG);

  const passwordHash = derivedKey.toString('base64');         // zapisujemy jako Base64
  const saltB64 = salt.toString('base64');

  // Składamy "nagie" dane użytkownika
  const userCore = {
    username,
    passwordHash,
    salt: saltB64,
    iterations: PBKDF2_ITERATIONS,
    derivedKeyLength: DERIVED_KEY_LENGTH,
    hashAlg: HASH_ALG,
    publicKeyPem,
  };

  // Podpis serwera nad tym, co ważne
  const serverSignature = signUserRecord(userCore);

  return {
    ...userCore,
    serverSignature,
  };
}

// Helper: obietnicowa wersja PBKDF2
function pbkdf2Async(password, salt, iterations, keyLen, digest) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keyLen, digest, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

// Tworzy HMAC nad rekordem użytkownika
function signUserRecord(userCore) {
  const hmac = crypto.createHmac('sha256', SERVER_SECRET);
  // Uważamy, żeby zawsze serializować w takiej samej kolejności
  const payload = JSON.stringify(userCore);
  hmac.update(payload);
  return hmac.digest('base64');
}

module.exports = {
  createUserRecord,
};
```

**Komentarz:**

- `const crypto = require('crypto');`  
  Import wbudowanego modułu Node z funkcjami kryptograficznymi.

- Parametry PBKDF2 (`SALT_LENGTH`, `PBKDF2_ITERATIONS` itd.)  
  Zebrane na górze, żebyś mógł łatwo zmieniać.  
  W PROD będziesz chciał więcej iteracji / Argon2.

- `createUserRecord({ username, password, publicKeyPem })`  
  Funkcja przyjmuje "nagie" dane z routera i zwraca gotowy obiekt do zapisania w JSON.

- `crypto.randomBytes(SALT_LENGTH);`  
  Losowa sól, kryptograficznie bezpieczna.

- `pbkdf2Async(...)`  
  Owijamy `crypto.pbkdf2` w Promise, żeby wygodnie używać `await`.

- `passwordHash = derivedKey.toString('base64')`  
  DerivedKey to `Buffer` (bajty). W JSON przechowujemy Base64.

- `userCore`  
  Zawiera wszystkie dane potrzebne do weryfikacji logowania: hash, sól, iteracje, algorytm oraz publiczny klucz.

- `signUserRecord(userCore)`  
  Tworzy HMAC (podpis serwera) nad serializowanym `userCore`. Dzięki temu przy logowaniu możesz sprawdzić, czy rekord nie był ręcznie edytowany (np. w pliku JSON).

- `const payload = JSON.stringify(userCore);`  
  Kolejność kluczy w JS w praktyce jest deterministyczna przy tworzeniu obiektu literalem, więc JSON.stringify da powtarzalny string.

- `crypto.createHmac('sha256', SERVER_SECRET)`  
  Tworzy HMAC-SHA256 z tajnym kluczem serwera.

---

## 6. Operacje na plikach — `backend/utils/fileUtils.js`

### 6.1. Sprawdzanie istnienia użytkownika i zapis rekordu

```js
// ŚCIEŻKA: backend/utils/fileUtils.js

const fs = require('fs/promises');
const path = require('path');

const USERS_DIR = path.join(__dirname, '../db/users');

// Sprawdza, czy użytkownik istnieje po nazwie (np. czy plik <username>.json jest w katalogu)
async function userExists(username) {
  try {
    const userPath = path.join(USERS_DIR, `${username}.json`);
    await fs.access(userPath);               // Jeśli plik istnieje, nie rzuci błędu
    return true;
  } catch {
    return false;                            // Brak pliku → użytkownik nie istnieje
  }
}

// Zapisuje rekord użytkownika do pliku JSON
async function saveUserRecord(userRecord) {
  const userPath = path.join(USERS_DIR, `${userRecord.username}.json`);

  // Upewniamy się, że katalog istnieje
  await fs.mkdir(USERS_DIR, { recursive: true });

  const json = JSON.stringify(userRecord, null, 2);  // pretty JSON dla łatwiejszego debugowania

  await fs.writeFile(userPath, json, 'utf-8');
}

module.exports = {
  userExists,
  saveUserRecord,
};
```

**Komentarz:**

- `fs = require('fs/promises')`  
  Wersja modułu `fs`, która wspiera Promisy (`await fs.readFile(...)`).

- `USERS_DIR`  
  Zostawiamy jedną stałą z katalogiem użytkowników; dzięki temu łatwo zmienić strukturę w przyszłości.

- `userExists(username)`  
  Zwykle działa na zasadzie "spróbuj otworzyć plik" – jeśli `fs.access` rzuci błąd (brak pliku), łapiemy i zwracamy `false`.

- `saveUserRecord(userRecord)`  
  Budujemy ścieżkę na podstawie `userRecord.username`.  
  `fs.mkdir(..., { recursive: true })` tworzy katalog, jeśli go nie ma (bez błędu, jeśli już jest).  
  `JSON.stringify(..., null, 2)` formatuje JSON z wcięciami (2 spacje) — przyjemne do czytania w edytorze.

---

## 7. Podsumowanie warstwy rejestracji (DEV)

- **HTML (`register.html`)**  
  Rysuje formularz i nadaje elementom `id`/`class`, które są hookami dla JS i CSS.

- **JS frontend (`register.js`)**  
  - Łapie event `submit`, blokuje domyślny mechanizm.  
  - Czyta wartości pól, robi walidację.  
  - Generuje (lub wczytuje) parę kluczy.  
  - Składa payload i wysyła `fetch` do `/api/register`.  
  - Obsługuje odpowiedź (błąd / sukces), zapisuje prywatny klucz lokalnie.

- **Express (`server.js` + `routes/register.js`)**  
  - `server.js` montuje router pod `/api`.  
  - `register.js` odbiera POST, sprawdza dane, pyta `fileUtils` czy user istnieje, woła `security.createUserRecord` i zapisuje dane.

- **Bezpieczeństwo (`security.js`)**  
  - Hashuje hasło PBKDF2 (sól, iteracje, długość klucza).  
  - Dodaje publiczny klucz do rekordu.  
  - Dodaje `serverSignature` nad rekordem (HMAC z tajnym kluczem serwera).

- **Pliki (`fileUtils.js`)**  
  - Odpowiadają za fizyczny zapis do JSON i sprawdzanie istnienia użytkownika.

To jest punkt startowy pod późniejsze przejście z **DEV** na **PROD**:
- zmiana parametrów PBKDF2 / migracja do Argon2,
- lepsza struktura plików (osobne inboxy, conversations),
- wpięcie pełnego E2EE (rootKey z X3DH / Double Ratchet),
- twardsza walidacja wejścia i obsługa błędów.

