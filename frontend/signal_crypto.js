// frontend/signal-crypto.js
// Warstwa E2EE dla Danaid Chat (E2EE v2 szkic)
// - Sesje per znajomy
// - RootKey + Double Ratchet (uproszczone, z prostym KDF)
// - AEAD: AES-GCM (WebCrypto)
// - DEBUG_E2EE: logi z każdego etapu

// =========================
// KONFIGURACJA / DEBUG
// =========================

const DEBUG_E2EE = true;

function logE2EE(...args) {
  if (DEBUG_E2EE) {
    console.log("[E2EE]", ...args);
  }
}

function logX3DH(...args) {
  if (DEBUG_E2EE) {
    console.log("[X3DH]", ...args);
  }
}

function logDR(...args) {
  if (DEBUG_E2EE) {
    console.log("[DR]", ...args);
  }
}

// =========================
 // HELPERY: ENCODING
// =========================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Zamiana string -> Uint8Array (UTF-8)
 */
function utf8ToBytes(str) {
  return textEncoder.encode(str);
}

/**
 * Uint8Array -> string (UTF-8)
 */
function bytesToUtf8(bytes) {
  return textDecoder.decode(bytes);
}

/**
 * Uint8Array -> base64
 */
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * base64 -> Uint8Array
 */
function base64ToBytes(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// =========================
// HELPERY: KDF / HASH
// =========================

/**
 * SHA-256(buffer) -> Uint8Array(32)
 */
async function sha256(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(buf);
}

/**
 * Prosty KDF: SHA256(key || context)
 * NIE jest idealnym HKDF, ale wystarcza jako edukacyjny KDF
 * na potrzeby prototypu Double Ratchet v2.
 */
async function kdf(keyBytes, contextStr) {
  const ctx = utf8ToBytes(contextStr);
  const combined = new Uint8Array(keyBytes.length + ctx.length);
  combined.set(keyBytes, 0);
  combined.set(ctx, keyBytes.length);
  const out = await sha256(combined);
  return out; // 32 bajty
}

/**
 * Losowy klucz 32B (np. initial rootKey w dev-mode).
 */
function randomKey32() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return arr;
}

// =========================
// HELPERY: AES-GCM (AEAD)
// =========================

/**
 * Importuje surowy klucz 32B jako AES-GCM key.
 */
async function importAesKey(rawKeyBytes) {
  return crypto.subtle.importKey(
    "raw",
    rawKeyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * AEAD encrypt:
 * - keyBytes: Uint8Array(32)
 * - plaintextStr: string
 * - adObj: obiekt AD (np. {version, sessionId, sentAt, ...})
 *
 * Zwraca:
 * {
 *   ivB64,
 *   ciphertextB64,
 *   authTagB64
 * }
 */
async function aeadEncrypt(keyBytes, plaintextStr, adObj) {
  const key = await importAesKey(keyBytes);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const plaintextBytes = utf8ToBytes(plaintextStr);
  const adJson = JSON.stringify(adObj || {});
  const adBytes = utf8ToBytes(adJson);

  const cipherBuf = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: adBytes,
      tagLength: 128,
    },
    key,
    plaintextBytes
  );

  const combined = new Uint8Array(cipherBuf);
  // Ostatnie 16 bajtów to tag
  const tagLength = 16;
  const ciphertext = combined.slice(0, combined.length - tagLength);
  const authTag = combined.slice(combined.length - tagLength);

  const ivB64 = bytesToBase64(iv);
  const ciphertextB64 = bytesToBase64(ciphertext);
  const authTagB64 = bytesToBase64(authTag);

  logE2EE("AEAD encrypt", {
    plaintext: plaintextStr,
    ad: adObj,
    ivB64,
    ciphertextB64,
    authTagB64,
  });

  return { ivB64, ciphertextB64, authTagB64 };
}

/**
 * AEAD decrypt:
 * - keyBytes: Uint8Array(32)
 * - ivB64, ciphertextB64, authTagB64
 * - adObj (musi być identyczny jak przy encrypt)
 */
async function aeadDecrypt(keyBytes, { ivB64, ciphertextB64, authTagB64 }, adObj) {
  const key = await importAesKey(keyBytes);
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(ciphertextB64);
  const authTag = base64ToBytes(authTagB64);

  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);

  const adJson = JSON.stringify(adObj || {});
  const adBytes = utf8ToBytes(adJson);

  let plaintextBytes;
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: adBytes,
        tagLength: 128,
      },
      key,
      combined
    );
  } catch (err) {
    logE2EE("AEAD decrypt FAILED", err);
    throw err;
  }

  const plaintext = bytesToUtf8(new Uint8Array(plaintextBytes));

  logE2EE("AEAD decrypt OK", {
    plaintext,
    ad: adObj,
  });

  return plaintext;
}

