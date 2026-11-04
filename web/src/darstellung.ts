import { t } from "./i18n";

// Darstellung je Benutzer: Hell/Dunkel/System und Akzentfarbe. Wird sofort beim Laden aus dem Gerätespeicher
// angewendet (kein Aufblitzen) und nach der Anmeldung mit dem Stand am Benutzer abgeglichen.

export type Modus = "system" | "hell" | "dunkel";
export type Darstellung = { modus: Modus; akzent: string };

/** Vorlagen: Farbe für helles und für dunkles Thema (im Dunkeln heller, damit sie lesbar bleibt) */
export const AKZENTE: { schluessel: string; name: string; hell: string; dunkel: string }[] = [
  { schluessel: "petrol", name: t("Petrol"), hell: "#0f766e", dunkel: "#2dd4bf" },
  { schluessel: "blau", name: t("Blau"), hell: "#1d4ed8", dunkel: "#60a5fa" },
  { schluessel: "indigo", name: t("Indigo"), hell: "#4338ca", dunkel: "#818cf8" },
  { schluessel: "violett", name: t("Violett"), hell: "#7c3aed", dunkel: "#a78bfa" },
  { schluessel: "rosa", name: t("Rosa"), hell: "#be185d", dunkel: "#f472b6" },
  { schluessel: "orange", name: t("Orange"), hell: "#c2410c", dunkel: "#fb923c" },
  { schluessel: "gruen", name: t("Grün"), hell: "#15803d", dunkel: "#4ade80" },
  { schluessel: "graphit", name: t("Graphit"), hell: "#334155", dunkel: "#cbd5e1" },
];

export const STANDARD: Darstellung = { modus: "system", akzent: "petrol" };
const SPEICHER = "tillsplit:darstellung";

export function gueltig(d: unknown): Darstellung {
  const roh = (d ?? {}) as Partial<Darstellung>;
  const modus: Modus = roh.modus === "hell" || roh.modus === "dunkel" ? roh.modus : "system";
  const akzent = typeof roh.akzent === "string" && (AKZENTE.some((a) => a.schluessel === roh.akzent) || /^#[0-9a-f]{6}$/i.test(roh.akzent)) ? roh.akzent : STANDARD.akzent;
  return { modus, akzent };
}

export function gespeichert(): Darstellung {
  try {
    return gueltig(JSON.parse(localStorage.getItem(SPEICHER) ?? "null"));
  } catch {
    return STANDARD;
  }
}

/** relative Helligkeit (WCAG) für die Textfarbe auf dem Akzent */
function helligkeit(hex: string): number {
  const k = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
}
const textAuf = (hex: string) => (helligkeit(hex) > 0.4 ? "#0b1220" : "#ffffff");

const medien = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let aktuell = STANDARD;

export const istDunkel = () => (aktuell.modus === "system" ? Boolean(medien?.matches) : aktuell.modus === "dunkel");

export function anwenden(d: Darstellung, merken = true): void {
  aktuell = gueltig(d);
  const wurzel = document.documentElement;
  wurzel.dataset.modus = aktuell.modus;
  const vorlage = AKZENTE.find((a) => a.schluessel === aktuell.akzent);
  const hell = vorlage?.hell ?? aktuell.akzent;
  const dunkel = vorlage?.dunkel ?? aktuell.akzent;
  // die CSS-Regeln in app.css wählen je nach Modus die -l- bzw. -d-Variante
  const setzen = (name: string, wert: string) => wurzel.style.setProperty(name, wert);
  setzen("--akzent-l", hell);
  setzen("--akzent-hell-l", `color-mix(in srgb, ${hell} 16%, #ffffff)`);
  setzen("--akzent-text-l", textAuf(hell));
  setzen("--akzent-d", dunkel);
  setzen("--akzent-hell-d", `color-mix(in srgb, ${dunkel} 24%, #111a2b)`);
  setzen("--akzent-text-d", textAuf(dunkel));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", istDunkel() ? "#0b1220" : hell);
  if (merken)
    try {
      localStorage.setItem(SPEICHER, JSON.stringify(aktuell));
    } catch {
      /* privates Fenster: nur für diese Sitzung */
    }
  window.dispatchEvent(new Event("tillsplit:darstellung"));
}

// Systemwechsel (z. B. abends automatisch dunkel) sofort übernehmen
medien?.addEventListener("change", () => aktuell.modus === "system" && anwenden(aktuell, false));
