import fs from "node:fs";
import path from "node:path";

// Docker-Secrets: statt NAME kann NAME_FILE auf eine Datei zeigen (z. B. /run/secrets/…)
for (const [name, datei] of Object.entries(process.env)) {
  if (name.endsWith("_FILE") && datei && !process.env[name.slice(0, -5)]) {
    process.env[name.slice(0, -5)] = fs.readFileSync(datei, "utf8").trim();
  }
}

function env(name: string, standard?: string): string {
  const wert = process.env[name];
  if (wert !== undefined && wert !== "") return wert;
  if (standard !== undefined) return standard;
  throw new Error(`Umgebungsvariable ${name} fehlt`);
}

function optional(name: string): string | undefined {
  const wert = process.env[name];
  return wert === undefined || wert === "" ? undefined : wert;
}

const datenVerzeichnis = env("DATA_DIR", "/data");

export const config = {
  port: Number(env("PORT", "8080")),
  datenVerzeichnis,
  datenbankUrl: env("DATABASE_URL", "postgres://tillsplit@localhost:5432/tillsplit"),
  // überschreibt ein Passwort in DATABASE_URL (praktisch mit DATABASE_PASSWORD_FILE)
  datenbankPasswort: optional("DATABASE_PASSWORD"),
  // Ablage der Bons: <BON_DIR>/<Haushalts-Ordner>/<Jahr>/<Monat>/<Datum>_<Händler>_<Summe>.<ext>
  bonVerzeichnis: env("BON_DIR", path.join(datenVerzeichnis, "bons")),
  // Weitere erlaubte Wurzeln für absolute Ablagepfade der Haushalte (z. B. eigene NFS-Mounts), durch Komma getrennt
  ablageWurzeln: (optional("ABLAGE_WURZELN") ?? "").split(",").map((p) => p.trim()).filter(Boolean),
  eingangVerzeichnis: path.join(datenVerzeichnis, "eingang"),
  actualCacheVerzeichnis: path.join(datenVerzeichnis, "actual-cache"),
  webVerzeichnis: env("WEB_DIR", path.resolve("../web/dist")),

  // AGPL: Nutzer müssen an den Quellcode der laufenden Version kommen (bei Änderungen eigenes Repository angeben)
  quellcodeUrl: env("QUELLCODE_URL", "https://github.com/t3chdock-labs/TillSplit"),
  // Optionaler Spenden-Link (z. B. Buy Me a Coffee); leer = kein Knopf
  spendenUrl: optional("SPENDEN_URL"),

  // Anmeldung
  // Öffentliche Adresse, z. B. https://bon.example.de – nötig für Passkeys hinter einem Reverse Proxy
  oeffentlicheUrl: optional("PUBLIC_URL"),
  // Erster Admin beim allerersten Start (danach ohne Wirkung)
  adminEmail: optional("ADMIN_EMAIL"),
  adminPasswort: optional("ADMIN_PASSWORD"),
  // Zwei-Faktor-Anmeldung für alle Benutzer verlangen
  zweiFaktorPflicht: env("ZWEI_FAKTOR_PFLICHT", "false") === "true",
  sitzungTage: Number(env("SITZUNG_TAGE", "30")),

  // KI
  kiAnbieter: env("KI_ANBIETER", "claude") as "claude" | "ollama" | "tesseract",
  claudeModell: env("CLAUDE_MODEL", "claude-opus-5-5"),
  claudeAufwand: env("CLAUDE_EFFORT", "medium") as "low" | "medium" | "high",
  // Zweites Modell, wenn die Positionen nicht zur Bonsumme passen (leer = keine Nachprüfung)
  claudeNachpruefModell: optional("CLAUDE_MODEL_NACHPRUEFEN"),
  ollamaUrl: env("OLLAMA_URL", "http://localhost:11434"),
  ollamaModell: env("OLLAMA_MODEL", "qwen2.5vl:7b"),

  // Backup (Datenbank + Bon-Ablagen + Schlüssel, verschlüsselt mit BACKUP_PASSWORD)
  backup: {
    verzeichnis: env("BACKUP_DIR", path.join(datenVerzeichnis, "backups")),
    passwort: optional("BACKUP_PASSWORD"),
    stunden: Number(env("BACKUP_STUNDEN", "24")), // 0 = nur von Hand
    behalten: Math.max(1, Number(env("BACKUP_BEHALTEN", "14"))),
    mitBons: env("BACKUP_MIT_BONS", "true") === "true",
  },

  // Texterkennung ohne KI-Bildmodell: Tesseract liest den Text, ein Sprachmodell gliedert ihn
  tesseractSprache: env("TESSERACT_LANG", "deu+eng"),
  textModellAnbieter: env("TEXTMODELL_ANBIETER", "ollama") as "ollama" | "claude",
  ollamaTextModell: env("OLLAMA_TEXT_MODEL", "qwen2.5:7b"),

  // Benachrichtigungen per E-Mail (SMTP) und Telegram-Bot; ohne Angaben nur die Glocke in der Oberfläche
  smtp: {
    host: optional("SMTP_HOST"),
    port: Number(env("SMTP_PORT", "587")),
    // true = TLS von Anfang an (Port 465), sonst STARTTLS
    sicher: env("SMTP_SICHER", "false") === "true",
    benutzer: optional("SMTP_USER"),
    passwort: optional("SMTP_PASSWORD"),
    absender: optional("SMTP_FROM"),
  },
  telegramToken: optional("TELEGRAM_BOT_TOKEN"),
  // Zeitzone für Erinnerungen ("jeden Tag um 18 Uhr")
  zeitzone: env("TZ", "Europe/Berlin"),

  // Actual Budget
  actual: {
    serverUrl: optional("ACTUAL_SERVER_URL"),
    passwort: optional("ACTUAL_PASSWORD"),
    syncId: optional("ACTUAL_SYNC_ID"),
    e2ePasswort: optional("ACTUAL_E2E_PASSWORD"),
  },
};

export const actualKonfiguriert = () =>
  Boolean(config.actual.serverUrl && config.actual.passwort && config.actual.syncId);
