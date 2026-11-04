import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { config } from "./config.js";
import { sql } from "./db.js";
import { gebiet, standardSprache, t } from "./i18n.js";
import { dateiEntschluesseln, dateiVerschluesseln } from "./sicherheit.js";

const ausfuehren = promisify(execFile);

export type Dateiart = "pdf" | "jpeg" | "png" | "webp" | "heic" | "gif" | "tiff";

/** Dateityp anhand der ersten Bytes erkennen – Endung und Browser-Angabe sind unzuverlässig. */
export function dateiartErkennen(puffer: Buffer): Dateiart | null {
  const kopf = puffer.subarray(0, 16);
  if (kopf.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (kopf[0] === 0xff && kopf[1] === 0xd8) return "jpeg";
  if (kopf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (kopf.subarray(0, 4).toString("latin1") === "RIFF" && kopf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (kopf.subarray(0, 3).toString("latin1") === "GIF") return "gif";
  if (kopf.subarray(0, 4).toString("latin1") === "II*\0" || kopf.subarray(0, 4).toString("latin1") === "MM\0*") return "tiff";
  if (kopf.subarray(4, 8).toString("latin1") === "ftyp") {
    const marke = kopf.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "avif"].includes(marke)) return "heic";
  }
  return null;
}

export const mimeVon: Record<Dateiart, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
  tiff: "image/tiff",
};

export const sha256 = (puffer: Buffer) => crypto.createHash("sha256").update(puffer).digest("hex");

async function mitTempVerzeichnis<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tillsplit-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** HEIC/HEIF (iPhone) -> JPEG über heif-convert (libheif), da sharp-Binaries kein HEVC dekodieren. */
async function heicZuJpeg(puffer: Buffer): Promise<Buffer> {
  return mitTempVerzeichnis(async (dir) => {
    const ein = path.join(dir, "ein.heic");
    const aus = path.join(dir, "aus.jpg");
    await fs.writeFile(ein, puffer);
    await ausfuehren("heif-convert", ["-q", "92", ein, aus]);
    return fs.readFile(aus);
  });
}

/**
 * Hochgeladene Datei in ein Ablageformat bringen: PDFs bleiben PDFs,
 * alle Bilder werden zu einem gedrehten (EXIF) JPEG in voller Auflösung.
 */
export async function fuerAblageAufbereiten(puffer: Buffer, art: Dateiart): Promise<{ puffer: Buffer; art: "pdf" | "jpeg" }> {
  if (art === "pdf") return { puffer, art: "pdf" };
  const quelle = art === "heic" ? await heicZuJpeg(puffer) : puffer;
  const jpeg = await sharp(quelle, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { puffer: jpeg, art: "jpeg" };
}

/** PDF-Seiten als PNG rendern (für Ollama, das keine PDFs liest). */
export async function pdfZuBildern(puffer: Buffer, dpi = 170): Promise<Buffer[]> {
  return mitTempVerzeichnis(async (dir) => {
    const ein = path.join(dir, "bon.pdf");
    await fs.writeFile(ein, puffer);
    await ausfuehren("pdftoppm", ["-r", String(dpi), "-png", "-l", "6", ein, path.join(dir, "seite")]);
    const seiten = (await fs.readdir(dir)).filter((d) => d.startsWith("seite")).sort();
    return Promise.all(seiten.map((s) => fs.readFile(path.join(dir, s))));
  });
}

/**
 * Bild für die KI vorbereiten. Kassenbons sind lang und schmal – würde man sie
 * als Ganzes verkleinern, wäre die Schrift unlesbar. Deshalb wird auf eine
 * lesbare Breite skaliert und in überlappende Abschnitte zerlegt.
 */
export async function fuerKiZerlegen(puffer: Buffer): Promise<Buffer[]> {
  const breiteZiel = 1000;
  const abschnittHoehe = 1400;
  const ueberlappung = 80;

  const skaliert = await sharp(puffer, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: breiteZiel, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer({ resolveWithObject: true });

  const { width, height } = skaliert.info;
  if (height <= abschnittHoehe * 1.25) return [skaliert.data];

  const teile: Buffer[] = [];
  for (let oben = 0; oben < height; oben += abschnittHoehe - ueberlappung) {
    const hoehe = Math.min(abschnittHoehe, height - oben);
    if (hoehe < ueberlappung * 2 && teile.length > 0) break;
    teile.push(
      await sharp(skaliert.data).extract({ left: 0, top: oben, width, height: hoehe }).jpeg({ quality: 88 }).toBuffer(),
    );
    if (oben + hoehe >= height) break;
  }
  return teile;
}

function dateinameTeil(text: string, max = 40): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .replace(/[^A-Za-z0-9,.]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, max) || t("Unbekannt", undefined, standardSprache())
  );
}