// =========================
// STRUKTURA SESJI PER ZNAJOMY
// =========================

/**
 * Sesja Double Ratchet per znajomy.
 * Póki co:
 * - rootKey: Uint8Array(32)
 * - sendingChainKey: Uint8Array(32)
 * - receivingChainKey: Uint8Array(32)
 * - Ns, Nr, PN: liczniki
 *
 * W przyszłości można dorzucić:
 * - DHs / DHr (ratchet kluczy DH),
 *   ale na razie uproszczamy do symetrycznego KDF-ratchetu.
 */
class FriendSession {
  constructor(currentUsername, friendUsername, initialRootKeyBytes) {
    this.currentUsername = currentUsername;
    this.friendUsername = friendUsername;

    this.rootKey = initialRootKeyBytes;          // 32B
    this.sendingChainKey = null;                // 32B
    this.receivingChainKey = null;              // 32B

    this.Ns = 0;  // liczba wysłanych w aktualnym łańcuchu
    this.Nr = 0;  // liczba odebranych w aktualnym łańcuchu
    this.PN = 0;  // poprzednie Nr (gdy zmieni się ratchet)

    this.sessionId = `sess-${this.currentUsername}-${this.friendUsername}-${Date.now()}`;
  }

  /**
   * Inicjalizacja łańcuchów na podstawie rootKey.
   * W docelowym X3DH rootKey pochodzi z DH+HKDF,
   * tutaj w dev-trybie robimy prosty KDF z rolami A/B.
   */
  async initChains() {
    if (!this.rootKey) {
      this.rootKey = randomKey32();
    }

    // Wyznaczamy deterministycznie role A/B dla pary userów.
    // pair[0] = "mniejszy" nick, pair[1] = "większy".
    const pair = [this.currentUsername, this.friendUsername].slice().sort();
    const iAmA = this.currentUsername === pair[0];

    // Ustalamy etykiety dla łańcuchów:
    // - użytkownik A: wysyła CHAIN_A_TO_B, odbiera CHAIN_B_TO_A
    // - użytkownik B: wysyła CHAIN_B_TO_A, odbiera CHAIN_A_TO_B
    const sendingLabel   = iAmA ? "CHAIN_A_TO_B" : "CHAIN_B_TO_A";
    const receivingLabel = iAmA ? "CHAIN_B_TO_A" : "CHAIN_A_TO_B";

    this.sendingChainKey   = await kdf(this.rootKey, sendingLabel);
    this.receivingChainKey = await kdf(this.rootKey, receivingLabel);

    this.Ns = 0;
    this.Nr = 0;
    this.PN = 0;

    logDR("initChains", {
      me: this.currentUsername,
      friend: this.friendUsername,
      role: iAmA ? "A" : "B",
      sendingLabel,
      receivingLabel,
      rootKey: bytesToBase64(this.rootKey),
      sendingChainKey: bytesToBase64(this.sendingChainKey),
      receivingChainKey: bytesToBase64(this.receivingChainKey),
    });
  }

  /**
   * Z łańcucha wysyłającego generuje next messageKey + uaktualnia sendingChainKey.
   * Zwraca { messageKeyBytes, index }
   */
  async nextSendingMessageKey() {
    if (!this.sendingChainKey) {
      await this.initChains();
    }

    // UPROSZCZENIE DEV:
    // łańcuch wiadomości dla kierunku "ja -> znajomy"
    const ctx = `MSG_${this.Ns}`;
    const messageKey = await kdf(this.sendingChainKey, ctx);

    const nextChain = await kdf(this.sendingChainKey, "CHAIN_NEXT");
    this.sendingChainKey = nextChain;
    this.Ns += 1;

    logDR("nextSendingMessageKey", {
      me: this.currentUsername,
      friend: this.friendUsername,
      Ns: this.Ns,
      messageKey: bytesToBase64(messageKey),
      newSendingChainKey: bytesToBase64(this.sendingChainKey),
    });

    return { messageKeyBytes: messageKey, index: this.Ns };
  }

