import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";
import { t } from "./i18n.js";

// --- Passwörter: Argon2id (in Node eingebaut) ---
type Argon2 = (
  algorithmus: "argon2id",
  parameter: { message: Buffer | string; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number },
  callback: (fehler: Error | null, ergebnis: Buffer) => void,
) => void;
const argon2 = promisify((crypto as unknown as { argon2: Argon2 }).argon2);

const ARGON = { parallelism: 1, tagLength: 32, memory: 65536, passes: 3 }; // 64 MiB, 3 Durchläufe

export async function passwortHashen(passwort: string): Promise<string> {
  const salz = crypto.randomBytes(16);
  const hash = await argon2("argon2id", { message: passwort, nonce: salz, ...ARGON });
  return `argon2id$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${salz.toString("base64")}$${hash.toString("base64")}`;
}

export async function passwortPruefen(passwort: string, gespeichert: string | null): Promise<boolean> {
  // Auch ohne gespeicherten Hash rechnen, damit die Antwortzeit nichts verrät
  const teile = (gespeichert ?? "").split("$");
  const [, param = "", salzB64 = "", hashB64 = ""] = teile.length === 4 ? teile : ["", `m=${ARGON.memory},t=${ARGON.passes},p=1`, crypto.randomBytes(16).toString("base64"), ""];
  const p = Object.fromEntries(param.split(",").map((x) => x.split("=")).map(([k, v]) => [k, Number(v)]));
  const soll = Buffer.from(hashB64, "base64");
  const ist = await argon2("argon2id", {
    message: passwort,
    nonce: Buffer.from(salzB64, "base64"),
    parallelism: p.p || 1,
    tagLength: soll.length || 32,
    memory: p.m || ARGON.memory,
    passes: p.t || ARGON.passes,
  });
  return soll.length > 0 && soll.length === ist.length && crypto.timingSafeEqual(soll, ist);
}

/** Mindestanforderung an neue Passwörter; liefert eine Fehlermeldung oder null */
export function passwortSchwach(passwort: string): string | null {
  if (passwort.length < 10) return t("Das Passwort muss mindestens 10 Zeichen haben.");
  if (/^(.)\1+$/.test(passwort)) return t("Das Passwort ist zu einfach.");
  return null;
}

// --- Zufall und Hashes ---
export const zufall = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

// --- Verschlüsselung gespeicherter Zugangsdaten (AES-256-GCM) ---
let schluessel: Buffer | null = null;

/**
 * Schlüssel aus TILLSPLIT_SCHLUESSEL (bzw. _FILE), sonst einmalig erzeugt und in DATA_DIR abgelegt.
 * Ohne diesen Schlüssel lassen sich gespeicherte Actual-Passwörter und TOTP-Geheimnisse nicht mehr lesen.
 */
