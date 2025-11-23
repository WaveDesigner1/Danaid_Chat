# Rejestracja – Danaid Chat (PROD)

## Cel
Zapewnienie bezpiecznego tworzenia konta użytkownika z dowodem posiadania klucza prywatnego i pełną weryfikacją integralności danych po stronie backendu.

## Flow (Frontend → Backend)

1. **Użytkownik wpisuje login** i **hasło**.
2. Frontend:
   - generuje *lokalnie* parę kluczy RSA/EC (docelowo *identity keypair*),
   - szyfruje klucz prywatny (AES‑GCM + PBKDF2/Argon2) i przechowuje go lokalnie,
   - pobiera fingerprint klucza publicznego serwera (pinning),
   - pobiera parametry PBKDF2 z backendu (salt, iteracje, długość).
3. Frontend wylicza:
   - `derivedKey = PBKDF2(password, salt, iterations)`,
   - podpisuje `challenge` od backendu.
4. Backend po stronie `/register`:
   - sprawdza unikalność loginu,
   - generuje `serverSignature` nad danymi,
   - tworzy JSON użytkownika z:
     - `username`,
     - `publicKeyPem`,
     - `passwordHash/derivedKey`,
     - `serverSignature`,
     - `inbox` (lista konwersacji),
     - `friends` (lista znajomych).
5. Rekord trafia do: `backend/db/users/<username>.json`.
6. Login jest dopisywany do `users_list.json`.

## Bezpieczeństwo
- Klucz prywatny **nigdy nie opuszcza przeglądarki**.
- Hasło nie jest wysyłane — tylko PBKDF2(…) i podpis.
- `serverSignature` pozwala backendowi wykrywać manipulacje JSON.
- Fingerprinting klucza publicznego serwera chroni przed MITM.

