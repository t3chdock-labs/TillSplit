import fs from "node:fs";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { abgleichPlanen } from "./actual.js";
import { authRouten, ersteinrichtung } from "./auth.js";
import { backupPlanen } from "./backup.js";
import { config } from "./config.js";
import { einstellungLesen, migrieren, sql } from "./db.js";
import { mitSprache, spracheAusKopf, standardSprache, standardSpracheSetzen, t } from "./i18n.js";
import { finanzenPlanen } from "./finanzen.js";
import { adminRouten } from "./routen/admin.js";
import { auswertungRouten } from "./routen/auswertung.js";
import { bonRouten } from "./routen/bons.js";
import { einrichtungRouten } from "./routen/einrichtung.js";
import { finanzRouten } from "./routen/finanzen.js";
import { stammdatenRouten } from "./routen/stammdaten.js";
import { statistikRouten } from "./routen/statistik.js";
import { benachrichtigungRouten } from "./routen/benachrichtigungen.js";
import { benachrichtigungenPlanen } from "./benachrichtigungen.js";
import { waehrungMitKurs } from "./ki/index.js";
import { kurseAktualisieren } from "./kurse.js";
import { offeneWiederaufnehmen } from "./verarbeitung.js";

// Nur Proxys aus dem eigenen Netz dürfen die Client-IP (X-Forwarded-For) setzen – sonst ließe sich die Sperre umgehen
const vertrauteProxys = process.env.TRUST_PROXY ?? "127.0.0.1/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7";

const app = Fastify({
  logger: { level: "info", redact: ["req.headers.cookie", "req.headers.authorization"] },
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: vertrauteProxys,
});

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 15, fields: 10, parts: 30 } });
await app.register(helmet, {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // React setzt Stile als Attribute (Diagramme, Farbpunkte)
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"], // PDF-Vorschau der eigenen Bons
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // HSTS nur, wenn TillSplit per HTTPS läuft
  strictTransportSecurity: (config.oeffentlicheUrl ?? "").startsWith("https:") ? { maxAge: 31536000 } : false,
  referrerPolicy: { policy: "same-origin" },
});
await app.register(rateLimit, {
  global: true,
  max: 600,
  timeWindow: "1 minute",
  allowList: (req) => !req.url.startsWith("/api/"),
  errorResponseBuilder: () => ({ statusCode: 429, fehler: "Zu viele Anfragen – bitte kurz warten" }),
});

// Sprache je Anfrage (x-sprache von der Oberfläche, sonst Accept-Language) – gilt für alle t()-Aufrufe der Anfrage
app.addHook("onRequest", (req, _antwort, weiter) => {
  mitSprache(spracheAusKopf(req.headers["x-sprache"], req.headers["accept-language"]) ?? standardSprache(), weiter);
});
// Fehlermeldungen übersetzen: feste Texte (deutscher Schlüssel) werden hier ersetzt, schon übersetzte bleiben unverändert
app.addHook("preSerialization", async (_req, _antwort, nutzlast: unknown) => {
  if (nutzlast && typeof nutzlast === "object" && typeof (nutzlast as { fehler?: unknown }).fehler === "string") {
    return { ...nutzlast, fehler: t((nutzlast as { fehler: string }).fehler) };
  }
  return nutzlast;
});

// API-Antworten nie zwischenspeichern: sonst zeigen Handy-Browser veraltete Listen, und private Daten bleiben im Cache
app.addHook("onSend", async (req, antwort, nutzlast) => {
  if (req.url.startsWith("/api/") && !antwort.hasHeader("cache-control")) antwort.header("cache-control", "no-store");
  return nutzlast;
});