  /**
   * Z łańcucha odbierającego generuje messageKey dla kolejnej przychodzącej wiadomości.
   * W docelowym DR trzeba obsłużyć "message skipping" / out-of-order,
   * tutaj uproszczamy: zakładamy kolejność.
   */
  async nextReceivingMessageKey() {
    if (!this.receivingChainKey) {
      await this.initChains();
    }

    // UPROSZCZENIE DEV:
    // łańcuch wiadomości dla kierunku "znajomy -> ja"
    const ctx = `MSG_${this.Nr}`;
    const messageKey = await kdf(this.receivingChainKey, ctx);
    const nextChain = await kdf(this.receivingChainKey, "CHAIN_NEXT");
    this.receivingChainKey = nextChain;
    this.Nr += 1;

    logDR("nextReceivingMessageKey", {
      me: this.currentUsername,
      friend: this.friendUsername,
      Nr: this.Nr,
      messageKey: bytesToBase64(messageKey),
      newReceivingChainKey: bytesToBase64(this.receivingChainKey),
    });

    return { messageKeyBytes: messageKey, index: this.Nr };
  }
}

// =========================
// GŁÓWNY MENEDŻER: SignalCrypto
// =========================

class SignalCryptoManager {
  constructor() {
    this.currentUsername = null;
    this.sessions = new Map(); // friendUsername -> FriendSession
  }

  /**
   * Inicjalizacja dla zalogowanego użytkownika.
   * Tu można byłoby wczytać z localStorage istniejące sesje itd.
   */
  initForUser(username) {
    this.currentUsername = username;
    this.sessions.clear(); // na razie — czysty start
    logE2EE("Zainicjalizowano SignalCryptoManager dla usera:", username);
  }

  /**
   * DEV: pseudo-X3DH.
   * Docelowo tutaj:
   *  - pobierasz prekey bundle znajomego,
   *  - liczysz DH-y,
   *  - z HKDF wyciągasz rootKey.
   *
   * Teraz: rootKey = SHA256("username|friend")
   */
  async deriveInitialRootKey(friendUsername) {
    if (!this.currentUsername) {
      throw new Error("SignalCryptoManager: currentUsername nie ustawiony");
    }

    // Symetryczny kontekst: kolejność nazw nie ma znaczenia
    const pair = [this.currentUsername, friendUsername].sort();
    const ctxStr = `ROOT|${pair[0]}|${pair[1]}`;
    const bytes = utf8ToBytes(ctxStr);
    const rootKey = await sha256(bytes);

    logX3DH("deriveInitialRootKey (DEV)", {
      user: this.currentUsername,
      friend: friendUsername,
      ctxStr,
      rootKey: bytesToBase64(rootKey),
    });

    return rootKey;
  }

  /**
   * Zwraca istniejącą sesję z friendem lub tworzy nową.
   */
  async getOrCreateSession(friendUsername) {
    let session = this.sessions.get(friendUsername);
    if (!session) {
      const rootKey = await this.deriveInitialRootKey(friendUsername);
      session = new FriendSession(this.currentUsername, friendUsername, rootKey);
      await session.initChains();
      this.sessions.set(friendUsername, session);
      logDR("Nowa sesja z", friendUsername, "->", {
        sessionId: session.sessionId,
      });
    }
    return session;
  }

  /**
   * Publiczne API:
   * Szyfrowanie wiadomości do znajomego.
   *
   * Zwraca obiekt:
   * {
   *   header: { n, pn, timestamp },
   *   ciphertextB64,
   *   authTagB64,
   *   ivB64,
   *   ad: {...},
   * }
   *
   * który można wysłać na backend jako treść wiadomości.
   */
  async encryptForFriend(friendUsername, plaintext) {
    const session = await this.getOrCreateSession(friendUsername);
    const now = Date.now();

    // W pełnym DR: pn, ratchetPub etc.
    // Tu uproszczamy: jeden łańcuch per kierunek, bez DH-ratchetu.
    const { messageKeyBytes, index } = await session.nextSendingMessageKey();

    const ad = {
      version: 2,
      sessionId: session.sessionId,
      from: this.currentUsername,
      to: friendUsername,
      msgIndex: index,
      sentAt: now,
    };

    const header = {
      n: index,
      pn: session.PN, // w uproszczeniu zawsze 0
      timestamp: now,
    };

    const { ivB64, ciphertextB64, authTagB64 } = await aeadEncrypt(
      messageKeyBytes,
      plaintext,
      ad
    );

    const payload = {
      header,
      ivB64,
      ciphertextB64,
      authTagB64,
      ad,
    };

    logE2EE("encryptForFriend -> payload", {
      friend: friendUsername,
      payload,
    });

    return payload;
  }

