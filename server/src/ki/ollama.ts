import { z } from "zod";
import { config } from "../config.js";
import { pdfZuBildern, fuerKiZerlegen } from "../dateien.js";
import { t } from "../i18n.js";
import type { KiVerbrauch } from "./kosten.js";
import { anweisung, bonSchema, type BonErgebnis } from "./schema.js";
import type { KiEingabe } from "./index.js";

export async function mitOllamaErkennen(
  eingabe: KiEingabe,
  untergruppen: { name: string; haupt: string }[],
  modell = config.ollamaModell,
  sorten: string[] = [],
): Promise<{ ergebnis: BonErgebnis; modell: string; verbrauch: KiVerbrauch }> {
  const schema = bonSchema(untergruppen.map((g) => g.name));

  // Ollama liest keine PDFs -> Seiten rendern und wie Fotos zerlegen
  let bilder: Buffer[] = [];
  if (eingabe.art === "pdf") {
    for (const seite of await pdfZuBildern(eingabe.pdf)) bilder.push(...(await fuerKiZerlegen(seite)));
  } else if (eingabe.art === "bilder") {
    bilder = eingabe.bilder;
  }
  // reiner Text (Tesseract): kein Bild, der Text steht in der Nachricht
  const nachricht =
    eingabe.art === "text"
      ? `Dies ist der per Texterkennung gelesene Text eines Belegs. Er kann Lesefehler enthalten. Lies ihn vollständig aus und antworte nur mit JSON.\n\n<beleg>\n${eingabe.text.slice(0, 20000)}\n</beleg>`
      : bilder.length > 1
        ? `Diese ${bilder.length} Bilder zeigen einen Bon von oben nach unten. Lies ihn vollständig aus und antworte nur mit JSON.`
        : "Lies diesen Beleg vollständig aus und antworte nur mit JSON.";

  const antwort = await fetch(new URL("/api/chat", config.ollamaUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10 * 60_000),
    body: JSON.stringify({
      model: modell,
      stream: false,
      format: z.toJSONSchema(schema),
      options: { temperature: 0, num_ctx: 16384 },
      messages: [
        { role: "system", content: anweisung(untergruppen, sorten) },
        { role: "user", content: nachricht, ...(bilder.length ? { images: bilder.map((b) => b.toString("base64")) } : {}) },
      ],
    }),
  });
  if (!antwort.ok) throw new Error(t("Ollama antwortet mit {status}: {meldung}", { status: antwort.status, meldung: (await antwort.text()).slice(0, 300) }));
  const daten = (await antwort.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  const verbrauch: KiVerbrauch = {
    eingabe: daten.prompt_eval_count ?? 0,
    ausgabe: daten.eval_count ?? 0,
    cacheGeschrieben: 0,
    cacheGelesen: 0,
    kostenUsd: 0,
  };
  const text = daten.message?.content ?? "";

  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new Error(t("Ollama hat kein gültiges JSON geliefert"));
  }
  const geprueft = schema.safeParse(roh);
  if (!geprueft.success) throw new Error(t("Ollama-Antwort passt nicht zum Schema: {meldung}", { meldung: geprueft.error.message.slice(0, 300) }));
  return { ergebnis: geprueft.data, modell, verbrauch };
}

export async function ollamaModelle(): Promise<string[]> {
  const antwort = await fetch(new URL("/api/tags", config.ollamaUrl), { signal: AbortSignal.timeout(5000) });
  if (!antwort.ok) throw new Error(t("Ollama nicht erreichbar ({status})", { status: antwort.status }));
  const daten = (await antwort.json()) as { models?: { name: string }[] };
  return (daten.models ?? []).map((m) => m.name);
}
