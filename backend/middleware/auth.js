// backend/middleware/auth.js
// Middleware do autoryzacji na podstawie JWT:
// - czyta nagłówek Authorization: Bearer <token>
// - weryfikuje JWT przy użyciu JWT_SECRET z process.env
// - jeśli OK -> ustawia req.user = { username, ...payload }
// - jeśli NIE OK -> 401/403

import "dotenv/config";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

// Ostrzeżenie przy starcie, jeśli nie ustawiono sekretu
if (!JWT_SECRET) {
  console.warn(
    "[AUTH] Uwaga: JWT_SECRET nie jest ustawiony w process.env. " +
      "Weryfikacja tokenów JWT będzie się wysypywać."
  );
} else {
  console.log("[AUTH] JWT_SECRET poprawnie wczytany.");
}

/**
 * requireAuth
 * Sprawdza poprawność JWT i wstrzykuje dane użytkownika do req.user.
 */
export function requireAuth(req, res, next) {
  try {
    const authHeader =
      req.headers.authorization || req.headers.Authorization || null;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("[AUTH] Brak lub zły nagłówek Authorization.");
      return res.status(401).json({
        ok: false,
        error: "Brak tokena JWT w nagłówku Authorization.",
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    if (!JWT_SECRET) {
      console.error(
        "[AUTH] Próba weryfikacji JWT bez ustawionego JWT_SECRET."
      );
      return res.status(500).json({
        ok: false,
        error: "Błąd konfiguracji serwera (brak JWT_SECRET).",
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.warn("[AUTH] Nieudana weryfikacja JWT:", err.message);
      return res.status(401).json({
        ok: false,
        error: "Nieprawidłowy lub wygasły token.",
      });
    }

    if (!payload || !payload.username) {
      console.warn("[AUTH] Payload JWT bez pola username.");
      return res.status(401).json({
        ok: false,
        error: "Nieprawidłowy token (brak username).",
      });
    }

    // Wstrzykujemy dane użytkownika do req.user
    req.user = {
      username: payload.username,
      ...payload,
    };

    // Lecimy dalej
    return next();
  } catch (err) {
    console.error("[AUTH] Błąd w requireAuth:", err);
    return res.status(500).json({
      ok: false,
      error: "Wewnętrzny błąd serwera podczas autoryzacji.",
    });
  }
}
