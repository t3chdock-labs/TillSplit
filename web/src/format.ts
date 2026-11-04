import { gebiet, sprache, t } from "./i18n";

const loc = gebiet();
const euroFormat = new Intl.NumberFormat(loc, { style: "currency", currency: "EUR" });
const euroKurz = new Intl.NumberFormat(loc, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export const euro = (cent: number | null | undefined) => (cent == null ? "–" : euroFormat.format(cent / 100));
export const euroGerundet = (cent: number) => euroKurz.format(cent / 100);
/** Zahl im Format der eingestellten Sprache */
export const zahl = (wert: number, stellen = 0) => wert.toLocaleString(loc, { maximumFractionDigits: stellen });
/** Anzeigewährung der KI-Kosten (vom Server, Kurs der EZB je US-Dollar) */
let anzeige = { waehrung: "USD", kurs: 1 };
export const waehrungSetzen = (waehrung: string, kurs: number) => (anzeige = { waehrung, kurs });
export const anzeigeWaehrung = () => anzeige.waehrung;
const unterEinheit: Record<string, string> = { USD: t("US-Cent"), EUR: t("Cent"), CHF: t("Rappen"), GBP: t("Pence") };

/**
 * KI-Kosten, die der Server schon in die Anzeigewährung umgerechnet hat (vergangene Kosten mit dem Kurs
 * ihres Tages): kleine Beträge in Cent/Rappen/Pence.
 */
export const geld = (wert: number, waehrung = anzeige.waehrung) => {
  const klein = unterEinheit[waehrung];
  if (Math.abs(wert) < 1 && klein) return `${(wert * 100).toLocaleString(loc, { maximumFractionDigits: Math.abs(wert) < 0.1 ? 1 : 0 })} ${klein}`;
  return wert.toLocaleString(loc, { style: "currency", currency: waehrung, maximumFractionDigits: Math.abs(wert) < 1 ? 3 : 2 });
};
/** Künftige Kosten (Schätzungen in US-Dollar) mit dem heutigen Kurs */
export const usCent = (usd: number) => geld(usd * anzeige.kurs);
/** Betrag, der schon in der Anzeigewährung vorliegt (z. B. Limits) */
export const inWaehrung = (wert: number, waehrung = anzeige.waehrung) => wert.toLocaleString(loc, { style: "currency", currency: waehrung });

const datumFormat = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "2-digit", year: "numeric" });
const tagMonatFormat = new Intl.DateTimeFormat(loc, { day: "2-digit", month: "2-digit" });
const ausIsoTag = (iso: string) => {
  const [j, m, tg] = iso.slice(0, 10).split("-").map(Number);
  return new Date(j, m - 1, tg);
};

export const datum = (iso: string | null | undefined) => {
  if (!iso) return "–";
  if (sprache() === "de") {
    const [j, m, tg] = iso.slice(0, 10).split("-");
    return `${tg}.${m}.${j}`;
  }
  return datumFormat.format(ausIsoTag(iso));
};
/** Tag und Monat ohne Jahr ("02.11." bzw. "02/11") */
export const tagMonat = (iso: string) => (sprache() === "de" ? datum(iso).slice(0, 6) : tagMonatFormat.format(ausIsoTag(iso)));

/** Monatsnamen der eingestellten Sprache (deutsch ohne Punkt: "Mär", "Okt") */
export const monatsNamen = (art: "long" | "short"): string[] => {
  if (sprache() === "de")
    return art === "long"
      ? ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
      : ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  const f = new Intl.DateTimeFormat(loc, { month: art });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(2026, i, 1)));
};

/** Wochentage kurz, beginnend mit Sonntag (wie Date.getDay) */
export const tageKurzAbSonntag = (): string[] => {
  if (sprache() === "de") return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const f = new Intl.DateTimeFormat(loc, { weekday: "short" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2026, 10, 1 + i))); // 01.11.2026 ist ein Sonntag
};

const monate = monatsNamen("short");
export const monatKurz = (jjjjmm: string) => {
  const [j, m] = jjjjmm.split("-");
  return `${monate[Number(m) - 1]} ${j.slice(2)}`;
};

/** Wochentage kurz, beginnend mit Montag */
export const wochentage = [...tageKurzAbSonntag().slice(1), tageKurzAbSonntag()[0]];

/** Dezimalzeichen der eingestellten Sprache */
const komma = (1.5).toLocaleString(loc).includes(",");

/** "12,34" / "12.34" / "-0,50" / "1,234.56" -> Cent */
export function centAusText(text: string): number | null {
  let sauber = text.replace(/[^\d,.-]/g, "");
  if (sauber.includes(",") && sauber.includes(".")) {
    // beides vorhanden: das hintere Zeichen trennt die Nachkommastellen
    sauber = sauber.lastIndexOf(",") > sauber.lastIndexOf(".") ? sauber.replace(/\./g, "").replace(",", ".") : sauber.replace(/,/g, "");
  } else if (komma) {
    sauber = sauber.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  } else {
    sauber = sauber.replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  }
  if (sauber === "" || sauber === "-") return null;
  const wert = Number(sauber);
  return Number.isFinite(wert) ? Math.round(wert * 100) : null;
}

export const zahlungText = (zahlung: string, endziffern?: string | null) =>
  zahlung === "bar" ? t("Bar") : zahlung === "karte" ? (endziffern ? t("Karte •••• {endziffern}", { endziffern }) : t("Karte")) : t("Zahlart offen");

export const centAlsText = (cent: number | null | undefined) =>
  cent == null ? "" : komma ? (cent / 100).toFixed(2).replace(".", ",") : (cent / 100).toFixed(2);

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const statusText: Record<string, string> = {
  neu: t("Wartet"),
  in_arbeit: t("Wird gelesen"),
  erkannt: t("Zu prüfen"),
  geprueft: t("Geprüft"),
  wartet: t("Wartet auf Bank"),
  gebucht: t("In Actual"),
  fehler: t("Fehler"),
};
