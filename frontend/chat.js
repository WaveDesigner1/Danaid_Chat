// frontend/chat.js
// ======================================================
// GŁÓWNY PLIK LOGIKI CZATU DANAID
// ======================================================

const API_BASE = "/api";

const ENDPOINTS = {
  FRIENDS_LIST: `${API_BASE}/friends/list`,
  FRIENDS_ADD: `${API_BASE}/friends/add`,
  MESSAGES_GET_FOR_FRIEND: (friendUsername) =>
    `${API_BASE}/messages/get/${encodeURIComponent(friendUsername)}`,
  MESSAGE_SEND: `${API_BASE}/messages/send`,
  MESSAGE_CLEAR: `${API_BASE}/messages/clear`,
};

// =============================
// SESJA / JWT
// =============================

function getToken() {
  return localStorage.getItem("danaid_jwt") || null;
}

function getUsername() {
  return localStorage.getItem("danaid_username") || null;
}

function authHeaders() {
  const token = getToken();
  if (!token)
    return {
      "Content-Type": "application/json",
    };

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// =============================
// WYLOGOWANIE
// =============================

function logout() {
  try {
    localStorage.removeItem("danaid_username");
    localStorage.removeItem("danaid_jwt");
  } catch (err) {
    console.error("[CHAT] Błąd czyszczenia sesji przy wylogowaniu:", err);
  }

  window.location.href = "login.html";
}

// =============================
// STATUS ONLINE/OFFLINE
// =============================

function setConnectionStatusOnline() {
  const dot = document.getElementById("connection-status-dot");
  const text = document.getElementById("connection-status-text");

  if (dot) {
    dot.classList.remove("offline");
    dot.classList.add("online");
  }
  if (text) {
    text.textContent = "Online";
  }
}

function setConnectionStatusOffline() {
  const dot = document.getElementById("connection-status-dot");
  const text = document.getElementById("connection-status-text");

  if (dot) {
    dot.classList.remove("online");
    dot.classList.add("offline");
  }
  if (text) {
    text.textContent = "Offline";
  }
}

// =============================
// DEBUG CONSOLE (resztą zajmuje się console.js)
// =============================

function initDebugConsole() {
  const dbg = document.getElementById("debug-console");
  const logArea = document.getElementById("debug-console-log");

  if (!dbg || !logArea) {
    console.warn(
      "[DEBUG-CONSOLE] Brak elementów #debug-console lub #debug-console-log. Debug console nieaktywna."
    );
    return;
  }

  console.log("[DEBUG-CONSOLE] Konsola debug jest dostępna.");
}

// =============================
// LISTA ZNAJOMYCH
// =============================

async function fetchFriendsList() {
  const res = await fetch(ENDPOINTS.FRIENDS_LIST, {
    method: "GET",
    headers: authHeaders(),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} przy pobieraniu znajomych`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || "Błąd pobierania listy znajomych");
  }

  return data.friends || [];
}

function renderFriendsList(friends) {
  const listEl = document.getElementById("friends-container");
  if (!listEl) return;

  listEl.innerHTML = "";

  friends.forEach((friend) => {
    const username = friend.username || friend;

    const item = document.createElement("div");
    item.className = "friend-item";
    item.textContent = username;

    item.addEventListener("click", () => {
      selectFriend(username);
    });

    listEl.appendChild(item);
  });
}

// =============================
// MODAL DODAWANIA ZNAJOMEGO
// =============================

function showAddFriendModal() {
  const modal = document.getElementById("add-friend-modal");
  const input = document.getElementById("friend-username");
  if (!modal) return;

  modal.classList.remove("hidden");
  if (input) {
    input.value = "";
    input.focus();
  }
}

function closeAddFriendModal() {
  const modal = document.getElementById("add-friend-modal");
  if (!modal) return;
  modal.classList.add("hidden");
}

function handleAddFriendKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    addFriend();
  }
}

async function addFriend() {
  const input = document.getElementById("friend-username");
  if (!input) return;

  const friendUsername = input.value.trim();
  if (!friendUsername) {
    alert("Podaj nazwę użytkownika znajomego.");
    return;
  }

  try {
    const res = await fetch(ENDPOINTS.FRIENDS_ADD, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ friendUsername }),
    });

    if (!res.ok) {
      console.error("[CHAT] addFriend HTTP error:", res.status);
      alert(`Błąd HTTP ${res.status} podczas dodawania znajomego.`);
      return;
    }

    const data = await res.json();
    if (!data.success) {
      console.error("[CHAT] addFriend backend error:", data);
      alert(data.error || "Nie udało się dodać znajomego.");
      return;
    }

    closeAddFriendModal();

    const friends = await fetchFriendsList();
    renderFriendsList(friends);
  } catch (err) {
    console.error("[CHAT] addFriend exception:", err);
    alert("Wystąpił błąd podczas dodawania znajomego.");
  }
}

// =============================
// WIADOMOŚCI + POOLING
// =============================

let activeFriend = null;
let messagesPollInterval = null;
let friendsPollInterval = null;

const MESSAGES_POLL_MS = 3000;
const FRIENDS_POLL_MS = 8000;

// Cache wiadomości per znajomy, żeby nie deszyfrować w kółko tego samego
const messagesCache = {};        // { friendUsername: [ { id, sender, text, outgoing, timestamp }, ... ] }
const lastSeenMessageId = {};    // { friendUsername: number }

async function selectFriend(friendUsername) {
  activeFriend = friendUsername;

  const nameEl = document.getElementById("current-chat-name");
  const statusEl = document.getElementById("current-chat-status");

  if (nameEl) nameEl.textContent = friendUsername;
  if (statusEl) statusEl.textContent = "Aktywna rozmowa";

  // najpierw ładujemy od razu
  await loadMessages(friendUsername);

  // restartujemy polling wiadomości
  if (messagesPollInterval) {
    clearInterval(messagesPollInterval);
    messagesPollInterval = null;
  }

  messagesPollInterval = setInterval(() => {
    if (activeFriend) {
      loadMessages(activeFriend);
    }
  }, MESSAGES_POLL_MS);
}

async function loadMessages(friendUsername) {
  const url = ENDPOINTS.MESSAGES_GET_FOR_FRIEND(friendUsername);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
    });

    if (!res.ok) {
      console.error("[CHAT] Błąd pobierania wiadomości:", res.status);
      return;
    }

    const data = await res.json();
    if (!data.success) {
      console.error("[CHAT] Błąd pobierania wiadomości (backend):", data.error);
      return;
    }

    const rawMessages = data.messages || [];
    const me = getUsername();
    const friendKey = friendUsername;

    // Upewniamy się, że cache istnieje
    if (!messagesCache[friendKey]) {
      messagesCache[friendKey] = [];
    }
    if (typeof lastSeenMessageId[friendKey] !== "number") {
      lastSeenMessageId[friendKey] = 0;
    }

    const lastSeen = lastSeenMessageId[friendKey];

    // Bierzemy tylko nowe wiadomości (id > lastSeen)
    const newRawMessages = rawMessages.filter((raw) => {
      if (typeof raw.id !== "number") return true; // fallback, gdyby id nie było
      return raw.id > lastSeen;
    });

    // Jeżeli nic nowego – odświeżamy widok z cache i kończymy
    if (newRawMessages.length === 0) {
      renderMessages(messagesCache[friendKey]);
      return;
    }

    let maxId = lastSeen;

    for (const raw of newRawMessages) {
      const from = raw.from || raw.sender || "???";
      const isOutgoing = from === me;
      let text = "";

      try {
        if (
          raw.encryptedPayload &&
          window.DanaidSignalCrypto &&
          typeof window.DanaidSignalCrypto.decryptFromFriend === "function"
        ) {
          if (
            isOutgoing &&
            typeof window.DanaidSignalCrypto.decryptOwnSentMessage ===
              "function"
          ) {
            // MOJE wysłane wiadomości – używamy łańcucha SENDING
            text = await window.DanaidSignalCrypto.decryptOwnSentMessage(
              friendUsername,
              raw.encryptedPayload
            );
          } else {
            // Wiadomości PRZYCHODZĄCE – normalny decryptFromFriend (RECEIVING)
            text = await window.DanaidSignalCrypto.decryptFromFriend(
              friendUsername,
              raw.encryptedPayload
            );
          }
        } else if (typeof raw.text === "string") {
          text = raw.text;
        } else {
          text = "[nie udało się odczytać treści wiadomości]";
        }
      } catch (err) {
        console.error("[E2EE] Błąd deszyfrowania wiadomości:", err, raw);
        text = "[błąd deszyfrowania]";
      }

      messagesCache[friendKey].push({
        id: raw.id,
        sender: from,
        text,
        outgoing: isOutgoing,
        timestamp: raw.timestamp || null,
      });

      if (typeof raw.id === "number" && raw.id > maxId) {
        maxId = raw.id;
      }
    }

    // Aktualizujemy lastSeen dopiero po udanym przetworzeniu nowych wiadomości
    lastSeenMessageId[friendKey] = maxId;

    // Renderujemy z cache
    renderMessages(messagesCache[friendKey]);
  } catch (err) {
    console.error("[CHAT] Wyjątek przy pobieraniu wiadomości:", err);
  }
}

function renderMessages(messages) {
  const area = document.getElementById("messages-area");
  if (!area) return;

  area.innerHTML = "";

  messages.forEach((msg) => {
    const row = document.createElement("div");
    row.className = msg.outgoing
      ? "message-row outgoing"
      : "message-row incoming";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = msg.text;

    row.appendChild(bubble);
    area.appendChild(row);
  });

  area.scrollTop = area.scrollHeight;
}

async function sendMessage() {
  if (!activeFriend) return;

  const input = document.getElementById("message-input");
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  input.value = "";

  let body;

  try {
    if (
      window.DanaidSignalCrypto &&
      typeof window.DanaidSignalCrypto.encryptForFriend === "function"
    ) {
      const encryptedPayload =
        await window.DanaidSignalCrypto.encryptForFriend(
          activeFriend,
          text
        );

      body = {
        to: activeFriend,
        encryptedPayload,
      };
    } else {
      body = {
        to: activeFriend,
        text,
      };
    }
  } catch (err) {
    console.error("[E2EE] Błąd szyfrowania wiadomości:", err);
    return;
  }

  try {
    const res = await fetch(ENDPOINTS.MESSAGE_SEND, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[CHAT] sendMessage HTTP:", res.status);
      return;
    }

    const data = await res.json();
    if (!data.success) {
      console.error("[CHAT] sendMessage backend:", data.error);
      return;
    }

    // nie musimy ręcznie dopychać — polling i tak zaraz odświeży
    await loadMessages(activeFriend);
  } catch (err) {
    console.error("[CHAT] Wyjątek przy wysyłaniu wiadomości:", err);
  }
}

async function clearMessages() {
  if (!activeFriend) return;

  try {
    const res = await fetch(ENDPOINTS.MESSAGE_CLEAR, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ friendUsername: activeFriend }),
    });

    if (!res.ok) {
      console.error("[CHAT] clearMessages HTTP:", res.status);
      return;
    }

    const data = await res.json();
    if (!data.success) {
      console.error("[CHAT] clearMessages backend:", data.error);
      return;
    }

    // czyścimy widok
    renderMessages([]);

    // czyścimy cache dla aktualnego znajomego
    if (messagesCache[activeFriend]) {
      messagesCache[activeFriend] = [];
    }
    lastSeenMessageId[activeFriend] = 0;

    // STOP POOLING po wyczyszczeniu (tak chciałeś)
    if (messagesPollInterval) {
      clearInterval(messagesPollInterval);
      messagesPollInterval = null;
    }
  } catch (err) {
    console.error("[CHAT] Wyjątek przy czyszczeniu wiadomości:", err);
  }
}

// =============================
// INIT
// =============================

async function initChat() {
  console.log("[CHAT] Start inicjalizacji chat.js");

  setConnectionStatusOffline();
  initDebugConsole();

  const me = getUsername();
  const token = getToken();

  if (!me || !token) {
    console.warn("[CHAT] Brak pełnej sesji (username/token) → login");
    try {
      localStorage.removeItem("danaid_username");
      localStorage.removeItem("danaid_jwt");
    } catch (err) {
      console.error("[CHAT] Błąd czyszczenia sesji:", err);
    }
    window.location.href = "login.html";
    return;
  }

  const titleEl = document.querySelector(".app-title");
  if (titleEl) {
    titleEl.textContent = me;
  }

  // E2EE init
  try {
    if (
      window.DanaidSignalCrypto &&
      typeof window.DanaidSignalCrypto.initForUser === "function"
    ) {
      window.DanaidSignalCrypto.initForUser(me);
      console.log("[E2EE] Zainicjalizowano E2EE dla użytkownika:", me);
    } else {
      console.warn(
        "[E2EE] window.DanaidSignalCrypto.initForUser nie jest dostępne."
      );
    }
  } catch (err) {
    console.error("[E2EE] Błąd inicjalizacji E2EE dla użytkownika:", err);
  }

  console.log("[CHAT] Zalogowany jako:", me);

  try {
    const friends = await fetchFriendsList();
    renderFriendsList(friends);
    setConnectionStatusOnline();
  } catch (err) {
    console.error("[CHAT] Błąd ładowania znajomych:", err);
    setConnectionStatusOffline();
  }

  // pooling listy znajomych
  if (friendsPollInterval) {
    clearInterval(friendsPollInterval);
  }
  friendsPollInterval = setInterval(async () => {
    try {
      const friends = await fetchFriendsList();
      renderFriendsList(friends);
    } catch (err) {
      console.error("[CHAT] Błąd odświeżania listy znajomych:", err);
    }
  }, FRIENDS_POLL_MS);

  document
    .getElementById("message-send-btn")
    ?.addEventListener("click", sendMessage);

  document
    .getElementById("message-input")
    ?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

  document
    .getElementById("clear-messages-btn")
    ?.addEventListener("click", clearMessages);

  console.log("[CHAT] Inicjalizacja zakończona");
}

window.addEventListener("DOMContentLoaded", initChat);