const innerhalb = (pfad: string, wurzel: string) => {
  const w = path.resolve(wurzel);
  const p = path.resolve(pfad);
  return p === w || p.startsWith(w + path.sep);
};

/**
 * Ablagepfad eines Haushalts prüfen: relativ = Unterordner von RECEIPT_DIR,
 * absolut nur innerhalb von RECEIPT_DIR oder STORAGE_ROOTS (kein Schreiben an beliebige Stellen).
 */
export function ablagePruefen(eingabe: string): string {
  const pfad = eingabe.trim();
  if (pfad === "") return "";
  if (path.isAbsolute(pfad)) {
    if (![config.bonVerzeichnis, ...config.ablageWurzeln].some((w) => innerhalb(pfad, w))) {
      throw new Error(t("Absolute Pfade nur innerhalb von {wurzeln}", { wurzeln: [config.bonVerzeichnis, ...config.ablageWurzeln].join(", ") }));
    }
    return path.resolve(pfad);
  }
  if (!innerhalb(path.join(config.bonVerzeichnis, pfad), config.bonVerzeichnis)) throw new Error("Ungültiger Ordnername");
  return path.normalize(pfad).replace(/\\/g, "/");
}

// --- Vorlage für Ordner und Dateinamen ---
export const VORLAGE_STANDARD = "{Jahr}/{Monat}/{Datum}_{Händler}_{Summe}";
export const BAUSTEINE = ["Jahr", "Monat", "Monatsname", "Tag", "Datum", "Händler", "Summe", "Zahlung", "Hochgeladen", "Haushalt", "Bon"] as const;
type Baustein = (typeof BAUSTEINE)[number];
// Monatsnamen im Dateinamen in der Sprache der Installation (die Bausteine selbst heißen immer deutsch)
const monatsname = (monat: number) =>
  standardSprache() === "de"
    ? ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][monat - 1]
    : new Intl.DateTimeFormat(gebiet(standardSprache()), { month: "long" }).format(new Date(2026, monat - 1, 1));

/** Vorlage prüfen: nur bekannte Bausteine, erlaubte Zeichen, keine leeren Ordner, Dateiname eindeutig genug */
export function vorlagePruefen(eingabe: string): string {
  const vorlage = eingabe.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  if (!vorlage || vorlage.length > 200) throw new Error("Die Vorlage ist leer oder zu lang");
  for (const [, name] of vorlage.matchAll(/\{([^}]*)\}/g)) {
    if (!BAUSTEINE.includes(name as Baustein)) throw new Error(t("Unbekannter Baustein {baustein}", { baustein: `{${name}}` }));
  }
  const ohneBausteine = vorlage.replace(/\{[^}]*\}/g, "");
  if (/[^A-Za-z0-9 _.,\-/äöüÄÖÜß]/.test(ohneBausteine)) throw new Error("Erlaubt sind nur Buchstaben, Ziffern, Leerzeichen und - _ . ,");
  const teile = vorlage.split("/");
  if (teile.some((t) => !t.trim() || t.trim() === "." || t.trim() === "..")) throw new Error("Leere oder ungültige Ordnernamen");
  if (teile.length > 6) throw new Error("Höchstens 5 Ordnerebenen");
  if (!/\{/.test(teile[teile.length - 1])) throw new Error("Der Dateiname (letzter Teil) braucht mindestens einen Baustein");
  return vorlage;
}

