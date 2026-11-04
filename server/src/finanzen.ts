import * as api from "@actual-app/api";
import { actualZugang, mitActual } from "./actual.js";
import { einstellungLesen, sql } from "./db.js";

export type FinanzEinstellung = {
  /** Sync-IDs der Budgets im Dashboard (leer = nur das Buchungs-Budget aus ACTUAL_SYNC_ID) */
  budgets: string[];
  /** Konten für den Vermögensverlauf als "syncId:kontoId"; null = alle Konten außerhalb des Budgets (Depots) */
  vermoegen: string[] | null;
  /** Kategorie-IDs, die nicht als Einnahme/Ausgabe zählen (z. B. Überweisungen zwischen den Budgets) */
  ausblenden: string[];
};

export const finanzEinstellung = async (haushaltId: number): Promise<FinanzEinstellung> => ({
  budgets: [],
  vermoegen: null,
  ausblenden: [],
  ...(await einstellungLesen<Partial<FinanzEinstellung>>("finanzen", {}, haushaltId)),
});

export async function gewaehlteBudgets(haushaltId: number): Promise<string[]> {
  const e = await finanzEinstellung(haushaltId);
  if (e.budgets.length) return e.budgets;
  const zugang = await actualZugang(haushaltId);
  return zugang ? [zugang.syncId] : [];
}

/** Alle Budgets auf dem Actual-Server (zur Auswahl in den Einstellungen) */
export const actualBudgets = (haushaltId: number) =>
  mitActual(haushaltId, async () => {
    const buchungsBudget = (await actualZugang(haushaltId))?.syncId;
    // getBudgets liefert Server- und lokal zwischengespeicherte Kopie getrennt -> nach Sync-ID zusammenfassen
    const eindeutig = new Map<string, { syncId: string; name: string; buchung: boolean }>();
    for (const b of await api.getBudgets()) {
      if (b.groupId && !eindeutig.has(b.groupId)) {
        eindeutig.set(b.groupId, { syncId: b.groupId, name: b.name, buchung: b.groupId === buchungsBudget });
      }
    }
    return [...eindeutig.values()].sort((a, b) => Number(b.buchung) - Number(a.buchung) || a.name.localeCompare(b.name, "de"));
  });

type Zeile = {
  haushalt_id: number; budget: string; id: string; konto_id: string; datum: string; betrag_cent: number;
  kategorie_id: string | null; kategorie: string | null; gruppe: string | null; einnahme: boolean;
  empfaenger: string | null; notiz: string | null; umbuchung: boolean;
};

/** Ein Budget vollständig auslesen (Konten und alle Buchungen, aufgeteilte in Teilen) */
function budgetAuslesen(haushaltId: number, syncId: string) {
  return mitActual(haushaltId, async () => {
    const konten = await api.getAccounts();
    const kategorien = new Map<string, { name: string; gruppe: string; einnahme: boolean }>();
    for (const g of await api.getCategoryGroups()) {
      for (const k of g.categories ?? []) kategorien.set(k.id, { name: k.name, gruppe: g.name, einnahme: Boolean(g.is_income) });
    }
    const empfaenger = new Map((await api.getPayees()).map((p) => [p.id, p.name]));

    const zeilen: Zeile[] = [];
    for (const konto of konten) {
      for (const t of await api.getTransactions(konto.id, "1970-01-01", "2999-12-31")) {
        if (t.is_child) continue; // Teile kommen über subtransactions des Hauptsatzes
        const teile = t.subtransactions?.length ? t.subtransactions : [t];
        for (const s of teile) {
          const kat = s.category ? kategorien.get(s.category) : undefined;
          zeilen.push({
            haushalt_id: haushaltId,
            budget: syncId,
            id: s.id,
            konto_id: konto.id,
            datum: t.date,
            betrag_cent: s.amount,
            kategorie_id: s.category ?? null,
            kategorie: kat?.name ?? null,
            gruppe: kat?.gruppe ?? null,
            einnahme: kat?.einnahme ?? false,
            empfaenger: empfaenger.get(s.payee ?? t.payee ?? "") ?? t.imported_payee ?? null,
            notiz: s.notes ?? t.notes ?? null,
            // Umbuchungen zwischen eigenen Konten und Anfangssalden sind weder Einnahme noch Ausgabe
            umbuchung: Boolean(s.transfer_id ?? t.transfer_id) || Boolean(t.starting_balance_flag),
          });
        }
      }
    }
    return {
      konten: konten.map((k) => ({ haushalt_id: haushaltId, budget: syncId, id: k.id, name: k.name, offbudget: Boolean(k.offbudget), geschlossen: Boolean(k.closed) })),
      zeilen,
  };
  }, syncId);
}

