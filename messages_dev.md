# Danaid Chat — Warstwa wysyłania wiadomości (DEV)

## 0. Routing wiadomości
1. Użytkownik ma token + wybranego znajomego.
2. Pisze wiadomość w `chat.html`.
3. `chat.js` → `sendMessageToFriend` → fetch `/api/messages/send`.
4. Backend: auth → zapis wiadomości → plik konwersacji.
5. Frontend pobiera historię → `loadConversation`.

---

## 1. frontend/chat.html — UI wiadomości
```html
<main id="chat-main" class="chat-main">
  <section id="messages-area" class="messages-area"></section>

  <form id="message-form" class="message-form">
    <input
      type="text"
      id="message-input"
      class="form-input message-input"
      placeholder="Napisz wiadomość..."
      autocomplete="off"
      required
    />
    <button type="submit" id="send-message-btn" class="btn primary-btn">Wyślij</button>
  </form>
</main>
```

---

## 2. frontend/js/chat.js — wysyłanie wiadomości

```js
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messagesArea = document.getElementById('messages-area');
let activeFriendUsername = null;

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text || !activeFriendUsername) return;

  await sendMessageToFriend(activeFriendUsername, text);

  appendMessageToUI({
    from: 'me',
    to: activeFriendUsername,
    content: text,
    direction: 'outgoing',
  });

  messageInput.value = '';
});
```

### 2.1 sendMessageToFriend
```js
async function sendMessageToFriend(friendUsername, text) {
  const token = window.localStorage.getItem('danaidToken');

  const payload = {
    to: friendUsername,
    content: text,
  };

  const response = await fetch('/api/messages/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  return result;
}
```

---

## 3. backend/routes/messages.js — zapis
```js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { appendMessageToConversation } = require('../utils/conversations');

router.use(auth);

router.post('/messages/send', async (req, res) => {
  const fromUsername = req.user.username;
  const { to, content, encryptedPayload } = req.body;

  if (!to || (!content && !encryptedPayload)) {
    return res.status(400).json({ message: 'Brak danych.' });
  }

  const saved = await appendMessageToConversation({
    from: fromUsername,
    to,
    content,
    encryptedPayload,
  });

  res.status(201).json({ message: 'Zapisano', savedMessage: saved });
});

module.exports = router;
```

---

## 4. backend/utils/conversations.js — operacje na plikach

### 4.1 Generowanie ID
```js
function getConversationId(userA, userB) {
  const sorted = [userA, userB].sort();
  return `conv_${sorted[0]}__${sorted[1]}`;
}
```

### 4.2 Dopisanie wiadomości
```js
async function appendMessageToConversation({ from, to, content, encryptedPayload }) {
  const convPath = getConversationPath(from, to);

  await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });

  let conversation = [];
  try {
    const json = await fs.readFile(convPath, 'utf-8');
    conversation = JSON.parse(json);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const message = {
    id: Date.now(),
    from,
    to,
    content: content || null,
    encryptedPayload: encryptedPayload || null,
    timestamp: new Date().toISOString(),
  };

  conversation.push(message);
  await fs.writeFile(convPath, JSON.stringify(conversation, null, 2));
  return message;
}
```

---

## 5. Pobieranie historii

### 5.1 Frontend
```js
async function loadConversation(friend) {
  const token = localStorage.getItem('danaidToken');
  const res = await fetch(`/api/messages/history?friend=${friend}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  renderMessages(data.messages || []);
}
```

### 5.2 Backend
```js
router.get('/messages/history', async (req, res) => {
  const current = req.user.username;
  const friend = req.query.friend;

  const messages = await getConversationMessages(current, friend);
  res.status(200).json({ messages });
});
```

---

## 6. Podsumowanie
- Frontend → wysyła payload (`to`, `content`).
- Backend → zapisuje do pliku konwersacji.
- Historia → czytana z `/api/messages/history`.
- Ten sam flow działa przy E2EE (payload = ciphertext + header + authTag).