  /**
   * Publiczne API:
   * Odszyfrowanie wiadomości od znajomego.
   *
   * `messagePayload` to obiekt, który wcześniej został
   * wygenerowany przez `encryptForFriend` u nadawcy i
   * zapisany w pliku konwersacji.
   */
  async decryptFromFriend(friendUsername, messagePayload) {
    const session = await this.getOrCreateSession(friendUsername);

    const { header, ivB64, ciphertextB64, authTagB64, ad } = messagePayload;

    logE2EE("decryptFromFriend <- payload", {
      friend: friendUsername,
      header,
      ad,
    });

    // W pełnym DR trzeba by rozpoznać, czy wymaga to nowego ratchetu itd.
    // Tu przyjmujemy prosty model „kolejna wiadomość z łańcucha”.
    const { messageKeyBytes, index } = await session.nextReceivingMessageKey();

    // Można sprawdzić zgodność index vs header.n w dev-trybie:
    if (DEBUG_E2EE) {
      if (index !== header.n && index !== header.n + 1) {
        // bardzo uproszczone ostrzeżenie
        console.warn(
          "[DR] Uwaga: indeks wiadomości niezgodny z lokalnym łańcuchem",
          { lokalnyIndex: index, headerN: header.n }
        );
      }
    }

    const plaintext = await aeadDecrypt(
      messageKeyBytes,
      { ivB64, ciphertextB64, authTagB64 },
      ad
    );

    return plaintext;
  }

  /**
   * Odszyfrowanie WŁASNEJ wysłanej wiadomości do friendUsername.
   * Nie używa głównej sesji DR (żeby nie popsuć liczników),
   * tylko tworzy tymczasową sesję od rootKey i idzie po łańcuchu sending
   * aż do header.n.
   */
  async decryptOwnSentToFriend(friendUsername, messagePayload) {
    if (!this.currentUsername) {
      throw new Error("SignalCryptoManager: currentUsername nie ustawiony");
    }

    const { header, ivB64, ciphertextB64, authTagB64, ad } =
      messagePayload || {};
    const targetN =
      header && typeof header.n === "number" && header.n > 0 ? header.n : 1;

    // Tworzymy tymczasową sesję tylko na potrzeby tej wiadomości
    const rootKey = await this.deriveInitialRootKey(friendUsername);
    const tempSession = new FriendSession(
      this.currentUsername,
      friendUsername,
      rootKey
    );
    await tempSession.initChains();

    // Idziemy po łańcuchu SENDING aż do header.n
    let messageKeyBytes = null;
    for (let i = 0; i < targetN; i++) {
      const { messageKeyBytes: mk } =
        await tempSession.nextSendingMessageKey();
      messageKeyBytes = mk;
    }

    logE2EE("decryptOwnSentToFriend -> użyty messageKey", {
      friend: friendUsername,
      targetN,
    });

    const plaintext = await aeadDecrypt(
      messageKeyBytes,
      { ivB64, ciphertextB64, authTagB64 },
      ad
    );

    return plaintext;
  }
}

// Singleton
const signalCryptoManager = new SignalCryptoManager();

// API globalne dla reszty frontendu (np. chat.js)
window.DanaidSignalCrypto = {
  /**
   * Ustaw aktualnego zalogowanego usera (np. po udanym logowaniu).
   */
  initForUser(username) {
    signalCryptoManager.initForUser(username);
  },

  /**
   * Szyfruj wiadomość do znajomego.
   * Zwraca gotowy obiekt do wysłania na backend.
   */
  async encryptForFriend(friendUsername, plaintext) {
    return signalCryptoManager.encryptForFriend(friendUsername, plaintext);
  },

  /**
   * Odszyfruj wiadomość od znajomego.
   * `messagePayload` to struktura z pliku konwersacji (header + ciphertext + ad).
   */
  async decryptFromFriend(friendUsername, messagePayload) {
    return signalCryptoManager.decryptFromFriend(friendUsername, messagePayload);
  },

  /**
   * Odszyfruj WŁASNĄ wysłaną wiadomość do znajomego.
   */
  async decryptOwnSentMessage(friendUsername, messagePayload) {
    return signalCryptoManager.decryptOwnSentToFriend(
      friendUsername,
      messagePayload
    );
  },
};

logE2EE(
  "Zainicjalizowano warstwę signal-crypto (tryb DEV DoubleRatchet + AES-GCM)"
);