// Öffentliche Angaben für Fußzeile und Anmeldeseite
const nurHttp = (url?: string) => (url && /^https?:\/\//.test(url) ? url : null);
app.get("/api/info", async () => ({
  version: "0.1.3",
  lizenz: "AGPL-3.0",
  quellcode: nurHttp(config.quellcodeUrl),
  spenden: nurHttp(config.spendenUrl),
  // Anzeigewährung für KI-Kosten (Kurs je US-Dollar, EZB)
  ...(await waehrungMitKurs().catch(() => ({ waehrung: "USD", kurs: 1, stand: null }))),
}));

app.get("/api/gesundheit", async () => {
  await sql`select 1`;
  return { ok: true };
});

// muss vor den Routen-Plugins stehen, sonst erben diese den Standard-Handler
app.setErrorHandler((fehler: Error & { statusCode?: number; extra?: Record<string, unknown>; code?: string }, _req, antwort) => {
  const status = fehler.statusCode && fehler.statusCode >= 400 ? fehler.statusCode : 500;
  if (status >= 500) app.log.error(fehler);
  // Datenbank- und Dateisystemfehler nicht im Wortlaut nach außen geben (Tabellen, Pfade)
  const intern = status >= 500 && fehler.code && (/^[0-9A-Z]{5}$/.test(fehler.code) || /^E[A-Z]+$/.test(fehler.code));
  const text = intern ? (fehler.code === "ENOENT" ? t("Datei nicht gefunden") : t("Interner Fehler")) : fehler.message;
  // fastify-Prüfungen (z. B. ungültiges JSON) liefern englische Texte – die bleiben, wie sie sind
  antwort.code(status).send({ fehler: text, ...(fehler.extra ?? {}) });
});

// Anmeldung prüft jede API-Anfrage -> direkt an der Wurzel, nicht gekapselt
await authRouten(app);
await app.register(bonRouten);
await app.register(stammdatenRouten);
await app.register(auswertungRouten);
await app.register(finanzRouten);
await app.register(adminRouten);
await app.register(einrichtungRouten);
await app.register(statistikRouten);
await app.register(benachrichtigungRouten);

// --- Oberfläche (gebaute PWA) ---
if (fs.existsSync(config.webVerzeichnis)) {
  await app.register(fastifyStatic, {
    root: config.webVerzeichnis,
    wildcard: false,
    setHeaders: (antwort, pfad) => {
      const unveraenderlich = pfad.includes("assets") && /-[A-Za-z0-9_-]{8,}\./.test(pfad);
      antwort.header("cache-control", unveraenderlich ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  app.setNotFoundHandler((req, antwort) => {
    if (req.url.startsWith("/api/")) return antwort.code(404).send({ fehler: "Unbekannte Adresse" });
    return antwort.sendFile("index.html");
  });
}

await migrieren();
// Sprache der Installation (bei der Ersteinrichtung gewählt)
standardSpracheSetzen(await einstellungLesen<string | null>("sprache", null));
await ersteinrichtung();
await app.listen({ host: "0.0.0.0", port: config.port });
await offeneWiederaufnehmen();
// wartende Kartenzahlungen regelmäßig gegen neu importierte Bankbuchungen prüfen
abgleichPlanen(Number(process.env.MATCH_INTERVAL_HOURS ?? 6));
// Actual-Buchungen für das Finanz-Dashboard auffrischen
finanzenPlanen(Number(process.env.FINANCE_INTERVAL_HOURS ?? 3));
// regelmäßige Backups (Zeitplan unter Admin-Bereich → Backups, nur mit BACKUP_PASSWORD)
backupPlanen();
// Benachrichtigungen: gesammelte Mails/Telegram-Nachrichten, Erinnerungen, Telegram-Bot
benachrichtigungenPlanen();
// Wechselkurse beim Start (beim ersten Mal 90 Tage rückwirkend) und danach alle 6 Stunden
void kurseAktualisieren();
setInterval(() => void kurseAktualisieren(), 6 * 3_600_000).unref();
// abgelaufene Sitzungen und Passkey-Anfragen aufräumen
setInterval(() => {
  void sql`delete from sitzungen where laeuft_ab < now()`.catch(() => {});
  void sql`delete from passkey_anfragen where laeuft_ab < now()`.catch(() => {});
}, 3_600_000);
