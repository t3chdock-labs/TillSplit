import type { FastifyInstance } from "fastify";
import { zugriff } from "../auth.js";
import { sql } from "../db.js";
import { t } from "../i18n.js";
import { waehrungMitKurs } from "../ki/index.js";
import { modellName } from "../ki/kosten.js";

const datumOk = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const rasterAus: Record<string, string> = { tag: "day", woche: "week", monat: "month", jahr: "year" };
const ZONE = "Europe/Berlin";

/** Bon-Eingang und KI-Kosten: wann kam was herein, was hat das Lesen gekostet */
export async function statistikRouten(app: FastifyInstance) {
  app.get<{ Querystring: { von?: string; bis?: string; raster?: string } }>("/api/statistik", async (req) => {
    const h = zugriff(req, "verwalten");
    const von = datumOk(req.query.von);
    const bis = datumOk(req.query.bis);
    const einheit = rasterAus[req.query.raster ?? "monat"] ?? "month";
    // Zeitraum nach Eingang (Hochladen) bzw. Zeitpunkt der KI-Anfrage, in deutscher Zeit
    const imZeitraum = (spalte: ReturnType<typeof sql>) => sql`
      (${von}::date is null or (${spalte} at time zone ${ZONE})::date >= ${von}::date)
      and (${bis}::date is null or (${spalte} at time zone ${ZONE})::date <= ${bis}::date)`;
    const bonsWo = sql`b.haushalt_id = ${h} and ${imZeitraum(sql`b.erstellt_am`)}`;
    const kiWo = sql`k.haushalt_id = ${h} and ${imZeitraum(sql`k.zeit`)}`;
    // Kosten in der Anzeigewährung, jede Anfrage mit dem Kurs ihres Tages
    const { waehrung: w } = await waehrungMitKurs();

    const [[bons], [ki], eingang, kosten, modelle, anlaesse, personen, stunden, teuerste] = await Promise.all([
      sql<{ bons: number; fehler: number; offen: number; summe_falsch: number; nachgelesen: number }[]>`
        select count(*)::int as bons,
               count(*) filter (where b.status = 'fehler')::int as fehler,
               count(*) filter (where b.status = 'erkannt')::int as offen,
               count(*) filter (where b.ki_summe_passt = false)::int as summe_falsch,
               count(*) filter (where (select count(*) from ki_aufrufe a where a.bon_id = b.id) > 1)::int as nachgelesen
          from bons b where ${bonsWo}`,
      sql<{ aufrufe: number; kosten: number; sekunden: number; eingabe: number; ausgabe: number; cache: number; bons: number }[]>`
        select count(*)::int as aufrufe, coalesce(sum(usd_in(kosten_usd, zeit, ${w})), 0)::float as kosten,
               coalesce(avg(sekunden), 0)::float as sekunden,
               coalesce(sum(eingabe_tokens), 0)::bigint::float as eingabe, coalesce(sum(ausgabe_tokens), 0)::bigint::float as ausgabe,
               coalesce(sum(cache_tokens), 0)::bigint::float as cache, count(distinct bon_id)::int as bons
          from ki_aufrufe k where ${kiWo}`,
      // Eingang je Zeitabschnitt, aufgeteilt nach hochladender Person
      sql`select to_char(date_trunc(${einheit}, b.erstellt_am at time zone ${ZONE}), 'YYYY-MM-DD') as periode,
                 coalesce(u.name, ${t("Unbekannt")}) as name, count(*)::int as anzahl
            from bons b left join benutzer u on u.id = b.hochgeladen_von
           where ${bonsWo} group by 1, 2 order by 1`,
      // KI-Kosten je Zeitabschnitt und Modell
      sql<{ periode: string; modell: string; kosten: number; aufrufe: number }[]>`
        select to_char(date_trunc(${einheit}, k.zeit at time zone ${ZONE}), 'YYYY-MM-DD') as periode,
               k.modell, coalesce(sum(usd_in(k.kosten_usd, k.zeit, ${w})), 0)::float as kosten, count(*)::int as aufrufe
          from ki_aufrufe k where ${kiWo} group by 1, 2 order by 1`,
      sql<{ modell: string; aufrufe: number; kosten: number; eingabe: number; ausgabe: number; sekunden: number }[]>`
        select k.modell, count(*)::int as aufrufe, coalesce(sum(usd_in(kosten_usd, zeit, ${w})), 0)::float as kosten,
               coalesce(sum(eingabe_tokens), 0)::bigint::float as eingabe, coalesce(sum(ausgabe_tokens), 0)::bigint::float as ausgabe,
               coalesce(avg(sekunden), 0)::float as sekunden
          from ki_aufrufe k where ${kiWo} group by 1 order by 3 desc`,
      sql`select anlass, count(*)::int as aufrufe, coalesce(sum(usd_in(kosten_usd, zeit, ${w})), 0)::float as kosten
            from ki_aufrufe k where ${kiWo} group by 1 order by 2 desc`,
      sql`select coalesce(u.name, ${t("Unbekannt")}) as name, count(*)::int as bons, coalesce(sum(bk.betrag), 0)::float as kosten
            from bons b left join benutzer u on u.id = b.hochgeladen_von
            left join lateral (select sum(usd_in(a.kosten_usd, a.zeit, ${w})) as betrag from ki_aufrufe a where a.bon_id = b.id) bk on true
           where ${bonsWo} group by 1 order by 2 desc`,
      // Uhrzeit des Hochladens (wann wird fotografiert?)
      sql`select extract(hour from b.erstellt_am at time zone ${ZONE})::int as stunde, count(*)::int as anzahl
            from bons b where ${bonsWo} group by 1 order by 1`,
      sql`select b.id, coalesce(hd.name, ${t("Unbekannt")}) as haendler, to_char(b.datum, 'YYYY-MM-DD') as datum,
                 (select sum(usd_in(a.kosten_usd, a.zeit, ${w})) from ki_aufrufe a where a.bon_id = b.id)::float as kosten, b.ki_modell as modell,
                 (select count(*) from positionen p where p.bon_id = b.id)::int as positionen
            from bons b left join haendler hd on hd.id = b.haendler_id
           where ${bonsWo} and b.ki_kosten_usd is not null
           order by 4 desc limit 10`,
    ]);

    const name = (m: string) => modellName(m.replace(/^tesseract \+ /, "")) + (m.startsWith("tesseract") ? " (Tesseract)" : "");
    return {
      waehrung: w,
      kennzahlen: { ...bons, ...ki, kostenJeBon: ki.bons ? ki.kosten / ki.bons : 0 },
      eingang,
      kosten: kosten.map((k) => ({ ...k, modell: name(k.modell) })),
      modelle: modelle.map((m) => ({ ...m, modell: name(m.modell) })),
      anlaesse,
      personen,
      stunden,
      teuerste: teuerste.map((t) => ({ ...t, modell: t.modell ? name(t.modell) : null })),
    };
  });
}
