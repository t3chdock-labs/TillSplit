import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "../config.js";
import { t } from "../i18n.js";
import { verbrauchBerechnen, type KiVerbrauch } from "./kosten.js";
import { anweisung, bonSchema, type BonErgebnis } from "./schema.js";
import type { KiEingabe } from "./index.js";

let client: Anthropic | null = null;

export type ClaudeOptionen = {
  /** abweichendes Modell, sonst CLAUDE_MODEL */
  modell?: string;
  /** abweichender Denkaufwand, sonst CLAUDE_EFFORT */
  aufwand?: "low" | "medium" | "high";
  /**
   * Anweisung zwischenspeichern (Prompt-Caching, 5 Minuten). Lohnt nur, wenn direkt
   * weitere Bons folgen: das Schreiben kostet 25 % mehr, jedes Lesen nur 5 %.
   */
  zwischenspeichern?: boolean;
};

export async function mitClaudeErkennen(
  eingabe: KiEingabe,
  untergruppen: { name: string; haupt: string }[],
  sorten: string[] = [],
  optionen: ClaudeOptionen = {},
): Promise<{ ergebnis: BonErgebnis; modell: string; verbrauch: KiVerbrauch }> {
  client ??= new Anthropic();
  const modell = optionen.modell ?? config.claudeModell;
  const schema = bonSchema(untergruppen.map((g) => g.name));

  const inhalt: Anthropic.Beta.BetaContentBlockParam[] =
    eingabe.art === "text"
      ? []
      : eingabe.art === "pdf"
        ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: eingabe.pdf.toString("base64") } }]
        : eingabe.bilder.map((b) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: "image/jpeg" as const, data: b.toString("base64") },
          }));
  inhalt.push({
    type: "text",
    text:
      eingabe.art === "text"
        ? `Dies ist der per Texterkennung gelesene Text eines Belegs. Er kann Lesefehler enthalten (z. B. O statt 0, verrutschte Spalten). Lies ihn vollständig aus.\n\n<beleg>\n${eingabe.text.slice(0, 20000)}\n</beleg>`
        : eingabe.art === "bilder" && eingabe.bilder.length > 1
          ? `Diese ${eingabe.bilder.length} Bilder zeigen einen Bon von oben nach unten. Lies ihn vollständig aus.`
          : "Lies diesen Beleg vollständig aus.",
  });

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error(t("Kein Claude-API-Schlüssel hinterlegt (ANTHROPIC_API_KEY) – oder in den Einstellungen auf Ollama umstellen"));
  }

  // Haiku hat keinen serverseitigen Ausweichpfad
  const ausweichen = !modell.startsWith("claude-haiku");
  let antwort;
  try {
    antwort = await client.beta.messages.parse({
      model: modell,
      max_tokens: 16000,
      // bei einer Ablehnung durch Sicherheitsfilter automatisch auf ein passendes Modell ausweichen
      ...(ausweichen ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: optionen.aufwand ?? config.claudeAufwand, format: betaZodOutputFormat(schema) },
      system: [
        {
          type: "text",
          text: anweisung(untergruppen, sorten),
          ...(optionen.zwischenspeichern ? { cache_control: { type: "ephemeral" as const } } : {}),
        },
      ],
      messages: [{ role: "user", content: inhalt }],
    });
  } catch (fehler) {
    if (fehler instanceof Anthropic.AuthenticationError) throw new Error(t("Claude-API-Schlüssel ungültig"));
    if (fehler instanceof Anthropic.RateLimitError) throw new Error(t("Claude-Anfragelimit erreicht – später „Neu lesen“"));
    if (fehler instanceof Anthropic.APIConnectionError) throw new Error(t("Claude nicht erreichbar (Netzwerk)"));
    if (fehler instanceof Anthropic.APIError) throw new Error(t("Claude-Fehler {status}: {meldung}", { status: fehler.status, meldung: fehler.message }));
    throw fehler;
  }

  if (antwort.stop_reason === "refusal") throw new Error(t("Claude hat die Auswertung abgelehnt"));
  if (antwort.stop_reason === "max_tokens") throw new Error(t("Antwort abgeschnitten (Bon zu lang)"));
  if (!antwort.parsed_output) throw new Error(t("Claude-Antwort ließ sich nicht auslesen"));
  return { ergebnis: antwort.parsed_output, modell: antwort.model, verbrauch: verbrauchBerechnen(antwort.model, antwort.usage) };
}
