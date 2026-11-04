import { datum, iso, monatsNamen, tagMonat, tageKurzAbSonntag } from "./format";
import { t } from "./i18n";

export type Ansicht = "woche" | "monat" | "jahr" | "alles" | "frei";
export type Raster = "tag" | "woche" | "monat" | "jahr";
export type Bereich = { von?: string; bis?: string };

const monateLang = monatsNamen("long");
const monateKurz = monatsNamen("short");
const tageKurz = tageKurzAbSonntag();

/** "2026-11-02" -> lokales Datum */
export const ausIso = (s: string) => {
  const [j, m, tg] = s.slice(0, 10).split("-").map(Number);
  return new Date(j, m - 1, tg);
};

const plusTage = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const montag = (d: Date) => plusTage(d, -((d.getDay() + 6) % 7));

/** ISO-Kalenderwoche */
export function kalenderwoche(d: Date) {
  const donnerstag = plusTage(montag(d), 3);
  const ersterJan = new Date(donnerstag.getFullYear(), 0, 1);
  return Math.floor((donnerstag.getTime() - ersterJan.getTime()) / 86_400_000 / 7) + 1;
}

export function bereichVon(ansicht: Ansicht, anker: Date, frei: Bereich): Bereich {
  const j = anker.getFullYear();
  const m = anker.getMonth();
  switch (ansicht) {
    case "woche": {
      const mo = montag(anker);
      return { von: iso(mo), bis: iso(plusTage(mo, 6)) };
    }
    case "monat":
      return { von: iso(new Date(j, m, 1)), bis: iso(new Date(j, m + 1, 0)) };
    case "jahr":
      return { von: `${j}-01-01`, bis: `${j}-12-31` };
    case "frei":
      return frei;
    default:
      return {};
  }
}

export function verschieben(ansicht: Ansicht, anker: Date, schritte: number): Date {
  if (ansicht === "woche") return plusTage(anker, 7 * schritte);
  if (ansicht === "monat") return new Date(anker.getFullYear(), anker.getMonth() + schritte, 1);
  if (ansicht === "jahr") return new Date(anker.getFullYear() + schritte, 0, 1);
  return anker;
}

export function titelVon(ansicht: Ansicht, anker: Date, bereich: Bereich): string {
  switch (ansicht) {
    case "woche": {
      const von = ausIso(bereich.von!);
      const bis = ausIso(bereich.bis!);
      const vonText = von.getFullYear() === bis.getFullYear() ? tagMonat(bereich.von!) : datum(bereich.von);
      return `${t("KW {kw}", { kw: kalenderwoche(von) })} · ${vonText}–${datum(bereich.bis)}`;
    }
    case "monat":
      return `${monateLang[anker.getMonth()]} ${anker.getFullYear()}`;
    case "jahr":
      return String(anker.getFullYear());
    case "frei":
      return bereich.von && bereich.bis ? `${datum(bereich.von)} – ${datum(bereich.bis)}` : t("Zeitraum wählen");
    default:
      return t("Gesamter Zeitraum");
  }
}

/** Sinnvolle Einteilung für den Verlauf */
export function autoRaster(ansicht: Ansicht, bereich: Bereich): Raster {
  if (ansicht === "woche" || ansicht === "monat") return "tag";
  if (ansicht === "jahr" || ansicht === "alles") return "monat";
  if (!bereich.von || !bereich.bis) return "monat";
  const tage = (ausIso(bereich.bis).getTime() - ausIso(bereich.von).getTime()) / 86_400_000;
  return tage <= 45 ? "tag" : tage <= 200 ? "woche" : tage <= 1100 ? "monat" : "jahr";
}

const periodenStart = (d: Date, r: Raster) =>
  r === "tag" ? d : r === "woche" ? montag(d) : r === "monat" ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date(d.getFullYear(), 0, 1);

const naechste = (d: Date, r: Raster) =>
  r === "tag"
    ? plusTage(d, 1)
    : r === "woche"
      ? plusTage(d, 7)
      : r === "monat"
        ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
        : new Date(d.getFullYear() + 1, 0, 1);

/** Alle Perioden zwischen von und bis (auch leere), Schlüssel wie vom Server: Beginn als YYYY-MM-DD */
export function periodenListe(von: string, bis: string, r: Raster): string[] {
  const liste: string[] = [];
  const ende = ausIso(bis);
  for (let d = periodenStart(ausIso(von), r); d <= ende && liste.length < 2000; d = naechste(d, r)) liste.push(iso(d));
  return liste;
}

export function periodenText(schluessel: string, r: Raster, kurz: boolean): string {
  const d = ausIso(schluessel);
  if (r === "tag") return kurz ? `${tageKurz[d.getDay()]} ${tagMonat(schluessel)}` : tagMonat(schluessel);
  if (r === "woche") return t("KW {kw}", { kw: kalenderwoche(d) });
  if (r === "monat") return `${monateKurz[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return String(d.getFullYear());
}

/** Klick auf eine Periode im Verlauf -> in diese Periode springen */
export function hineinZoomen(schluessel: string, r: Raster): { ansicht: Ansicht; anker: Date } | null {
  if (r === "tag") return null;
  return { ansicht: r === "woche" ? "woche" : r === "monat" ? "monat" : "jahr", anker: ausIso(schluessel) };
}

export const rasterNamen: Record<Raster, string> = { tag: t("Tage"), woche: t("Wochen"), monat: t("Monate"), jahr: t("Jahre") };
/** Überschriften-Zusatz: "Verlauf nach Tagen" */
export const rasterNach: Record<Raster, string> = { tag: t("nach Tagen"), woche: t("nach Wochen"), monat: t("nach Monaten"), jahr: t("nach Jahren") };
/** Durchschnitt: "Ø je Tag" */
export const rasterJe: Record<Raster, string> = { tag: t("je Tag"), woche: t("je Woche"), monat: t("je Monat"), jahr: t("je Jahr") };
