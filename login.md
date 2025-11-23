# Logowanie – Danaid Chat (PROD)

## Cel
Uwierzytelnienie użytkownika na podstawie:
- *dowodu posiadania klucza prywatnego* (podpis challenge′a),
- poprawnego klucza pochodnego PBKDF2 ( derivedKey ),
- integralności rekordu użytkownika (`serverSignature`).

## Etapy logowania

1. **Użytkownik wpisuje login i hasło**, ładuje zaszyfrowany plik PEM.
2. Frontend wysyła do backendu `/login/start`:
   ```json
   { "username": "..." }
   ```
3. Backend:
   - ładuje plik użytkownika,
   - weryfikuje `serverSignature`,
   - generuje unikalny jednorazowy `challenge` z TTL,
   - zwraca:
     - parametry PBKDF2,
     - `challenge`,
     - `serverPubKey`,
     - `serverSignature`.
4. Frontend:
   - weryfikuje fingerprint `serverPubKey`,
   - odszyfrowuje PEM,
   - liczy PBKDF2 (tak samo jak przy rejestracji),
   - podpisuje `challenge`.
5. Frontend wysyła `/login/finish`:
   ```json
   {
     "username": "...",
     "challengeId": "...",
     "derivedKeyB64": "...",
     "challengeSignatureB64": "..."
   }
   ```
6. Backend:
   - porównuje derivedKey (timing‑safe),
   - weryfikuje podpis challenge,
   - jeśli OK → generuje JWT (z TTL).
7. Frontend zapisuje JWT w `localStorage`.

## Bezpieczeństwo
- Challenge ma TTL i jest jednorazowy.
- derivedKey porównywany w sposób odporny na timing‑attacks.
- JWT jest potrzebny do wszystkich endpointów typu messages / friends.
