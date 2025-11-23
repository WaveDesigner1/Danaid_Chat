// backend/utils/security.js
// Funkcje pomocnicze bezpieczeństwa dla Danaid Chat
// - weryfikacja podpisu klienta (RSA)
// - fingerprint klucza tożsamości
// - (na przyszłość) weryfikacja signed prekey

import crypto from "crypto";

/**
 * verifyClientSignature
 *
 * Weryfikuje podpis klienta (np. podczas rejestracji/logowania).
 * Zakładamy:
 * - message: string (np. challenge albo JSON)
 * - signatureB64: Base64 z podpisu
 * - clientPublicKeyPem: klucz publiczny RSA w formacie PEM
 */
export function verifyClientSignature(message, signatureB64, clientPublicKeyPem) {
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(message, "utf8");
    verifier.end();

    const signature = Buffer.from(signatureB64, "base64");
    const ok = verifier.verify(clientPublicKeyPem, signature);

    return ok;
  } catch (err) {
    console.error("[SECURITY] Błąd verifyClientSignature:", err);
    return false;
  }
}

/**
 * computeIdentityKeyFingerprint
 *
 * Zwraca fingerprint klucza tożsamości w formie hex (SHA-256).
 * W idealnym świecie używamy SHA-256 z SPKI,
 * tutaj jako uproszczenie bierzemy cały PEM jako input do SHA-256.
 *
 * Zastosowanie:
 * - wyświetlanie "safety number"
 * - porównywanie, czy klucz znajomego się zmienił
 */
export function computeIdentityKeyFingerprint(publicKeyPem) {
  try {
    const hash = crypto.createHash("sha256");
    hash.update(publicKeyPem, "utf8");
    const digestHex = hash.digest("hex");
    return digestHex;
  } catch (err) {
    console.error("[SECURITY] Błąd computeIdentityKeyFingerprint:", err);
    return null;
  }
}

/**
 * verifySignedPreKey
 *
 * Weryfikuje, że signedPreKeyPubPem jest podpisany kluczem tożsamości usera.
 * To będzie potrzebne przy wdrażaniu pełnego X3DH-lite.
 *
 * Parametry:
 * - signedPreKeyPubPem: publiczny klucz prekey (PEM)
 * - signatureB64: Base64 z podpisu nad signedPreKeyPubPem
 * - identityKeyPubPem: klucz tożsamości (PEM)
 */
export function verifySignedPreKey(
  signedPreKeyPubPem,
  signatureB64,
  identityKeyPubPem
) {
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(signedPreKeyPubPem, "utf8");
    verifier.end();

    const signature = Buffer.from(signatureB64, "base64");
    const ok = verifier.verify(identityKeyPubPem, signature);

    return ok;
  } catch (err) {
    console.error("[SECURITY] Błąd verifySignedPreKey:", err);
    return false;
  }
}
