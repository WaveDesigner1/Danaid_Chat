# Danaid Chat — Warstwa dodawania znajomych (DEV)

> **Cel:** ogarnąć **data flow "Dodaj znajomego"** w wersji DEV — od przycisku w UI, przez JS, aż po backend, który aktualizuje pliki użytkowników.

---

## 0. Ogólny przepływ danych (routing dodawania znajomych)

1. **Użytkownik jest zalogowany i ma token**  
   → token zapisany np. w `localStorage` przez logowanie (`danaidToken`).

2. **W widoku czatu wpisuje nazwę znajomego i klika "Dodaj"**  
   → plik: `frontend/chat.html` (sekcja Friends / Dodaj znajomego).

3. **Frontend wysyła żądanie do backendu z tokenem i nazwą znajomego**  
   → plik: `frontend/js/chat.js` lub `frontend/js/friends.js` (handler dodawania znajomego, `fetch('/api/friends/add', ...)`).

4. **Backend uwierzytelnia token, sprawdza poprawność danych i aktualizuje oba konta**  
   → plik: `backend/middleware/auth.js` (dekodowanie JWT)  
   → plik: `backend/routes/friends.js` (logika dodawania)  
   → plik: `backend/utils/fileUtils.js` (odczyt/zapis JSON użytkowników).

5. **Frontend aktualizuje listę znajomych w UI**  
   → plik: `frontend/js/chat.js` (np. `renderFriendsList(...)`).

---

## 1. UI dodawania znajomych — `frontend/chat.html`

### 1.1. Panel znajomych + formularz "Dodaj znajomego"

```html
<!-- ŚCIEŻKA: frontend/chat.html -->
<aside id="friends-panel" class="friends-panel">
  <h2 class="panel-title">Znajomi</h2>

  <!-- Lista znajomych renderowana z JS -->
  <ul id="friends-list" class="friends-list"></ul>

  <!-- Formularz dodawania znajomego -->
  <form id="add-friend-form" class="add-friend-form">
    <label for="add-friend-username" class="form-label">Dodaj znajomego</label>
    <input
      type="text"
      id="add-friend-username"
      name="friendUsername"
      class="form-input"
      placeholder="Nazwa użytkownika"
      required
    />
    <button type="submit" class="btn secondary-btn">Dodaj</button>
  </form>

  <p id="friends-message" class="form-message"></p>
</aside>
```

**Co ważne:**

- `id="friends-list"` – miejsce, gdzie JS wrzuca `<li>` z każdym znajomym.
- `id="add-friend-form"` – łapiemy `submit` w JS.
- `name="friendUsername"` + `id="add-friend-username"` – identyfikacja pola z nazwą znajomego.
- `id="friends-message"` – komunikaty dla akcji na znajomych (sukces/błąd).

---

## 2. Frontend — obsługa dodawania znajomych `frontend/js/chat.js`

### 2.1. Podpięcie eventu `submit`

```js
// ŚCIEŻKA: frontend/js/chat.js

const addFriendForm = document.getElementById('add-friend-form');
const addFriendInput = document.getElementById('add-friend-username');
const friendsMessage = document.getElementById('friends-message');

addFriendForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  friendsMessage.textContent = '';
  friendsMessage.className = 'form-message';

  const friendUsername = addFriendInput.value.trim();

  if (!friendUsername) {
    friendsMessage.textContent = 'Podaj nazwę użytkownika.';
    friendsMessage.classList.add('error');
    return;
  }

  try {
    const token = window.localStorage.getItem('danaidToken');
    if (!token) {
      friendsMessage.textContent = 'Brak tokena logowania. Zaloguj się ponownie.';
      friendsMessage.classList.add('error');
      return;
    }

    const response = await fetch('/api/friends/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ friendUsername }),
    });

    const result = await response.json();

    if (!response.ok) {
      friendsMessage.textContent = result.message || 'Nie udało się dodać znajomego.';
      friendsMessage.classList.add('error');
      return;
    }

    friendsMessage.textContent = 'Dodano znajomego.';
    friendsMessage.classList.add('success');

    // Odśwież listę znajomych z serwera
    await loadFriendsList();

    addFriendInput.value = '';
  } catch (error) {
    console.error('Add friend error:', error);
    friendsMessage.textContent = 'Błąd po stronie klienta.';
    friendsMessage.classList.add('error');
  }
});
```

**Najważniejsze punkty:**

- Token JWT jest czytany z `localStorage`.  
- `Authorization: Bearer <token>` – klasyczny nagłówek do autoryzacji.
- `loadFriendsList()` – helper, który strzela do endpointu `/api/friends/list` (albo `/api/friends`) i renderuje `<li>` w `#friends-list`.

---

## 3. Middleware auth — `backend/middleware/auth.js`

Dodawanie znajomych jest akcją zaufaną, więc backend musi wiedzieć, **kim jest zalogowany user**.

