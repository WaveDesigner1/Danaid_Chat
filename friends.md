# Dodawanie znajomych – Danaid Chat (PROD)

## Cel
Stworzenie wzajemnej relacji „friends” między dwoma użytkownikami wraz z poprawnym przygotowaniem ich inboxów i wymianą kluczy publicznych.

## Flow

1. Użytkownik A wysyła żądanie dodania znajomego do `/friends/add`.
   ```json
   { "to": "B" }
   ```
2. Backend:
   - sprawdza poprawność JWT,
   - sprawdza czy B istnieje,
   - sprawdza czy relacja A→B już istnieje.
3. Po akceptacji:
   - Backend edytuje:
     - `users/A.json` → dodaje:
       ```json
       {
         "username": "B",
         "publicKeyPem": "<klucz B>"
       }
       ```
     - `users/B.json` → dodaje:
       ```json
       {
         "username": "A",
         "publicKeyPem": "<klucz A>"
       }
       ```
4. Backend tworzy **inbox/conversation**:
   - `backend/db/conversations/conv_A_B.json`
   - zawiera pustą listę wiadomości.

## Bezpieczeństwo
- Znajomi muszą być *wzajemnie* dodani → zero spamu, zero wiadomości od obcych.
- publicKeyPem znajomego przechowywany jest per user → przygotowane pod X3DH.
- Konwersacja istnieje tylko dla pary users A–B.
