import type { FastifyInstance } from "fastify";
import { actualKonten } from "../actual.js";
import { zugriff } from "../auth.js";
import { sql } from "../db.js";
import { t } from "../i18n.js";

type Filter = { von?: string; bis?: string; haupt?: string; unter?: string; sorte?: string; haendler?: string; konto?: string };

const datumOk = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

/** Actual-Konto eines Bons: gewähltes Konto, bei Barzahlung sonst das Bargeld-Konto aus den Actual-Einstellungen */
const KONTO_VON_BON = sql`coalesce(b.actual_konto_id, case when b.zahlung = 'bar' then
  (select e.wert->>'bargeldKonto' from einstellungen e where e.haushalt_id = b.haushalt_id and e.schluessel = 'actual') end)`;
/** Filterwert für Bons ohne Konto */
const OHNE_KONTO = "-";

function bedingung(h: number, f: Filter) {
  const von = datumOk(f.von);
  const bis = datumOk(f.bis);
  const konto = f.konto ? String(f.konto).slice(0, 100) : null;
  return sql`
    haushalt_id = ${h}
    and (${von}::date is null or datum >= ${von}::date)
    and (${bis}::date is null or datum <= ${bis}::date)
    and (${f.haupt ?? null}::text is null or hauptgruppe = ${f.haupt ?? null})
    and (${f.unter ?? null}::text is null or untergruppe = ${f.unter ?? null})
    and (${f.sorte ?? null}::text is null or sorte = ${f.sorte ?? null})
    and (${f.haendler ?? null}::text is null or haendler = ${f.haendler ?? null})
    and (${konto}::text is null or bon_id in (
      select b.id from bons b where b.haushalt_id = ${h}
         and ${konto === OHNE_KONTO ? sql`${KONTO_VON_BON} is null` : sql`${KONTO_VON_BON} = ${konto}`}))`;
}

const raster = ["day", "week", "month", "year"] as const;
const rasterAus: Record<string, (typeof raster)[number]> = { tag: "day", woche: "week", monat: "month", jahr: "year" };

