/**
 * Übersetzungen der Oberfläche.
 *
 * Der deutsche Text ist zugleich der Schlüssel: t("Bon speichern") liefert auf Deutsch den Text selbst,
 * in anderen Sprachen den Eintrag aus sprachen/<code>.json (fehlt er, bleibt der deutsche Text stehen).
 * Platzhalter in geschweiften Klammern: t("{n} Bons offen", { n: 3 }).
 * Mehrzahl mit "|": t("{n} Bon|{n} Bons", { n }). Die Formen folgen den Mehrzahl-Kategorien der Sprache
 * (Intl.PluralRules, Reihenfolge zero|one|two|few|many|other, nur die vorhandenen) – Deutsch/Englisch: one|other,
 * Polnisch: one|few|many|other.
 *
 * Neue Sprache: sprachen/en.json nach sprachen/<code>.json kopieren, "@sprache" (Anzeigename) und die Werte
 * übersetzen – sie erscheint dann automatisch in der Auswahl. Prüfen mit werkzeuge/texte-pruefen.mjs.
 * Die Sprache wird beim Laden festgelegt; ein Wechsel lädt die Seite neu.
 */

const dateien = import.meta.glob<{ default: Record<string, string> }>("./sprachen/*.json", { eager: true });
const WOERTERBUECHER: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(dateien).map(([pfad, m]) => [pfad.match(/([\w-]+)\.json$/)![1], m.default]),
);

export type Sprache = string;
export const SPRACHEN: { code: Sprache; name: string }[] = [
  { code: "de", name: "Deutsch" },
  ...Object.entries(WOERTERBUECHER)
    .map(([code, w]) => ({ code, name: w["@sprache"] || code }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];
const SPEICHER = "tillsplit:sprache";

const gueltig = (s: unknown): boolean => typeof s === "string" && SPRACHEN.some((x) => x.code === s);

function ermitteln(): Sprache {
  try {
    const gespeichert = localStorage.getItem(SPEICHER);
    if (gespeichert && gueltig(gespeichert)) return gespeichert;
  } catch {
    // kein Speicher (privates Fenster) -> Browsersprache
  }
  for (const s of navigator.languages ?? [navigator.language]) {
    const code = s.toLowerCase();
    if (gueltig(code)) return code;
    if (gueltig(code.slice(0, 2))) return code.slice(0, 2);
  }
  return gueltig("en") ? "en" : "de";
}

const aktuell: Sprache = ermitteln();
document.documentElement.lang = aktuell;

export const sprache = (): Sprache => aktuell;

/** Gebietsschema für Zahlen und Datum (Regionalvariante aus dem Browser, wenn sie zur Sprache passt) */
export const gebiet = (): string => {
  if (aktuell === "de") return "de-DE";
  const browser = navigator.languages?.find((s) => s.toLowerCase().startsWith(aktuell + "-"));
  return browser ?? (aktuell === "en" ? "en-GB" : aktuell);
};

/** Sprache wechseln: merken und Seite neu laden (Texte auf Modulebene werden beim Laden übersetzt) */
export function spracheSetzen(neu: string, neuLaden = true): void {
  if (!gueltig(neu)) return;
  try {
    localStorage.setItem(SPEICHER, neu);
  } catch {
    // ohne Speicher gilt die Wahl nur bis zum Neuladen
  }
  if (neuLaden && neu !== aktuell) window.location.reload();
}

const woerterbuch = WOERTERBUECHER[aktuell] ?? null;
// Mehrzahl-Kategorien der Sprache in fester Reihenfolge
const REIHENFOLGE = ["zero", "one", "two", "few", "many", "other"];
const mehrzahl = new Intl.PluralRules(gebiet());
const kategorien = REIHENFOLGE.filter((k) => mehrzahl.resolvedOptions().pluralCategories.includes(k as Intl.LDMLPluralRule));

function form(formen: string[], n: number): string {
  // Deutscher Schlüssel (kein Wörterbucheintrag) hat immer Einzahl|Mehrzahl
  if (formen.length === 2 && (!woerterbuch || kategorien.length === 2)) return n === 1 ? formen[0] : formen[1];
  const i = kategorien.indexOf(mehrzahl.select(n));
  return formen[i] ?? formen[formen.length - 1];
}

export function t(text: string, werte?: Record<string, string | number | null | undefined>): string {
  const uebersetzt = woerterbuch?.[text];
  let ergebnis = uebersetzt || text;
  if (ergebnis.includes("|")) {
    const n = Number(werte?.n ?? 1);
    ergebnis = uebersetzt ? form(ergebnis.split("|"), n) : (n === 1 ? text.split("|")[0] : text.split("|")[1]) ?? ergebnis;
  }
  if (!werte) return ergebnis;
  return ergebnis.replace(/\{(\w+)\}/g, (ganz, name: string) => (werte[name] == null ? ganz : String(werte[name])));
}
