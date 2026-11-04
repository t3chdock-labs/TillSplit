// Preise der Claude-Modelle in US-Dollar je Million Tokens (Stand 11/2026)
const preise: Record<string, { ein: number; aus: number; cacheLesen: number }> = {
  "claude-opus-5-5": { ein: 4, aus: 20, cacheLesen: 0.2 },
  "claude-sonnet-5-5": { ein: 2, aus: 10, cacheLesen: 0.2 },
  "claude-haiku-5-5": { ein: 0.1, aus: 0.5, cacheLesen: 0.01 },
};

/** Claude-Modelle, die zum Nachlesen angeboten werden (günstig -> teuer) */
export const CLAUDE_MODELLE = [
  { id: "claude-haiku-5-5", name: "Haiku 5.5" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  { id: "claude-opus-5-5", name: "Opus 5.5" },
] as const;

export const modellName = (id: string | null | undefined) => CLAUDE_MODELLE.find((m) => id?.startsWith(m.id))?.name ?? id ?? "";

/**
 * Grobe Kostenschätzung für einen weiteren Lesevorgang mit `modell`, ausgehend von den Tokens eines
 * bisherigen Laufs. Größere Modelle schreiben erfahrungsgemäß etwas mehr (Aufschlag 30 % auf die Ausgabe).
 */
export function kostenSchaetzen(modell: string, eingabeTokens: number, ausgabeTokens: number): number | null {
  const preis = Object.entries(preise).find(([id]) => modell.startsWith(id))?.[1];
  return preis ? (eingabeTokens * preis.ein + ausgabeTokens * 1.3 * preis.aus) / 1e6 : null;
}

export type KiVerbrauch = {
  eingabe: number;
  ausgabe: number;
  cacheGeschrieben: number;
  cacheGelesen: number;
  /** US-Dollar, null bei unbekanntem Modell oder Ollama */
  kostenUsd: number | null;
};

export function verbrauchBerechnen(
  modell: string,
  usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null },
): KiVerbrauch {
  const v = {
    eingabe: usage.input_tokens,
    ausgabe: usage.output_tokens,
    cacheGeschrieben: usage.cache_creation_input_tokens ?? 0,
    cacheGelesen: usage.cache_read_input_tokens ?? 0,
  };
  // Modell-ID kann ein Datum tragen (claude-…-20261101) -> über den Anfang zuordnen
  const preis = Object.entries(preise).find(([id]) => modell.startsWith(id))?.[1];
  const kostenUsd = preis
    ? (v.eingabe * preis.ein + v.cacheGeschrieben * preis.ein * 1.25 + v.cacheGelesen * preis.cacheLesen + v.ausgabe * preis.aus) / 1e6
    : null;
  return { ...v, kostenUsd };
}
