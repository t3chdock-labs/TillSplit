import { config } from "../config.js";
import { einstellungLesen, sql } from "../db.js";
import { gebiet, t } from "../i18n.js";
import { kursJeDollar } from "../kurse.js";
import { mitClaudeErkennen, type ClaudeOptionen } from "./claude.js";
import type { KiVerbrauch } from "./kosten.js";
import { mitOllamaErkennen } from "./ollama.js";
import type { BonErgebnis } from "./schema.js";
import { belegTextLesen } from "./tesseract.js";

export type KiEingabe =
  | { art: "pdf"; pdf: Buffer }
  | { art: "bilder"; bilder: Buffer[]; original?: Buffer }
  // bereits gelesener Text (Tesseract) für ein reines Sprachmodell
  | { art: "text"; text: string };

export type KiAnbieter = "claude" | "ollama" | "tesseract";
/**
 * Nachlesen, wenn die Positionen nicht zur Bonsumme passen:
 * manuell = Hinweis am Bon, ein größeres Modell wird erst nach Freigabe (mit Kostenhinweis) gefragt;
 * automatisch = sofort mit nachleseModell; aus = gar nicht.
 */
export type Nachlesen = "manuell" | "automatisch" | "aus";
export type KiEinstellung = {
  anbieter: KiAnbieter;
  ollamaModell: string;
  /** Claude-Modell für die erste Erkennung (Vorgabe aus CLAUDE_MODEL) */
  erkennungsModell: string;
  nachlesen: Nachlesen;
  nachleseModell: string;
  /** Anzeigewährung für Kosten und Limits (Anthropic rechnet in US-Dollar ab, umgerechnet mit EZB-Kurs) */
  waehrung: string;
  /** Kostenschutz in der Anzeigewährung; 0 = kein Limit */
  monatslimit: number;
  bonLimit: number;
  /** Gegenprüfung Bild <-> Daten mit Tesseract (lokal, kostet Rechenzeit; Standard aus) */
  gegenpruefung: boolean;
  /** Denkaufwand von Claude (Vorgabe aus CLAUDE_EFFORT) */
  aufwand: "low" | "medium" | "high";
  /** Ollama-Server (Vorgabe aus OLLAMA_URL) */
  ollamaUrl: string;
  /** Wer den Tesseract-Text gliedert (Vorgabe aus TEXT_MODEL_PROVIDER und OLLAMA_TEXT_MODEL) */
  textModellAnbieter: "ollama" | "claude";
  ollamaTextModell: string;
};

const kiStandard = (): KiEinstellung => ({
  anbieter: config.kiAnbieter,
  ollamaModell: config.ollamaModell,
  erkennungsModell: config.claudeModell,
  nachlesen: "manuell",
  nachleseModell: config.claudeNachpruefModell ?? "claude-sonnet-5-5",
  waehrung: "EUR",
  monatslimit: 50,
  bonLimit: 0.5,
  gegenpruefung: false,
  aufwand: config.claudeAufwand,
  ollamaUrl: config.ollamaUrl,
  textModellAnbieter: config.textModellAnbieter,
  ollamaTextModell: config.ollamaTextModell,
});

/** Anzeigewährung samt Kurs; ohne bekannten Kurs bleibt es bei US-Dollar */
export async function waehrungMitKurs(): Promise<{ waehrung: string; kurs: number; stand: string | null }> {
  const { waehrung } = await kiEinstellung();
  const k = await kursJeDollar(waehrung);
  return k ? { waehrung, ...k } : { waehrung: "USD", kurs: 1, stand: null };
}

const betrag = (wert: number, waehrung: string) =>
  wert.toLocaleString(gebiet(), { style: "currency", currency: waehrung, maximumFractionDigits: wert < 1 ? 3 : 2 });

/**
 * Claude-Kosten im laufenden Kalendermonat (deutsche Zeit), über alle Haushalte –
 * jede Anfrage mit dem Kurs ihres Tages umgerechnet (USD: unverändert).
 */
export async function monatsKosten(waehrung = "USD"): Promise<number> {
  const [z] = await sql<{ betrag: number }[]>`
    select coalesce(sum(usd_in(kosten_usd, zeit, ${waehrung})), 0)::float as betrag from ki_aufrufe
     where zeit >= (date_trunc('month', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')`;
  return z.betrag;
}

/** Bisherige Kosten eines Bons in der Währung, je Anfrage mit dem Kurs ihres Tages */
export async function bonKosten(bonId: number, waehrung = "USD"): Promise<number | null> {
  const [z] = await sql<{ betrag: number | null }[]>`
    select sum(usd_in(kosten_usd, zeit, ${waehrung}))::float as betrag from ki_aufrufe where bon_id = ${bonId}`;
  return z.betrag;
}

