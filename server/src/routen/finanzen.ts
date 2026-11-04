import type { FastifyInstance } from "fastify";
import { zugriff } from "../auth.js";
import { einstellungSchreiben, sql } from "../db.js";
import { datumFormat, t } from "../i18n.js";
import { actualBudgets, finanzEinstellung, finanzenEinlesen, gewaehlteBudgets, type FinanzEinstellung } from "../finanzen.js";

type Filter = { von?: string; bis?: string; budget?: string; gruppe?: string; kategorie?: string; raster?: string };

const datumOk = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const rasterAus: Record<string, string> = { tag: "day", woche: "week", monat: "month", jahr: "year" };
const textListe = (wert: unknown, max = 500): string[] =>
  Array.isArray(wert) ? wert.filter((x): x is string => typeof x === "string" && x.length < 200).slice(0, max) : [];

export async function finanzRouten(app: FastifyInstance) {
  app.get<{ Querystring: Filter }>("/api/finanzen", async (req) => {
    const h = zugriff(req, "finanzen_sehen");
    const f = req.query;
    const einstellung = await finanzEinstellung(h);
    const budgets = await gewaehlteBudgets(h);
    const budget = f.budget && budgets.includes(f.budget) ? f.budget : null;
    const einheit = rasterAus[f.raster ?? "monat"] ?? "month";

    // Einnahmen/Ausgaben: nur Konten im Budget, ohne Umbuchungen und ausgeblendete Kategorien
    const fluss = sql`(
      select b.*, k.name as konto,
             (b.einnahme or (b.kategorie_id is null and b.betrag_cent > 0)) as ist_einnahme,
             coalesce(b.gruppe, ${t("Ohne Kategorie")}) as gruppe_name,
             coalesce(b.kategorie, ${t("Ohne Kategorie")}) as kategorie_name,
             coalesce(nullif(b.empfaenger, ''), ${t("Unbekannt")}) as empfaenger_name
        from fin_buchungen b
        join fin_konten k on k.haushalt_id = b.haushalt_id and k.budget = b.budget and k.id = b.konto_id
       where b.haushalt_id = ${h}
         and b.budget = any(${budgets}::text[]) and (${budget}::text is null or b.budget = ${budget})
         and not k.offbudget and not b.umbuchung
         and (b.kategorie_id is null or b.kategorie_id <> all(${einstellung.ausblenden}::text[]))
    ) x`;
    const zeit = (von: string | null, bis: string | null) =>
      sql`(${von}::date is null or datum >= ${von}::date) and (${bis}::date is null or datum <= ${bis}::date)`;
    const von = datumOk(f.von);
    const bis = datumOk(f.bis);
    const gruppe = f.gruppe ?? null;
    const kategorie = f.kategorie ?? null;
    const auswahl = sql`(${gruppe}::text is null or gruppe_name = ${gruppe}) and (${kategorie}::text is null or kategorie_name = ${kategorie})`;
    const wo = sql`${zeit(von, bis)} and ${auswahl}`;
    // Ebene unter dem Filter: Gruppen -> Kategorien -> Empfänger
    const ebene = kategorie ? sql`empfaenger_name` : gruppe ? sql`kategorie_name` : sql`gruppe_name`;

    let vorher = null;
    if (von && bis) {
      const tage = Math.round((Date.parse(bis) - Date.parse(von)) / 86_400_000) + 1;
      const vBis = new Date(Date.parse(von) - 86_400_000).toISOString().slice(0, 10);
      const vVon = new Date(Date.parse(von) - tage * 86_400_000).toISOString().slice(0, 10);
      [vorher] = await sql`
        select coalesce(sum(-betrag_cent) filter (where not ist_einnahme), 0)::bigint::float as ausgaben_cent,
               coalesce(sum(betrag_cent) filter (where ist_einnahme), 0)::bigint::float as einnahmen_cent
          from ${fluss} where ${zeit(vVon, vBis)} and ${auswahl}`;
    }

    // Vermögen: Kontostände am Ende jedes Monats (bzw. Jahres)
    const vermoegenEinheit = einheit === "year" ? "year" : "month";
    const vermoegenKonten = einstellung.vermoegen;
    const vermoegenSql = sql`
      with k as (
        select budget, id, name from fin_konten
         where haushalt_id = ${h}
           and budget = any(${budgets}::text[]) and (${budget}::text is null or budget = ${budget})
           and (case when ${vermoegenKonten}::text[] is null then offbudget and not geschlossen
                     else (budget || ':' || id) = any(${vermoegenKonten}::text[]) end)
      ),
      perioden as (
        select generate_series(
                 date_trunc(${vermoegenEinheit}, coalesce(${von}::date, (select min(b.datum) from fin_buchungen b join k on k.budget = b.budget and k.id = b.konto_id where b.haushalt_id = ${h}))),
                 date_trunc(${vermoegenEinheit}, least(coalesce(${bis}::date, current_date), current_date)),
                 ('1 ' || ${vermoegenEinheit})::interval)::date as periode
      )
      select to_char(p.periode, 'YYYY-MM-DD') as periode, k.name,
             (select coalesce(sum(b.betrag_cent), 0) from fin_buchungen b
               where b.haushalt_id = ${h} and b.budget = k.budget and b.konto_id = k.id
                 and b.datum < p.periode + ('1 ' || ${vermoegenEinheit})::interval)::bigint::float as saldo_cent
        from k cross join perioden p
       order by 1, 2`;

    const [kennzahlen, ebeneListe, verlauf, einnahmenVerlauf, empfaenger, groesste, vermoegen, budgetListe] = await Promise.all([
      sql`select coalesce(sum(-betrag_cent) filter (where not ist_einnahme), 0)::bigint::float as ausgaben_cent,
                 coalesce(sum(betrag_cent) filter (where ist_einnahme), 0)::bigint::float as einnahmen_cent,
                 count(*) filter (where not ist_einnahme)::int as buchungen
            from ${fluss} where ${wo}`,
      sql`select ${ebene} as name, sum(-betrag_cent)::bigint::float as summe_cent, count(*)::int as anzahl
            from ${fluss} where ${wo} and not ist_einnahme
           group by 1 having sum(-betrag_cent) > 0 order by 2 desc`,
      sql`select to_char(date_trunc(${einheit}, datum::timestamp), 'YYYY-MM-DD') as periode, ${ebene} as name,
                 sum(-betrag_cent)::bigint::float as summe_cent
            from ${fluss} where ${wo} and not ist_einnahme group by 1, 2 order by 1`,
      sql`select to_char(date_trunc(${einheit}, datum::timestamp), 'YYYY-MM-DD') as periode,
                 sum(betrag_cent)::bigint::float as summe_cent
            from ${fluss} where ${wo} and ist_einnahme group by 1 order by 1`,
      sql`select empfaenger_name as name, sum(-betrag_cent)::bigint::float as summe_cent, count(*)::int as anzahl
            from ${fluss} where ${wo} and not ist_einnahme
           group by 1 having sum(-betrag_cent) > 0 order by 2 desc limit 15`,
      sql`select to_char(datum, 'YYYY-MM-DD') as datum, empfaenger_name as empfaenger, kategorie_name as kategorie,
                 konto, notiz, -betrag_cent as betrag_cent
            from ${fluss} where ${wo} and not ist_einnahme and betrag_cent < 0
           order by 6 desc limit 10`,
      vermoegenSql,
      sql`select sync_id, name, to_char(eingelesen at time zone 'Europe/Berlin', ${datumFormat(true)}) as eingelesen, buchungen, fehler
            from fin_budgets where haushalt_id = ${h} and sync_id = any(${budgets}::text[]) order by name`,
    ]);

    return { kennzahlen: kennzahlen[0], vorher, ebene: ebeneListe, verlauf, einnahmenVerlauf, empfaenger, groesste, vermoegen, budgets: budgetListe };
  });

  app.post("/api/finanzen/einlesen", async (req) => finanzenEinlesen(zugriff(req, "finanzen_sehen")));

  app.get("/api/finanzen/einstellungen", async (req) => {
    const h = zugriff(req, "verwalten");
    const budgets = await gewaehlteBudgets(h);
    const [server, konten, kategorien] = await Promise.all([
      actualBudgets(h).catch(() => []),
      sql`select k.budget, k.id, k.name, k.offbudget, k.geschlossen, coalesce(b.name, k.budget) as budget_name
            from fin_konten k left join fin_budgets b on b.haushalt_id = k.haushalt_id and b.sync_id = k.budget
           where k.haushalt_id = ${h} and k.budget = any(${budgets}::text[]) order by budget_name, k.offbudget, k.name`,
      sql`select distinct on (kategorie_id) kategorie_id as id, kategorie as name, gruppe
            from fin_buchungen where haushalt_id = ${h} and kategorie_id is not null and budget = any(${budgets}::text[])
           order by kategorie_id`,
    ]);
    return { einstellung: await finanzEinstellung(h), gewaehlt: budgets, server, konten, kategorien };
  });

  app.put<{ Body: FinanzEinstellung }>("/api/finanzen/einstellungen", async (req) => {
    const h = zugriff(req, "verwalten");
    const b = req.body ?? ({} as FinanzEinstellung);
    await einstellungSchreiben(
      "finanzen",
      { budgets: textListe(b.budgets, 20), vermoegen: Array.isArray(b.vermoegen) ? textListe(b.vermoegen) : null, ausblenden: textListe(b.ausblenden) },
      h,
    );
    return { ok: true };
  });
}
