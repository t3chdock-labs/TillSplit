import { sql } from "./db.js";

/** Bontext auf ein vergleichbares Muster reduzieren: "BIO GURKE ST. 0,79 A" -> "bio gurke st" */
export function musterVon(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\d+[.,]\d+/g, " ")
    .replace(/\b\d+\s*(x|stk|st|kg|g|l|ml)\b/g, " ")
    .replace(/[^a-zäöüß ]+/g, " ")
    .replace(/\b[ab]\b\s*$/g, " ") // MwSt-Kennbuchstabe am Zeilenende
    .replace(/\s+/g, " ")
    .trim();
}

type Regel = { muster: string; haendler_id: number | null; gruppe_id: number; name: string | null; sorte: string | null };

/** Liefert je Muster die passende Regel; händlerspezifische Regeln gewinnen. */
export async function regelnFinden(haushaltId: number, muster: string[], haendlerId: number | null): Promise<Map<string, Regel>> {
  if (muster.length === 0) return new Map();
  const zeilen = await sql<Regel[]>`
    select muster, haendler_id, gruppe_id, name, sorte from regeln
     where haushalt_id = ${haushaltId} and muster = any(${muster})
       and (haendler_id is null or haendler_id = ${haendlerId})
     order by haendler_id nulls first`;
  const ergebnis = new Map<string, Regel>();
  for (const z of zeilen) ergebnis.set(z.muster, z); // spätere (händlerspezifische) überschreiben
  return ergebnis;
}

export async function trefferZaehlen(haushaltId: number, muster: string[]): Promise<void> {
  if (muster.length) await sql`update regeln set treffer = treffer + 1 where haushalt_id = ${haushaltId} and muster = any(${muster})`;
}

/** Aus einer Korrektur lernen: gilt künftig für alle Händler. */
export async function regelLernen(haushaltId: number, textRoh: string, gruppeId: number, name: string | null, sorte: string | null = null): Promise<void> {
  const muster = musterVon(textRoh);
  if (muster.length < 2) return;
  await sql`
    insert into regeln (haushalt_id, muster, haendler_id, gruppe_id, name, sorte) values (${haushaltId}, ${muster}, null, ${gruppeId}, ${name}, ${sorte})
    on conflict (haushalt_id, muster, coalesce(haendler_id, 0)) do update
      set gruppe_id = excluded.gruppe_id, name = coalesce(excluded.name, regeln.name), sorte = coalesce(excluded.sorte, regeln.sorte)`;
}