function geheimSchluessel(): Buffer {
  if (schluessel) return schluessel;
  let roh = process.env.TILLSPLIT_SCHLUESSEL;
  if (!roh) {
    const datei = path.join(config.datenVerzeichnis, ".schluessel");
    if (!fs.existsSync(datei)) {
      fs.mkdirSync(config.datenVerzeichnis, { recursive: true });
      fs.writeFileSync(datei, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
      console.log(`Neuer Schlüssel für gespeicherte Zugangsdaten angelegt: ${datei} – bitte mitsichern!`);
    }
    roh = fs.readFileSync(datei, "utf8").trim();
  }
  schluessel = crypto.createHash("sha256").update(roh).digest();
  return schluessel;
}

/** Für jeden Zweck ein eigener Schlüssel, abgeleitet vom Hauptschlüssel */
// Ableitungskontext – nach dem ersten Start nicht mehr ändern, sonst lassen sich gespeicherte Geheimnisse und Bons nicht mehr entschlüsseln
const abgeleitet = (zweck: string) => crypto.createHash("sha256").update(`tillsplit:${zweck}:`).update(geheimSchluessel()).digest();

/** Datei des Hauptschlüssels, falls er nicht per TILLSPLIT_SCHLUESSEL kommt (für das Backup) */
export function schluesselRoh(): string {
  geheimSchluessel();
  return process.env.TILLSPLIT_SCHLUESSEL ?? fs.readFileSync(path.join(config.datenVerzeichnis, ".schluessel"), "utf8").trim();
}

// --- Bon-Dateien: "BBENC1" + IV (12) + Tag (16) + verschlüsselter Inhalt ---
const DATEI_KOPF = Buffer.from("BBENC1");
export const istVerschluesselt = (puffer: Buffer) => puffer.subarray(0, 6).equals(DATEI_KOPF);

export function dateiVerschluesseln(puffer: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", abgeleitet("dateien"), iv);
  const daten = Buffer.concat([c.update(puffer), c.final()]);
  return Buffer.concat([DATEI_KOPF, iv, c.getAuthTag(), daten]);
}

export function dateiEntschluesseln(puffer: Buffer): Buffer {
  if (!istVerschluesselt(puffer)) return puffer;
  const d = crypto.createDecipheriv("aes-256-gcm", abgeleitet("dateien"), puffer.subarray(6, 18));
  d.setAuthTag(puffer.subarray(18, 34));
  return Buffer.concat([d.update(puffer.subarray(34)), d.final()]);
}

export function verschluesseln(klartext: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", geheimSchluessel(), iv);
  const daten = Buffer.concat([c.update(klartext, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${daten.toString("base64url")}`;
}

export function entschluesseln(wert: string | null | undefined): string | null {
  if (!wert) return null;
  const [version, iv, tag, daten] = wert.split(".");
  if (version !== "v1") throw new Error("Unbekanntes Format verschlüsselter Daten");
  const d = crypto.createDecipheriv("aes-256-gcm", geheimSchluessel(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(daten, "base64url")), d.final()]).toString("utf8");
}

// --- TOTP (RFC 6238, 30 s, 6 Stellen, SHA-1 – kompatibel mit allen Authenticator-Apps) ---
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(puffer: Buffer): string {
  let bits = 0, wert = 0, aus = "";
  for (const byte of puffer) {
    wert = (wert << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      aus += BASE32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += BASE32[(wert << (5 - bits)) & 31];
  return aus;
}

function base32Lesen(text: string): Buffer {
  const sauber = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, wert = 0;
  const aus: number[] = [];
  for (const z of sauber) {
    wert = (wert << 5) | BASE32.indexOf(z);
    bits += 5;
    if (bits >= 8) {
      aus.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(aus);
}

export const totpGeheimnis = () => base32(crypto.randomBytes(20));

function totpCode(geheimnis: string, schritt: number): string {
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(schritt));
  const h = crypto.createHmac("sha1", base32Lesen(geheimnis)).update(zaehler).digest();
  const o = h[h.length - 1] & 15;
  const zahl = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(zahl % 1_000_000).padStart(6, "0");
}

/** Code prüfen; ±1 Zeitfenster Toleranz für ungenaue Uhren. Liefert das genutzte Zeitfenster (gegen Wiederverwendung). */
export function totpPruefen(geheimnis: string, code: string, zuletztGenutzt = 0): number | null {
  const eingabe = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(eingabe)) return null;
  const jetzt = Math.floor(Date.now() / 30_000);
  for (const s of [jetzt, jetzt - 1, jetzt + 1]) {
    if (s <= zuletztGenutzt) continue;
    const soll = totpCode(geheimnis, s);
    if (crypto.timingSafeEqual(Buffer.from(soll), Buffer.from(eingabe))) return s;
  }
  return null;
}

export const totpUri = (geheimnis: string, konto: string, aussteller = "TillSplit") =>
  `otpauth://totp/${encodeURIComponent(aussteller)}:${encodeURIComponent(konto)}?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}&algorithm=SHA1&digits=6&period=30`;

/** Wiederherstellungscodes im Format xxxx-xxxx-xx (gut abzutippen) */
export function wiederherstellungscodes(anzahl = 10): string[] {
  const zeichen = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: anzahl }, () => {
    const roh = Array.from(crypto.randomBytes(10), (b) => zeichen[b % zeichen.length]).join("");
    return `${roh.slice(0, 4)}-${roh.slice(4, 8)}-${roh.slice(8)}`;
  });
}
export const codeNormalisieren = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
