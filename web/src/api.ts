// Schlanker Zugriff auf die TillSplit-API
import { sprache, t } from "./i18n";

export class ApiFehler extends Error {
  constructor(public status: number, nachricht: string, public daten: Record<string, unknown> | null = null) {
    super(nachricht);
  }
}

async function anfrage<T>(methode: string, pfad: string, daten?: unknown): Promise<T> {
  const istFormular = daten instanceof FormData;
  const antwort = await fetch(pfad, {
    method: methode,
    credentials: "same-origin",
    // Meldungen des Servers kommen in der Sprache der Oberfläche
    headers: { "x-sprache": sprache(), ...(daten && !istFormular ? { "content-type": "application/json" } : {}) },
    body: daten === undefined ? undefined : istFormular ? daten : JSON.stringify(daten),
  });
  const text = await antwort.text();
  let inhalt = null;
  try {
    inhalt = text ? JSON.parse(text) : null;
  } catch {
    // keine JSON-Antwort (z. B. Proxy-Fehlerseite)
  }
  // Sitzung abgelaufen oder Pflichtschritt (Passwort ändern, Zwei-Faktor einrichten) -> Anmeldestatus neu laden
  if (!pfad.startsWith("/api/auth/") && (antwort.status === 401 || (antwort.status === 403 && (inhalt?.passwortAendern || inhalt?.zweiFaktorEinrichten)))) {
    window.dispatchEvent(new Event("tillsplit:sitzung"));
  }
  if (!antwort.ok) throw new ApiFehler(antwort.status, inhalt?.fehler ?? inhalt?.message ?? t("Fehler {status}", { status: antwort.status }), inhalt);
  return inhalt as T;
}

export const api = {
  get: <T>(pfad: string) => anfrage<T>("GET", pfad),
  post: <T>(pfad: string, daten?: unknown) => anfrage<T>("POST", pfad, daten ?? {}),
  put: <T>(pfad: string, daten: unknown) => anfrage<T>("PUT", pfad, daten),
  delete: <T>(pfad: string) => anfrage<T>("DELETE", pfad),
};

// --- Typen ---

export type BonStatus = "neu" | "in_arbeit" | "erkannt" | "geprueft" | "wartet" | "gebucht" | "fehler";
export type Zahlung = "bar" | "karte" | "unbekannt";
/** Actual-Konto; budget/budget_name gesetzt, sobald in mehreren Budgets gebucht wird */
export type Konto = { id: string; name: string; offbudget: boolean; budget?: string; budget_name?: string };
export type AbgleichErgebnis = { ergebnis: "gebucht" | "wartet" | "auswahl" | "kein_konto" | "nur_tillsplit" | "aus" | "fehler"; text: string };

export type BonListeneintrag = {
  id: number;
  status: BonStatus;
  fehler: string | null;
  datum: string | null;
  uhrzeit: string | null;
  summe_cent: number | null;
  datei_mime: string;
  /** Anfang der Prüfsumme: Teil der Bild-Adresse, damit der Browser nie ein fremdes Bild aus dem Speicher zeigt */
  datei_version?: string;
  /** Gegenprüfung Bild <-> Daten per Tesseract */
  gegenpruefung?: "ok" | "abweichung" | "unbekannt" | null;
  erstellt_am: string;
  haendler: string | null;
  anzahl_positionen: number;
  positionen_cent: number;
  zahlung: Zahlung;
  karte_endziffern: string | null;
  abgleich_hinweis: string | null;
  /** älterer Bon mit gleichem Händler, Datum und Betrag */
  dublette_von?: number | null;
  /** Positionen, die keiner Gruppe zugeordnet werden konnten */
  ohne_gruppe?: number;
  /** Positionen, die die KI als unsicher gelesen markiert hat */
  unsicher?: number;
  /** gehört zu einer Sammelbuchung (mehrere Bons, eine Abbuchung) */
  sammel?: boolean;
};

export type Position = {
  id?: number;
  nr?: number;
  text_roh: string;
  name: string;
  /** allgemeine Warensorte, z. B. "Tomate", "Schokolade", "Cola" */
  sorte?: string | null;
  menge: number | null;
  einheit: string | null;
  einzelpreis_cent: number | null;
  betrag_cent: number;
  gruppe_id: number | null;
  gruppe_quelle?: "ki" | "regel" | "hand";
  /** unleserlich oder geraten – muss beim Prüfen bestätigt werden */
  unsicher?: boolean;
};

export type Bon = {
  id: number;
  status: BonStatus;
  fehler: string | null;
  datum: string | null;
  uhrzeit: string | null;
  summe_cent: number | null;
  zahlart: string | null;
  filiale: string | null;
  notiz: string | null;
  datei_mime: string;
  datei_version?: string;
  gegenpruefung?: "ok" | "abweichung" | "unbekannt" | null;
  /** unabhängig gelesener Text des Bildes (Gegenprüfung) */
  pruef_text?: string | null;
  datei_pfad: string;
  datei_name: string | null;
  ki_anbieter: string | null;
  ki_modell: string | null;
  ki_eingabe_tokens?: number | null;
  ki_ausgabe_tokens?: number | null;
  ki_cache_tokens?: number | null;
  ki_kosten_usd?: number | null;
  /** bisherige KI-Kosten in der Anzeigewährung (je Anfrage mit dem Kurs ihres Tages) */
  ki_kosten?: number | null;
  ki_sekunden?: number | null;
  ki_summe_passt?: boolean | null;
  dublette_von?: number | null;
  /** größere Claude-Modelle zum Nachlesen mit geschätzten Kosten (null, wenn nie mit Claude gelesen) */
  nachlesen?: {
    modus: "manuell" | "automatisch" | "aus";
    modelle: { id: string; name: string; schaetzung: number | null; bisher: boolean }[];
  } | null;
  actual_tx_id: string | null;
  gebucht_am: string | null;
  haendler: string | null;
  positionen: Position[];
  naechster_offen: number | null;
  zahlung: Zahlung;
  zahlung_quelle: "ki" | "hand";
  karte_endziffern: string | null;
  actual_konto_id: string | null;
  konto_quelle: "hand" | "karte" | "bargeld" | null;
  abgleich_hinweis: string | null;
  abgleich_am: string | null;
  /** Sammelbuchung: alle Bons derselben Abbuchung (einschließlich dieses Bons) */
  sammel?: boolean;
  sammel_bons?: SammelBon[];
};

export type SammelBon = { id: number; datum: string | null; summe_cent: number; haendler: string | null };

/** Vorschlag aus dem Abgleich: mehrere offene Bons ergeben zusammen genau eine Abbuchung */
export type SammelVorschlag = {
  id: number;
  datum: string;
  betrag_cent: number;
  konto: string;
  empfaenger: string;
  bons: SammelBon[];
};

export type Gruppe = {
  id: number;
  name: string;
  eltern_id: number | null;
  farbe: string;
  sortierung: number;
  actual_kategorie_id: string | null;
  /** Kategorien in weiteren Buchungs-Budgets (Sync-ID -> Kategorie) */
  weitere_kategorien?: Record<string, string>;
  anzahl_positionen: number;
};

export type Kandidat = {
  id: string;
  konto_id: string;
  konto: string;
  datum: string;
  betrag_cent: number;
  empfaenger: string;
  notiz: string | null;
  aufgeteilt: boolean;
  abstand_tage: number;
  /** Budget der Abbuchung (Haupt-Budget oder z. B. Haushaltskonto) */
  budget?: string;
};
