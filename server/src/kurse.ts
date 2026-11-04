import { sql } from "./db.js";

/**
 * Wechselkurse der Europäischen Zentralbank (Referenzkurse, werktags gegen 16 Uhr, frei und ohne Schlüssel).
 * Anthropic rechnet in US-Dollar ab. Jeder Tageskurs wird gespeichert, damit vergangene Kosten mit dem
 * Kurs ihres Tages umgerechnet werden (SQL-Funktion usd_in) und sich nicht mit dem heutigen Kurs verschieben.
 */
const EZB_TAG = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const EZB_90_TAGE = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
const PRUEFEN_MS = 6 * 3_600_000;

export const WAEHRUNGEN = ["EUR", "USD", "CHF", "GBP", "PLN", "CZK", "DKK", "SEK", "NOK", "HUF"] as const;

let zuletztGeprueft = 0;
let laeuft: Promise<void> | null = null;

/** Kurse aus dem EZB-XML: je Tag die Kurse je 1 Euro */
function auslesen(xml: string): { stand: string; jeEuro: Record<string, number> }[] {
  const tage: { stand: string; jeEuro: Record<string, number> }[] = [];
  for (const block of xml.split(/<Cube\s+time=/).slice(1)) {
    const stand = block.match(/^['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
    if (!stand) continue;
    const jeEuro: Record<string, number> = { EUR: 1 };
    for (const [, code, kurs] of block.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) jeEuro[code] = Number(kurs);
    if (jeEuro.USD) tage.push({ stand, jeEuro });
  }
  return tage;
}

async function holenUndSpeichern(url: string): Promise<number> {
  const antwort = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!antwort.ok) throw new Error(`EZB antwortet mit ${antwort.status}`);
  const zeilen = auslesen(await antwort.text()).flatMap((t) =>
    Object.entries(t.jeEuro)
      .filter(([w]) => (WAEHRUNGEN as readonly string[]).includes(w))
      .map(([waehrung, je_euro]) => ({ stand: t.stand, waehrung, je_euro })),
  );
  if (zeilen.length) await sql`insert into wechselkurse ${sql(zeilen)} on conflict do nothing`;
  return zeilen.length;
}

/** Kurse aktuell halten: beim ersten Mal die letzten 90 Tage nachladen, danach den Tageskurs */
export function kurseAktualisieren(): Promise<void> {
  if (Date.now() - zuletztGeprueft < PRUEFEN_MS) return Promise.resolve();
  laeuft ??= (async () => {
    try {
      const [{ tage }] = await sql<{ tage: number }[]>`select count(distinct stand)::int as tage from wechselkurse`;
      await holenUndSpeichern(tage < 20 ? EZB_90_TAGE : EZB_TAG);
    } catch (fehler) {
      // ohne Verbindung mit den gespeicherten Kursen weiterarbeiten
      console.warn("Wechselkurse:", (fehler as Error).message);
    } finally {
      zuletztGeprueft = Date.now();
    }
  })().finally(() => (laeuft = null));
  return laeuft;
}

/** Aktueller Kurs: Einheiten der Währung je 1 US-Dollar (USD -> 1); null, wenn noch kein Kurs bekannt ist */
export async function kursJeDollar(waehrung: string): Promise<{ kurs: number; stand: string | null } | null> {
  if (waehrung === "USD") return { kurs: 1, stand: null };
  const lesen = async () =>
    (
      await sql<{ kurs: number; stand: string }[]>`
        select (z.je_euro / u.je_euro)::float as kurs, to_char(z.stand, 'YYYY-MM-DD') as stand
          from wechselkurse z join wechselkurse u on u.stand = z.stand and u.waehrung = 'USD'
         where z.waehrung = ${waehrung} order by z.stand desc limit 1`
    )[0] ?? null;
  const k = await lesen();
  if (k) {
    // gespeicherten Kurs sofort nutzen, neuen Tageskurs im Hintergrund holen (bremst keine Anfrage aus)
    void kurseAktualisieren();
    return k;
  }
  await kurseAktualisieren();
  return lesen();
}