/**
 * Kostenschutz vor jeder Claude-Anfrage: Monatslimit und Limit je Bon (bisherige Kosten + geschätzte Kosten).
 * Eine einzelne Anfrage ist durch max_tokens gedeckelt; das Limit kann so höchstens um eine Anfrage überschritten werden.
 */
export async function kostenPruefen(bonId: number | null, schaetzungUsd = 0): Promise<void> {
  const ki = await kiEinstellung();
  // Limits sind in der Anzeigewährung hinterlegt. Bisherige Kosten mit dem Kurs ihres Tages,
  // die geschätzten Kosten der kommenden Anfrage mit dem heutigen Kurs
  const { waehrung, kurs } = await waehrungMitKurs();
  const umgerechnet = (usd: number) => usd * kurs;
  if (ki.monatslimit > 0) {
    const monat = await monatsKosten(waehrung);
    if (monat + umgerechnet(schaetzungUsd) >= ki.monatslimit) {
      throw new Error(
        t("KI-Kostenlimit erreicht: diesen Monat {verbraucht} von {limit} verbraucht. Limit unter Einstellungen → Actual → Texterkennung anheben oder bis zum Monatsanfang warten.", {
          verbraucht: betrag(monat, waehrung),
          limit: betrag(ki.monatslimit, waehrung),
        }),
      );
    }
  }
  if (bonId != null && ki.bonLimit > 0) {
    const bisher = (await bonKosten(bonId, waehrung)) ?? 0;
    const dazu = umgerechnet(schaetzungUsd);
    if (bisher + dazu >= ki.bonLimit) {
      throw new Error(
        (dazu
          ? t("Kostenlimit für diesen Bon erreicht: bisher {bisher}, weitere ca. {dazu} – Limit {limit}. Bitte von Hand korrigieren oder das Limit anheben.", {
              bisher: betrag(bisher, waehrung),
              dazu: betrag(dazu, waehrung),
              limit: betrag(ki.bonLimit, waehrung),
            })
          : t("Kostenlimit für diesen Bon erreicht: bisher {bisher} – Limit {limit}. Bitte von Hand korrigieren oder das Limit anheben.", {
              bisher: betrag(bisher, waehrung),
              limit: betrag(ki.bonLimit, waehrung),
            })),
      );
    }
  }
}

export const kiEinstellung = async (): Promise<KiEinstellung> => ({
  ...kiStandard(),
  ...(await einstellungLesen<Partial<KiEinstellung>>("ki", {})),
});

export async function erkennen(
  eingabe: KiEingabe,
  untergruppen: { name: string; haupt: string }[],
  anbieter?: KiAnbieter,
  sorten: string[] = [],
  claudeOptionen: ClaudeOptionen = {},
): Promise<{ ergebnis: BonErgebnis; anbieter: string; modell: string; verbrauch: KiVerbrauch; sekunden: number }> {
  const einstellung = await kiEinstellung();
  const gewaehlt = anbieter ?? einstellung.anbieter;
  // ohne ausdrückliches Modell (Nachlesen) gilt das in den Einstellungen gewählte
  claudeOptionen = { ...claudeOptionen, modell: claudeOptionen.modell ?? einstellung.erkennungsModell, aufwand: claudeOptionen.aufwand ?? einstellung.aufwand };
  const start = Date.now();

  if (gewaehlt === "tesseract") {
    // Tesseract liest den Text, ein Sprachmodell gliedert ihn (Ollama lokal oder Claude)
    const text = await belegTextLesen(eingabe);
    if (text.replace(/\s/g, "").length < 15) throw new Error(t("Tesseract hat auf dem Beleg keinen Text gefunden – Foto schärfer oder heller aufnehmen"));
    const textEingabe: KiEingabe = { art: "text", text };
    const { ergebnis, modell, verbrauch } =
      einstellung.textModellAnbieter === "claude"
        ? await mitClaudeErkennen(textEingabe, untergruppen, sorten, claudeOptionen)
        : await mitOllamaErkennen(textEingabe, untergruppen, einstellung.ollamaTextModell, sorten, einstellung.ollamaUrl);
    return { ergebnis, anbieter: "tesseract", modell: `tesseract + ${modell}`, verbrauch, sekunden: (Date.now() - start) / 1000 };
  }

  const { ergebnis, modell, verbrauch } =
    gewaehlt === "ollama"
      ? await mitOllamaErkennen(eingabe, untergruppen, einstellung.ollamaModell, sorten, einstellung.ollamaUrl)
      : await mitClaudeErkennen(eingabe, untergruppen, sorten, claudeOptionen);
  return { ergebnis, anbieter: gewaehlt, modell, verbrauch, sekunden: (Date.now() - start) / 1000 };
}
