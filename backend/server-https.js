// backend/server-https.js
import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import app from "./app.js";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ścieżki do certów *zawsze* względem katalogu backend/
const keyPath = path.join(__dirname, "certs", "chat.danaid-key.pem");
const certPath = path.join(__dirname, "certs", "chat.danaid-cert.pem");

let options;

try {
  options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
} catch (err) {
  console.error("[HTTPS] Błąd wczytywania certów:", {
    keyPath,
    certPath,
    error: err,
  });
  process.exit(1); // bez certów i tak nic nie zrobimy
}

const PORT = 8443;

https.createServer(options, app).listen(PORT, "0.0.0.0", () => {
  console.log(
    `[HTTPS] Serwer działa na https://chat.danaid:${PORT}/login.html`
  );
});