export type AblageWerte = { datum: string | null; haendler: string | null; summeCent: number | null; zahlung: string | null; hochgeladen: string | null; haushalt: string; bonId: number };

/** Relativer Pfad (ohne Endung) aus Vorlage und Werten; jeder Teil wird dateisystemtauglich gemacht */
export function pfadAusVorlage(vorlage: string, w: AblageWerte): string {
  const tag = w.datum ?? new Date().toISOString().slice(0, 10);
  const [jahr, monat, tagImMonat] = tag.split("-");
  const s = standardSprache();
  const unbekannt = t("Unbekannt", undefined, s);
  const werte: Record<Baustein, string> = {
    Jahr: jahr,
    Monat: monat,
    Monatsname: `${monat}-${monatsname(Number(monat)) ?? monat}`,
    Tag: tagImMonat,
    Datum: tag,
    Händler: dateinameTeil(w.haendler ?? unbekannt),
    Summe: w.summeCent == null ? "" : (w.summeCent / 100).toFixed(2).replace(".", standardSprache() === "de" ? "," : "."),
    Zahlung: w.zahlung === "bar" ? t("Bar", undefined, s) : w.zahlung === "karte" ? t("Karte", undefined, s) : unbekannt,
    Hochgeladen: dateinameTeil(w.hochgeladen ?? unbekannt, 30),
    Haushalt: dateinameTeil(w.haushalt, 30),
    Bon: String(w.bonId),
  };
  return vorlage
    .split("/")
    .map((teil) => {
      const ersetzt = teil.replace(/\{([^}]*)\}/g, (_, n: Baustein) => werte[n] ?? "");
      // leere Bausteine hinterlassen keine doppelten oder hängenden Trenner
      const sauber = ersetzt.replace(/[^A-Za-z0-9 _.,\-äöüÄÖÜß]/g, "-").replace(/([_\- ])[_\- ]+/g, "$1").replace(/^[_\- .]+|[_\- .]+$/g, "");
      return sauber.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").slice(0, 80) || unbekannt;
    })
    .join("/");
}

export type Ablage = { wurzel: string; vorlage: string; verschluesseln: boolean };
const ablageCache = new Map<number, Ablage>();
export const ablageCacheLeeren = () => ablageCache.clear();

/** Ablage eines Haushalts: Verzeichnis, Vorlage, Verschlüsselung */
export async function ablageVon(haushaltId: number): Promise<Ablage> {
  const vorhanden = ablageCache.get(haushaltId);
  if (vorhanden) return vorhanden;
  const [h] = await sql<{ ablage_pfad: string; ablage_vorlage: string; verschluesseln: boolean }[]>`
    select ablage_pfad, ablage_vorlage, verschluesseln from haushalte where id = ${haushaltId}`;
  if (!h) throw new Error("Haushalt nicht gefunden");
  const wurzel = h.ablage_pfad === "" ? config.bonVerzeichnis : path.isAbsolute(h.ablage_pfad) ? h.ablage_pfad : path.join(config.bonVerzeichnis, h.ablage_pfad);
  const ablage = { wurzel, vorlage: h.ablage_vorlage || VORLAGE_STANDARD, verschluesseln: h.verschluesseln };
  ablageCache.set(haushaltId, ablage);
  return ablage;
}

/** Gespeicherten Pfad eines Bons auflösen: "eingang/…" liegt in DATA_DIR, alles andere in der Ablage des Haushalts */
export function absoluterPfad(relativ: string, ablage: Ablage | string): string {
  const wurzel = typeof ablage === "string" ? ablage : ablage.wurzel;
  const basis = relativ.startsWith("eingang/") ? path.dirname(config.eingangVerzeichnis) : wurzel;
  const voll = path.resolve(basis, relativ);
  if (!innerhalb(voll, basis)) throw new Error("Ungültiger Pfad");
  return voll;
}

/** Datei lesen; verschlüsselte Dateien (an der Kennung erkannt) werden entschlüsselt */
export async function dateiLesen(pfad: string): Promise<Buffer> {
  return dateiEntschluesseln(await fs.readFile(pfad));
}