export async function auswertungRouten(app: FastifyInstance) {
  // Actual-Konten, denen Bons zugeordnet sind – für den Kontofilter der Übersicht
  app.get("/api/auswertung/konten", async (req) => {
    const h = zugriff(req, "bons_sehen");
    const zeilen = await sql<{ id: string | null; bons: number }[]>`
      select ${KONTO_VON_BON} as id, count(*)::int as bons
        from bons b where b.haushalt_id = ${h} and b.datum is not null
       group by 1 order by 2 desc`;
    // Namen aus dem Finanz-Zwischenspeicher, fehlende direkt aus Actual (falls erreichbar)
    const namen = new Map(
      (
        await sql<{ id: string; name: string; budget_name: string }[]>`
          select k.id, k.name, coalesce(fb.name, k.budget) as budget_name
            from fin_konten k left join fin_budgets fb on fb.haushalt_id = k.haushalt_id and fb.sync_id = k.budget
           where k.haushalt_id = ${h}`
      ).map((k) => [k.id, k]),
    );
    if (zeilen.some((z) => z.id && !namen.has(z.id)))
      for (const k of await actualKonten(h).catch(() => [])) if (!namen.has(k.id)) namen.set(k.id, k);
    return zeilen.map((z) => ({
      id: z.id ?? OHNE_KONTO,
      name: z.id ? (namen.get(z.id)?.name ?? t("Unbekanntes Konto")) : t("Ohne Konto"),
      budget_name: z.id ? (namen.get(z.id)?.budget_name ?? null) : null,
      bons: z.bons,
    }));
  });

  app.get<{ Querystring: Filter & { raster?: string } }>("/api/auswertung", async (req) => {
    const h = zugriff(req, "bons_sehen");
    const f = req.query;
    const wo = bedingung(h, f);
    // Verlauf: Tage, Wochen (ab Montag), Monate oder Jahre
    const einheit = rasterAus[f.raster ?? "monat"] ?? "month";

    // Vergleichszeitraum gleicher Länge direkt davor
    let vorher = null;
    const von = datumOk(f.von);
    const bis = datumOk(f.bis);
    if (von && bis) {
      const tage = Math.round((Date.parse(bis) - Date.parse(von)) / 86_400_000) + 1;
      const vBis = new Date(Date.parse(von) - 86_400_000).toISOString().slice(0, 10);
      const vVon = new Date(Date.parse(von) - tage * 86_400_000).toISOString().slice(0, 10);
      [vorher] = await sql`
        select coalesce(sum(betrag_cent), 0)::int as summe_cent, count(distinct bon_id)::int as bons
          from v_positionen where ${bedingung(h, { ...f, von: vVon, bis: vBis })}`;
    }

    // Verlauf eine Ebene unter dem aktuellen Filter: Bereiche -> Gruppen -> Sorten
    const ebene = f.unter ? sql`sorte` : f.haupt ? sql`untergruppe` : sql`hauptgruppe`;
    const ebeneFarbe = f.unter ? sql`null::text` : f.haupt ? sql`untergruppe_farbe` : sql`hauptgruppe_farbe`;

    const [kennzahlen, hauptgruppen, untergruppen, sorten, verlauf, haendler, artikel, wochentage] = await Promise.all([
      sql`select coalesce(sum(betrag_cent), 0)::int as summe_cent,
                 count(distinct bon_id)::int as bons,
                 count(*)::int as positionen,
                 count(distinct artikel)::int as artikel
            from v_positionen where ${wo}`,
      sql`select hauptgruppe as name, hauptgruppe_farbe as farbe, sum(betrag_cent)::int as summe_cent, count(*)::int as anzahl
            from v_positionen where ${wo} group by 1, 2 order by 3 desc`,
      sql`select hauptgruppe, untergruppe as name, untergruppe_farbe as farbe,
                 sum(betrag_cent)::int as summe_cent, count(*)::int as anzahl
            from v_positionen where ${wo} group by 1, 2, 3 order by 4 desc`,
      sql`select untergruppe, sorte as name, untergruppe_farbe as farbe,
                 sum(betrag_cent)::int as summe_cent, count(*)::int as anzahl
            from v_positionen where ${wo} and untergruppe <> 'Pfand'
           group by 1, 2, 3 having sum(betrag_cent) > 0 order by 4 desc limit 60`,
      sql`select to_char(date_trunc(${einheit}, datum::timestamp), 'YYYY-MM-DD') as periode,
                 ${ebene} as name,
                 ${ebeneFarbe} as farbe,
                 sum(betrag_cent)::int as summe_cent
            from v_positionen where ${wo} group by 1, 2, 3 order by 1`,
      sql`select coalesce(haendler, ${t("Unbekannt")}) as name, sum(betrag_cent)::int as summe_cent,
                 count(distinct bon_id)::int as bons
            from v_positionen where ${wo} group by 1 order by 2 desc limit 15`,
      sql`select artikel as name, untergruppe, untergruppe_farbe as farbe,
                 count(*)::int as kaeufe, sum(betrag_cent)::int as summe_cent,
                 round(avg(coalesce(einzelpreis_cent, betrag_cent)))::int as schnitt_cent
            from v_positionen where ${wo} and betrag_cent > 0 and untergruppe <> 'Pfand'
           group by 1, 2, 3 order by 5 desc limit 25`,
      sql`select extract(isodow from datum)::int as tag, sum(betrag_cent)::int as summe_cent,
                 count(distinct bon_id)::int as bons
            from v_positionen where ${wo} group by 1 order by 1`,
    ]);

    return { kennzahlen: kennzahlen[0], vorher, hauptgruppen, untergruppen, sorten, verlauf, haendler, artikel, wochentage };
  });

  // Einzelne Posten hinter einem Balken/Eintrag der Übersicht – mit Bon, damit man es nachvollziehen kann
  app.get<{ Querystring: Filter & { artikel?: string; wochentag?: string } }>("/api/auswertung/posten", async (req) => {
    const h = zugriff(req, "bons_sehen");
    const f = req.query;
    const artikel = f.artikel ?? null;
    const tag = f.wochentag ? Number(f.wochentag) : null;
    const posten = await sql`
      select bon_id, to_char(datum, 'YYYY-MM-DD') as datum, coalesce(haendler, ${t("Unbekannt")}) as haendler,
             artikel, sorte, untergruppe, untergruppe_farbe as farbe, menge, einheit, einzelpreis_cent, betrag_cent
        from v_positionen
       where ${bedingung(h, f)}
         and (${artikel}::text is null or artikel = ${artikel})
         and (${tag}::int is null or extract(isodow from datum) = ${tag})
       order by datum desc, bon_id desc
       limit 500`;
    return {
      posten,
      summe_cent: posten.reduce((s, p) => s + Number(p.betrag_cent), 0),
      bons: new Set(posten.map((p) => p.bon_id)).size,
      begrenzt: posten.length === 500,
    };
  });

  // Preisänderungen: letzter Preis im Zeitraum gegen den Preis davor – je Artikel und Geschäft, die größten zuerst
  app.get<{ Querystring: Filter }>("/api/auswertung/preise", async (req) => {
    const h = zugriff(req, "bons_sehen");
    const f = req.query;
    const von = datumOk(f.von);
    type Zeile = {
      name: string; haendler: string | null; untergruppe: string; farbe: string; einheit: string | null;
      datum: string; preis_cent: number; alt_datum: string; alt_cent: number;
    };
    // Vergleichspreis: der letzte Kauf vor dem Zeitraum, sonst der erste im Zeitraum. Verglichen wird der Preis je
    // Stück/Einheit: der Einzelpreis vom Bon, sonst Betrag durch Menge. Nur Käufe mit gleicher Einheit.
    const zeilen = await sql<Zeile[]>`
      with p as (
        select position_id, artikel, coalesce(haendler, '') as haendler, untergruppe, untergruppe_farbe as farbe,
               datum, einheit,
               coalesce(einzelpreis_cent, case when menge > 0 then round(betrag_cent / menge) end, betrag_cent)::int as preis_cent
          from v_positionen
         where ${bedingung(h, { ...f, von: undefined })} and betrag_cent > 0 and untergruppe <> 'Pfand'
      ),
      neu as (
        select distinct on (artikel, haendler) * from p
         where (${von}::date is null or datum >= ${von}::date)
         order by artikel, haendler, datum desc, position_id desc
      )
      select n.artikel as name, nullif(n.haendler, '') as haendler, n.untergruppe, n.farbe, n.einheit,
             to_char(n.datum, 'YYYY-MM-DD') as datum, n.preis_cent,
             to_char(a.datum, 'YYYY-MM-DD') as alt_datum, a.preis_cent as alt_cent
        from neu n cross join lateral (
          select a.datum, a.preis_cent from p a
           where a.artikel = n.artikel and a.haendler = n.haendler and a.datum < n.datum
             and a.einheit is not distinct from n.einheit
           order by (a.datum < ${von}::date) desc nulls last,
                    case when a.datum < ${von}::date then a.datum end desc nulls last,
                    a.datum, a.position_id
           limit 1) a
       where a.preis_cent > 0 and a.preis_cent <> n.preis_cent`;
    const alle = zeilen.map((z) => ({ ...z, prozent: ((z.preis_cent - z.alt_cent) / z.alt_cent) * 100 }));
    const groesste = (liste: typeof alle) =>
      liste
        .sort((a, b) => Math.abs(b.prozent) - Math.abs(a.prozent) || Math.abs(b.preis_cent - b.alt_cent) - Math.abs(a.preis_cent - a.alt_cent))
        .slice(0, 100);
    const teurer = alle.filter((z) => z.prozent > 0);
    const guenstiger = alle.filter((z) => z.prozent < 0);
    return { teurer: groesste(teurer), guenstiger: groesste(guenstiger), teurer_gesamt: teurer.length, guenstiger_gesamt: guenstiger.length };
  });

  app.get<{ Querystring: Filter & { suche?: string } }>("/api/artikel", async (req) => {
    const h = zugriff(req, "bons_sehen");
    const suche = req.query.suche ? `%${req.query.suche}%` : null;
    return sql`
      select artikel as name, untergruppe, untergruppe_farbe as farbe,
             count(*)::int as kaeufe, sum(betrag_cent)::int as summe_cent,
             min(coalesce(einzelpreis_cent, betrag_cent))::int as min_cent,
             max(coalesce(einzelpreis_cent, betrag_cent))::int as max_cent,
             (array_agg(coalesce(einzelpreis_cent, betrag_cent) order by datum desc))[1]::int as letzter_cent,
             to_char(max(datum), 'YYYY-MM-DD') as zuletzt,
             array_agg(distinct haendler) as haendler
        from v_positionen
       where ${bedingung(h, req.query)} and betrag_cent > 0
         and (${suche}::text is null or artikel ilike ${suche} or text_roh ilike ${suche} or sorte ilike ${suche})
       group by 1, 2, 3
       order by 5 desc
       limit 300`;
  });

  /** Alle Sorten mit Häufigkeit, Ausgaben und häufigster Untergruppe – durchsuchbar */
  app.get<{ Querystring: Filter & { suche?: string } }>("/api/sorten/uebersicht", async (req) => {
    const h = zugriff(req, "bons_sehen");
    const suche = req.query.suche ? `%${req.query.suche}%` : null;
    return sql`
      select sorte as name, count(*)::int as kaeufe, sum(betrag_cent)::int as summe_cent,
             count(distinct artikel)::int as artikel, to_char(max(datum), 'YYYY-MM-DD') as zuletzt,
             split_part(mode() within group (order by untergruppe_farbe || '|' || untergruppe), '|', 2) as untergruppe,
             split_part(mode() within group (order by untergruppe_farbe || '|' || untergruppe), '|', 1) as farbe
        from v_positionen
       where ${bedingung(h, req.query)} and sorte is not null and sorte <> '' and betrag_cent > 0
         and (${suche}::text is null or sorte ilike ${suche} or artikel ilike ${suche} or untergruppe ilike ${suche})
       group by sorte
       order by 3 desc
       limit 500`;
  });

  app.get<{ Querystring: { name: string } }>("/api/artikel/verlauf", async (req) =>
    sql`
      select to_char(datum, 'YYYY-MM-DD') as datum, haendler, bon_id, menge, einheit,
             coalesce(einzelpreis_cent, betrag_cent)::int as preis_cent, betrag_cent
        from v_positionen
       where haushalt_id = ${zugriff(req, "bons_sehen")} and artikel = ${req.query.name ?? ""} and betrag_cent > 0
       order by datum`,
  );
}
