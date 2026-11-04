import fs from "node:fs";
import path from "node:path";

// Frühere deutsche Variablennamen gelten weiter (auch als _FILE), die englischen haben Vorrang
const ALTE_NAMEN: Record<string, string> = {
  RECEIPT_DIR: "BON_DIR",
  STORAGE_ROOTS: "ABLAGE_WURZELN",
  SOURCE_URL: "QUELLCODE_URL",
  DONATE_URL: "SPENDEN_URL",
  REQUIRE_2FA: "ZWEI_FAKTOR_PFLICHT",
  SESSION_DAYS: "SITZUNG_TAGE",
  AI_PROVIDER: "KI_ANBIETER",
  CLAUDE_MODEL_RECHECK: "CLAUDE_MODEL_NACHPRUEFEN",
  BACKUP_INTERVAL_HOURS: "BACKUP_STUNDEN",
  BACKUP_KEEP: "BACKUP_BEHALTEN",
  BACKUP_INCLUDE_RECEIPTS: "BACKUP_MIT_BONS",
  TEXT_MODEL_PROVIDER: "TEXTMODELL_ANBIETER",
  SMTP_SECURE: "SMTP_SICHER",
  MATCH_INTERVAL_HOURS: "ABGLEICH_STUNDEN",
  FINANCE_INTERVAL_HOURS: "FINANZEN_STUNDEN",
  TILLSPLIT_LANGUAGE: "TILLSPLIT_SPRACHE",
  TILLSPLIT_KEY: "TILLSPLIT_SCHLUESSEL",
};
for (const [neu, alt] of Object.entries(ALTE_NAMEN)) {
  for (const endung of ["", "_FILE"]) {
    if (!process.env[neu + endung] && process.env[alt + endung]) process.env[neu + endung] = process.env[alt + endung];
  }
}

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
  // Ablage der Bons: <RECEIPT_DIR>/<Haushalts-Ordner>/<Jahr>/<Monat>/<Datum>_<Händler>_<Summe>.<ext>
  bonVerzeichnis: env("RECEIPT_DIR", path.join(datenVerzeichnis, "bons")),
  // Weitere erlaubte Wurzeln für absolute Ablagepfade der Haushalte (z. B. eigene NFS-Mounts), durch Komma getrennt
  ablageWurzeln: (optional("STORAGE_ROOTS") ?? "").split(",").map((p) => p.trim()).filter(Boolean),
  eingangVerzeichnis: path.join(datenVerzeichnis, "eingang"),
  actualCacheVerzeichnis: path.join(datenVerzeichnis, "actual-cache"),
  webVerzeichnis: env("WEB_DIR", path.resolve("../web/dist")),

  // AGPL: Nutzer müssen an den Quellcode der laufenden Version kommen (bei Änderungen eigenes Repository angeben)
  quellcodeUrl: env("SOURCE_URL", "https://github.com/t3chdock-labs/TillSplit"),
  // Spenden-Knopf „TillSplit unterstützen“: Standard ist der Link des Projekts, „aus“ blendet ihn aus
  spendenUrl: ["aus", "off", "none"].includes(env("DONATE_URL", "").toLowerCase()) ? undefined : env("DONATE_URL", "https://ko-fi.com/tamperold"),

  // Anmeldung
  // Öffentliche Adresse, z. B. https://bon.example.de – nötig für Passkeys hinter einem Reverse Proxy
  oeffentlicheUrl: optional("PUBLIC_URL"),
  // Erster Admin beim allerersten Start (danach ohne Wirkung)
  adminEmail: optional("ADMIN_EMAIL"),
  adminPasswort: optional("ADMIN_PASSWORD"),
  // Zwei-Faktor-Anmeldung für alle Benutzer verlangen
  zweiFaktorPflicht: env("REQUIRE_2FA", "false") === "true",
  sitzungTage: Number(env("SESSION_DAYS", "30")),

  // KI – nur Startwerte; geändert wird unter Einstellungen → Actual → Texterkennung (dort gespeicherte Werte haben Vorrang)
  kiAnbieter: env("AI_PROVIDER", "claude") as "claude" | "ollama" | "tesseract",
  claudeModell: env("CLAUDE_MODEL", "claude-opus-5-5"),
  claudeAufwand: env("CLAUDE_EFFORT", "medium") as "low" | "medium" | "high",
  // Zweites Modell, wenn die Positionen nicht zur Bonsumme passen (leer = keine Nachprüfung)
  claudeNachpruefModell: optional("CLAUDE_MODEL_RECHECK"),
  ollamaUrl: env("OLLAMA_URL", "http://localhost:11434"),
  ollamaModell: env("OLLAMA_MODEL", "qwen2.5vl:7b"),

  // Backup (Datenbank + Bon-Ablagen + Schlüssel, verschlüsselt mit BACKUP_PASSWORD).
  // Zeitplan, Anzahl und „mit Bons“ sind nur Startwerte, geändert wird unter Admin-Bereich → Backups
  backup: {
    verzeichnis: env("BACKUP_DIR", path.join(datenVerzeichnis, "backups")),
    passwort: optional("BACKUP_PASSWORD"),
    stunden: Number(env("BACKUP_INTERVAL_HOURS", "24")), // 0 = nur von Hand
    behalten: Math.max(1, Number(env("BACKUP_KEEP", "14"))),
    mitBons: env("BACKUP_INCLUDE_RECEIPTS", "true") === "true",
  },

  // Texterkennung ohne KI-Bildmodell: Tesseract liest den Text, ein Sprachmodell gliedert ihn (Modell: Startwert)
  tesseractSprache: env("TESSERACT_LANG", "deu+eng"),
  textModellAnbieter: env("TEXT_MODEL_PROVIDER", "ollama") as "ollama" | "claude",
  ollamaTextModell: env("OLLAMA_TEXT_MODEL", "qwen2.5:7b"),

  // Benachrichtigungen per E-Mail (SMTP) und Telegram-Bot; ohne Angaben nur die Glocke in der Oberfläche
  smtp: {
    host: optional("SMTP_HOST"),
    port: Number(env("SMTP_PORT", "587")),
    // true = TLS von Anfang an (Port 465), sonst STARTTLS
    sicher: env("SMTP_SECURE", "false") === "true",
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