export async function dateiSchreiben(pfad: string, inhalt: Buffer, verschluesseln: boolean): Promise<void> {
  await fs.mkdir(path.dirname(pfad), { recursive: true });
  await fs.writeFile(pfad, verschluesseln ? dateiVerschluesseln(inhalt) : inhalt, { mode: 0o640 });
}

/**
 * Bon nach der Vorlage seines Haushalts ablegen bzw. umbenennen (nach Erkennung und nach Korrekturen).
 * Verschlüsselte Dateien bekommen die Endung .enc. Bei Namensgleichheit _2, _3 …
 */
export async function bonAblegen(bonId: number): Promise<void> {
  const [b] = await sql<{
    haushalt_id: number; datei_pfad: string; datei_mime: string; verschluesselt: boolean; datum: string | null;
    haendler: string | null; summe_cent: number | null; zahlung: string; hochgeladen: string | null; haushalt: string;
  }[]>`
    select b.haushalt_id, b.datei_pfad, b.datei_mime, b.verschluesselt, to_char(b.datum, 'YYYY-MM-DD') as datum,
           h.name as haendler, b.summe_cent, b.zahlung, u.name as hochgeladen, hh.name as haushalt
      from bons b left join haendler h on h.id = b.haendler_id left join benutzer u on u.id = b.hochgeladen_von
      join haushalte hh on hh.id = b.haushalt_id
     where b.id = ${bonId}`;
  if (!b) return;
  const ablage = await ablageVon(b.haushalt_id);
  const quelle = absoluterPfad(b.datei_pfad, ablage);
  const basis = pfadAusVorlage(ablage.vorlage, {
    datum: b.datum, haendler: b.haendler, summeCent: b.summe_cent, zahlung: b.zahlung, hochgeladen: b.hochgeladen, haushalt: b.haushalt, bonId,
  });
  const endung = (b.datei_mime === "application/pdf" ? "pdf" : "jpg") + (b.verschluesselt ? ".enc" : "");

  for (let n = 1; n < 1000; n++) {
    const relativ = `${basis}${n > 1 ? "_" + n : ""}.${endung}`;
    const ziel = absoluterPfad(relativ, ablage);
    if (path.resolve(quelle) === path.resolve(ziel)) return;
    try {
      await fs.access(ziel);
    } catch {
      await fs.mkdir(path.dirname(ziel), { recursive: true });
      // rename klappt nicht über Dateisystemgrenzen (NFS) -> kopieren + löschen
      await fs.copyFile(quelle, ziel);
      await sql`update bons set datei_pfad = ${relativ} where id = ${bonId}`;
      await fs.rm(quelle, { force: true });
      return;
    }
  }
}

/** Alle Bons eines Haushalts neu ablegen (nach geänderter Vorlage) bzw. ver-/entschlüsseln */
export async function haushaltNeuAblegen(haushaltId: number, verschluesseln?: boolean): Promise<{ bons: number; fehler: number }> {
  const ablage = await ablageVon(haushaltId);
  const bons = await sql<{ id: number; datei_pfad: string; verschluesselt: boolean }[]>`
    select id, datei_pfad, verschluesselt from bons where haushalt_id = ${haushaltId} and datei_pfad not like 'eingang/%' order by id`;
  let fehler = 0;
  for (const b of bons) {
    try {
      if (verschluesseln !== undefined && b.verschluesselt !== verschluesseln) {
        const pfad = absoluterPfad(b.datei_pfad, ablage);
        const inhalt = await dateiLesen(pfad);
        const neuRelativ = verschluesseln ? `${b.datei_pfad}.enc` : b.datei_pfad.replace(/\.enc$/, "");
        await dateiSchreiben(absoluterPfad(neuRelativ, ablage), inhalt, verschluesseln);
        await sql`update bons set datei_pfad = ${neuRelativ}, verschluesselt = ${verschluesseln} where id = ${b.id}`;
        if (neuRelativ !== b.datei_pfad) await fs.rm(pfad, { force: true });
      }
      await bonAblegen(b.id);
    } catch (e) {
      fehler++;
      console.error(`Bon ${b.id} neu ablegen:`, (e as Error).message);
    }
  }
  return { bons: bons.length, fehler };
}