```js
// ŚCIEŻKA: backend/middleware/auth.js

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Brak nagłówka Authorization.' });
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    req.user = {
      username: payload.username,
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ message: 'Nieprawidłowy lub wygasły token.' });
  }
}

module.exports = authMiddleware;
```

**Co tu się dzieje:**

- `jwt.verify` sprawdza sygnaturę i ważność tokena.  
- Po weryfikacji `req.user.username` jest dostępny w każdym routerze.

---

## 4. Backend — router znajomych `backend/routes/friends.js`

### 4.1. Endpoint `POST /api/friends/add`

```js
// ŚCIEŻKA: backend/routes/friends.js

const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const { findUserRecord, saveUserRecord } = require('../utils/fileUtils');

// Wszystkie ścieżki w tym routerze wymagają auth
router.use(auth);

// POST /api/friends/add
router.post('/friends/add', async (req, res) => {
  try {
    const currentUsername = req.user.username; // z auth
    const { friendUsername } = req.body;

    if (!friendUsername) {
      return res.status(400).json({ message: 'Brak nazwy znajomego.' });
    }

    if (friendUsername === currentUsername) {
      return res.status(400).json({ message: 'Nie możesz dodać samego siebie.' });
    }

    const currentUser = await findUserRecord(currentUsername);
    const friendUser = await findUserRecord(friendUsername);

    if (!friendUser) {
      return res.status(404).json({ message: 'Taki użytkownik nie istnieje.' });
    }

    // Inicjalizacja tablic friends jeśli nie istnieje
    currentUser.friends = currentUser.friends || [];
    friendUser.friends = friendUser.friends || [];

    const alreadyFriend = currentUser.friends.some((f) => f.username === friendUsername);
    if (alreadyFriend) {
      return res.status(409).json({ message: 'Użytkownik jest już na liście znajomych.' });
    }

    // W DEV: zapisujemy username i publiczny klucz znajomego (do późniejszego E2EE)
    currentUser.friends.push({
      username: friendUsername,
      publicKeyPem: friendUser.publicKeyPem,
    });

    friendUser.friends.push({
      username: currentUsername,
      publicKeyPem: currentUser.publicKeyPem,
    });

    await saveUserRecord(currentUser);
    await saveUserRecord(friendUser);

    return res.status(200).json({ message: 'Dodano znajomego.' });
  } catch (error) {
    console.error('Friends /add error:', error);
    return res.status(500).json({ message: 'Błąd serwera podczas dodawania znajomego.' });
  }
});

module.exports = router;
```

**Wyjaśnienia:**

- `router.use(auth);` – każdy endpoint poniżej wymaga poprawnego tokena.  
- `findUserRecord(username)` – czyta `backend/db/users/<username>.json`.  
- `friends` jako tablica w pliku użytkownika – DEV struktura, którą później rozszerzamy o fingerprinty, prekey bundle itd.
- Przy dodawaniu **aktualizujemy obie strony** (relacja jest symetryczna): `currentUser` i `friendUser`.

---

## 5. Utils plikowe — `backend/utils/fileUtils.js` (fragment wspólny)

Dodawanie znajomych korzysta z tych samych helperów co rejestracja/logowanie.

```js
// ŚCIEŻKA: backend/utils/fileUtils.js

const fs = require('fs/promises');
const path = require('path');

const USERS_DIR = path.join(__dirname, '../db/users');

async function findUserRecord(username) {
  try {
    const userPath = path.join(USERS_DIR, `${username}.json`);
    const json = await fs.readFile(userPath, 'utf-8');
    return JSON.parse(json);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function saveUserRecord(userRecord) {
  const userPath = path.join(USERS_DIR, `${userRecord.username}.json`);
  await fs.mkdir(USERS_DIR, { recursive: true });
  const json = JSON.stringify(userRecord, null, 2);
  await fs.writeFile(userPath, json, 'utf-8');
}

module.exports = {
  findUserRecord,
  saveUserRecord,
};
```

---

## 6. Podsumowanie warstwy znajomych (DEV)

- **Frontend:**  
  - Formularz w `chat.html` + handler w `chat.js` wysyłający `POST /api/friends/add` z tokenem.  
  - Po sukcesie odświeżenie listy znajomych.
- **Middleware auth:**  
  - Wyciąga `username` z JWT i wrzuca do `req.user`.
- **Router friends:**  
  - Weryfikuje, czy friend istnieje, czy nie jest już na liście, dodaje wpisy dla obu stron, zapisuje JSON.
- **Pliki użytkowników:**  
  - W `userRecord.friends` mamy tablicę obiektów `{ username, publicKeyPem }`, co w kolejnym kroku posłuży do E2EE (prekeys, X3DH itd.).

Ta warstwa jest mostem między **identyfikacją użytkowników** (login/rejestracja) a **warstwą wiadomości** – bez poprawnie zrobionych relacji friends nie ma sensu ruszać Double Ratchet i całego E2EE.