type EinleseErgebnis = { budget: string; buchungen?: number; fehler?: string }[];
const laeuft = new Map<number, Promise<EinleseErgebnis>>();

/** Gewählte Budgets eines Haushalts aus Actual in fin_* übernehmen (vollständig ersetzen) */
export function finanzenEinlesen(haushaltId: number): Promise<EinleseErgebnis> {
  const vorhanden = laeuft.get(haushaltId);
  if (vorhanden) return vorhanden;
  const lauf = (async () => {
    const budgets = await gewaehlteBudgets(haushaltId);
    const namen = new Map((await actualBudgets(haushaltId)).map((b) => [b.syncId, b.name]));
    const ergebnis: EinleseErgebnis = [];

    for (const syncId of budgets) {
      const name = namen.get(syncId) ?? syncId;
      try {
        const { konten, zeilen } = await budgetAuslesen(haushaltId, syncId);
        await sql.begin(async (tx) => {
          await tx`delete from fin_buchungen where haushalt_id = ${haushaltId} and budget = ${syncId}`;
          await tx`delete from fin_konten where haushalt_id = ${haushaltId} and budget = ${syncId}`;
          if (konten.length) await tx`insert into fin_konten ${tx(konten)}`;
          for (let i = 0; i < zeilen.length; i += 1000) await tx`insert into fin_buchungen ${tx(zeilen.slice(i, i + 1000))}`;
          await tx`
            insert into fin_budgets (haushalt_id, sync_id, name, eingelesen, buchungen, fehler)
            values (${haushaltId}, ${syncId}, ${name}, now(), ${zeilen.length}, null)
            on conflict (haushalt_id, sync_id) do update set name = excluded.name, eingelesen = now(), buchungen = excluded.buchungen, fehler = null`;
        });
        ergebnis.push({ budget: name, buchungen: zeilen.length });
      } catch (fehler) {
        const text = (fehler as Error).message;
        await sql`
          insert into fin_budgets (haushalt_id, sync_id, name, fehler) values (${haushaltId}, ${syncId}, ${name}, ${text})
          on conflict (haushalt_id, sync_id) do update set fehler = excluded.fehler`;
        ergebnis.push({ budget: name, fehler: text });
      }
    }
    // abgewählte Budgets entfernen
    await sql`delete from fin_buchungen where haushalt_id = ${haushaltId} and budget <> all(${budgets}::text[])`;
    await sql`delete from fin_konten where haushalt_id = ${haushaltId} and budget <> all(${budgets}::text[])`;
    await sql`delete from fin_budgets where haushalt_id = ${haushaltId} and sync_id <> all(${budgets}::text[])`;
    return ergebnis;
  })().finally(() => laeuft.delete(haushaltId));
  laeuft.set(haushaltId, lauf);
  return lauf;
}

/** Regelmäßig alle Haushalte mit Actual-Zugang neu einlesen */
export function finanzenPlanen(stunden: number): void {
  const lauf = async () => {
    for (const { id } of await sql<{ id: number }[]>`select id from haushalte order by id`) {
      if (await actualZugang(id)) await finanzenEinlesen(id).catch((e) => console.error(`Finanzen einlesen Haushalt ${id}:`, e));
    }
  };
  setTimeout(lauf, 90_000);
  setInterval(lauf, stunden * 3_600_000);
}
