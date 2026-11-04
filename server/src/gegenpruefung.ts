/**
 * Gegenprüfung: Passen Bild und erkannte Daten zusammen?
 *
 * Tesseract (lokal, kostenlos) liest das Bild unabhängig von der KI. Kommen weder das erkannte Geschäft noch
 * die Summe im gelesenen Text vor, bekommt der Bon einen Hinweis – etwa wenn Daten und Bild vertauscht wären
 * oder die KI ein ganz anderes Geschäft „gesehen“ hat. Der Text wird gespeichert, damit nach einer Korrektur
 * von Geschäft oder Summe ohne erneutes Lesen nachgeprüft werden kann.
 */
import { sql } from "./db.js";
import type { KiEingabe } from "./ki/index.js";
import { belegTextLesen, bildLesen } from "./ki/tesseract.js";

export type Gegenpruefung = "ok" | "abweichung" | "unbekannt";

/** Kleinbuchstaben ohne Akzente/Umlaute (ä -> a), damit OCR- und KI-Schreibweisen vergleichbar werden */
const normal = (s: string) =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

function abstand(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let vorher = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const zeile = [i];
    for (let j = 1; j <= b.length; j++) zeile[j] = Math.min(vorher[j] + 1, zeile[j - 1] + 1, vorher[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    vorher = zeile;
  }
  return vorher[b.length];
}

/** Kommt das Geschäft im Text vor? Längere Namensteile dürfen einen Lesefehler haben (Philipps ~ Phllipps) */
export function haendlerGefunden(text: string, haendler: string): boolean {
  const woerter = new Set(normal(text).split(/[^a-z0-9]+/).filter((w) => w.length >= 2));
  const teile = normal(haendler)
    .split(/[^a-z0-9]+/)
    // Rechtsformen und Allerweltswörter sagen nichts über das Geschäft
    .filter((w) => w.length >= 2 && !["gmbh", "co", "kg", "se", "ag", "und", "markt", "der", "die", "das"].includes(w));
  if (!teile.length) return false;
  return teile.some((teil) => {
    if (woerter.has(teil)) return true;
    if (teil.length < 5) return false;
    for (const w of woerter) if (abstand(w, teil, 1) <= 1) return true;
    return false;
  });
}

/** Kommt die Summe im Text vor? (6,72 / 6.72 / 6, 72 – OCR setzt gern Leerzeichen) */
export function summeGefunden(text: string, summeCent: number): boolean {
  const euro = Math.trunc(Math.abs(summeCent) / 100);
  const cent = String(Math.abs(summeCent) % 100).padStart(2, "0");
  const tausender = euro >= 1000 ? `${Math.trunc(euro / 1000)}[.' ]?${String(euro % 1000).padStart(3, "0")}` : String(euro);
  return new RegExp(`(^|[^0-9])(${tausender}|${euro})\\s*[,.]\\s*${cent}([^0-9]|$)`).test(text);
}

/** Anzahl lesbarer Beträge (z,zz) – Maß dafür, ob Tesseract das Bild überhaupt brauchbar lesen konnte */
const betraege = (text: string) => (text.match(/\d+\s?[,.]\s?\d{2}(?!\d)/g) ?? []).length;

/**
 * Bewertung aus gelesenem Text und erkannten Daten:
 * 1. kaum Beträge lesbar -> nicht prüfbar (keine Warnung, kein Fehlalarm bei schwer lesbaren Fotos)
 * 2. erkanntes Geschäft im Text -> ok
 * 3. ein anderes bekanntes Geschäft im Text -> Abweichung (Summe allein reicht dann nicht, sie kommt
 *    in langen Bons leicht zufällig vor, etwa in der Mehrwertsteuer-Zeile)
 * 4. Summe im Text -> ok, sonst nicht prüfbar (Tesseract überliest Summen und Logos zu oft für eine Warnung)
 */
export function bewerten(text: string | null, haendler: string | null, summeCent: number | null, bekannte: string[] = []): Gegenpruefung {
  if (!text || betraege(text) < 3) return "unbekannt";
  if (haendler && haendlerGefunden(text, haendler)) return "ok";
  const eigene = new Set(normal(haendler ?? "").split(/[^a-z0-9]+/));
  const andere = bekannte.filter((name) => {
    const teile = normal(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    // kurze Namen (dm, OBI) und solche mit gemeinsamen Teilen (EDEKA / EDEKA Center) nicht als „anderes Geschäft“ werten
    return teile.length > 0 && !teile.some((w) => eigene.has(w)) && haendlerGefunden(text, name);
  });
  if (andere.length) return "abweichung";
  return summeCent != null && summeGefunden(text, summeCent) ? "ok" : "unbekannt";
}

// bekannte Geschäfte (aus bisherigen Bons) für Regel 3, kurz zwischengespeichert
let bekannteCache: { namen: string[]; bis: number } | null = null;
export async function bekannteHaendler(): Promise<string[]> {
  if (bekannteCache && bekannteCache.bis > Date.now()) return bekannteCache.namen;
  const namen = (await sql<{ name: string }[]>`select distinct h.name from haendler h join bons b on b.haendler_id = h.id`).map((h) => h.name);
  bekannteCache = { namen, bis: Date.now() + 5 * 60_000 };
  return namen;
}

/** Nach einer Korrektur von Geschäft oder Summe mit dem gespeicherten Text neu bewerten (ohne erneutes Lesen) */
export async function gegenpruefungAktualisieren(bonId: number): Promise<void> {
  const [b] = await sql<{ pruef_text: string | null; haendler: string | null; summe_cent: number | null }[]>`
    select b.pruef_text, h.name as haendler, b.summe_cent from bons b left join haendler h on h.id = b.haendler_id where b.id = ${bonId}`;
  if (!b || b.pruef_text == null) return;
  await sql`update bons set gegenpruefung = ${bewerten(b.pruef_text, b.haendler, b.summe_cent, await bekannteHaendler())} where id = ${bonId}`;
}

/** Bild/PDF lesen; ohne Tesseract (z. B. Entwicklung unter Windows) null statt Fehler */
export async function textFuerPruefung(eingabe: KiEingabe): Promise<string | null> {
  try {
    const lesen = async () => {
      // PDF: Textebene bzw. Seiten wie gehabt
      if (eingabe.art !== "bilder") return belegTextLesen(eingabe);
      const bild = eingabe.original ?? eingabe.bilder[0];
      // ein Textblock (psm 6) liest Bon-Schrift im Test am zuverlässigsten; ist das Ergebnis dürftig,
      // zusätzlich mit harter Schwarz-Weiß-Schwelle (graues, zerknittertes Papier)
      let text = await bildLesen(bild, { psm: "6" });
      if (betraege(text) < 5) text += "\n" + (await bildLesen(bild, { psm: "6", schwelle: 150 }));
      return text;
    };
    const text = await Promise.race([lesen(), new Promise<never>((_, nein) => setTimeout(() => nein(new Error("Zeitüberschreitung")), 120_000))]);
    return text.slice(0, 20_000);
  } catch (fehler) {
    console.warn("Gegenprüfung nicht möglich:", (fehler as Error).message);
    return null;
  }
}
