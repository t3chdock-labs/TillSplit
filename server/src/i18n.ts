import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";

/**
 * Übersetzungen für Meldungen des Servers – wie in der Oberfläche ist der deutsche Text der Schlüssel,
 * andere Sprachen stehen in server/sprachen/<code>.json (jede Datei dort ist automatisch eine Sprache,
 * "@sprache" ist ihr Anzeigename).
 *
 * Sprache einer Anfrage: Kopfzeile x-sprache (setzt die Oberfläche), sonst Accept-Language.
 * Ohne Anfrage (Hintergrundarbeit: Bon lesen, Abgleich) gilt die Sprache der Installation
 * (bei der Ersteinrichtung gewählt, unter Einstellungen änderbar, Vorgabe TILLSPLIT_LANGUAGE).
 */
export type Sprache = string;

const verzeichnis = new URL("../sprachen/", import.meta.url);
const woerterbuecher: Record<Sprache, Record<string, string> | null> = { de: null };
for (const datei of fs.existsSync(verzeichnis) ? fs.readdirSync(verzeichnis) : []) {
  const code = datei.match(/^([\w-]+)\.json$/)?.[1];
  if (!code || code === "de") continue;
  try {
    woerterbuecher[code] = JSON.parse(fs.readFileSync(new URL(datei, verzeichnis), "utf8").replace(/^\uFEFF/, ""));
  } catch (fehler) {
    console.warn(`Übersetzung ${datei} nicht lesbar:`, (fehler as Error).message);
  }
}

export const SPRACHEN: Sprache[] = Object.keys(woerterbuecher);
export const SPRACH_NAMEN: Record<Sprache, string> = Object.fromEntries(
  SPRACHEN.map((s) => [s, s === "de" ? "Deutsch" : woerterbuecher[s]?.["@sprache"] || s]),
);

const gueltig = (s: unknown): boolean => typeof s === "string" && s in woerterbuecher;

// eigenständig gelesen (i18n lädt ohne config.ts); TILLSPLIT_SPRACHE ist der frühere Name
const vorgabe = process.env.TILLSPLIT_LANGUAGE ?? process.env.TILLSPLIT_SPRACHE;
let standard: Sprache = gueltig(vorgabe) ? vorgabe! : "de";
/** Sprache der Installation (aus der Datenbank, beim Start und bei Änderung gesetzt) */
export const standardSpracheSetzen = (s: unknown) => {
  if (gueltig(s)) standard = s as Sprache;
};
export const standardSprache = (): Sprache => standard;
export const spracheGueltig = gueltig;

const kontext = new AsyncLocalStorage<Sprache>();

/** Sprache aus x-sprache bzw. Accept-Language ermitteln */
export function spracheAusKopf(xSprache: unknown, acceptLanguage: unknown): Sprache | null {
  if (gueltig(xSprache)) return xSprache as Sprache;
  if (typeof acceptLanguage === "string") {
    for (const teil of acceptLanguage.split(",")) {
      const code = teil.split(";")[0].trim().toLowerCase();
      if (gueltig(code)) return code;
      if (gueltig(code.slice(0, 2))) return code.slice(0, 2);
    }
  }
  return null;
}

/** Code in einer bestimmten Sprache ausführen (Anfrage, Benachrichtigung an einen Benutzer …) */
export const mitSprache = <T>(s: Sprache, fn: () => T): T => kontext.run(s, fn);
export const sprache = (): Sprache => kontext.getStore() ?? standard;

/** Gebietsschema für Zahlen und Beträge */
export const gebiet = (s = sprache()) => (s === "de" ? "de-DE" : s === "en" ? "en-GB" : s);

// Mehrzahl: Formen in der Reihenfolge der Kategorien der Sprache (Deutsch/Englisch one|other)
const REIHENFOLGE = ["zero", "one", "two", "few", "many", "other"];
const regeln = new Map<Sprache, { regel: Intl.PluralRules; kategorien: string[] }>();
function mehrzahlForm(formen: string[], n: number, s: Sprache): string {
  let r = regeln.get(s);
  if (!r) {
    const regel = new Intl.PluralRules(gebiet(s));
    const vorhanden: string[] = regel.resolvedOptions().pluralCategories;
    r = { regel, kategorien: REIHENFOLGE.filter((k) => vorhanden.includes(k)) };
    regeln.set(s, r);
  }
  return formen[r.kategorien.indexOf(r.regel.select(n))] ?? formen[formen.length - 1];
}

export function t(text: string, werte?: Record<string, string | number | null | undefined>, s = sprache()): string {
  const uebersetzt = woerterbuecher[s]?.[text];
  let ergebnis = uebersetzt || text;
  if (ergebnis.includes("|")) {
    const n = Number(werte?.n ?? 1);
    const formen = ergebnis.split("|");
    // deutscher Schlüssel hat immer Einzahl|Mehrzahl
    ergebnis = uebersetzt ? mehrzahlForm(formen, n, s) : (n === 1 ? formen[0] : formen[1]) ?? formen[0];
  }
  if (!werte) return ergebnis;
  return ergebnis.replace(/\{(\w+)\}/g, (ganz, name: string) => (werte[name] == null ? ganz : String(werte[name])));
}

/**
 * Datumsformat für to_char() in SQL, aus Intl abgeleitet (de: DD.MM.YYYY, en-GB: DD/MM/YYYY, fr: DD/MM/YYYY,
 * nl: DD-MM-YYYY, en-US: MM/DD/YYYY …), optional mit Uhrzeit
 */
const formate = new Map<string, string>();
export function datumFormat(mitZeit = false, sekunden = false, s = sprache()): string {
  let f = formate.get(s);
  if (!f) {
    const teile = new Intl.DateTimeFormat(gebiet(s), { day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date(2026, 10, 3));
    f = teile
      .map((p) => (p.type === "day" ? "DD" : p.type === "month" ? "MM" : p.type === "year" ? "YYYY" : p.value.replace(/[A-Za-z"\\]/g, "")))
      .join("");
    formate.set(s, f);
  }
  return f + (mitZeit ? (sekunden ? " HH24:MI:SS" : " HH24:MI") : "");
}

/** Name der Sprache für KI-Anweisungen ("Deutsch", "English", "Français" …) */
export const sprachName = (s = standard) => SPRACH_NAMEN[s] ?? s;
