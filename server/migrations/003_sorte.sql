-- Dritte Ebene unter der Untergruppe: allgemeine Warensorte ohne Marke und Größe,
-- z. B. Gemüse -> Tomate, Gurke; Süßigkeiten -> Schokolade, Fruchtgummi; Getränke -> Cola, Mineralwasser, Saft

alter table positionen add column sorte text;
alter table regeln add column sorte text;
create index positionen_sorte_idx on positionen (sorte);

drop view v_positionen;
create view v_positionen as
select p.id              as position_id,
       b.id              as bon_id,
       b.datum,
       date_trunc('month', b.datum)::date as monat,
       h.name            as haendler,
       coalesce(hg.name, ug.name, 'Ohne Gruppe') as hauptgruppe,
       coalesce(ug.name, 'Ohne Gruppe')          as untergruppe,
       coalesce(nullif(p.sorte, ''), p.name)     as sorte,
       coalesce(hg.farbe, ug.farbe, '#94a3b8')   as hauptgruppe_farbe,
       coalesce(ug.farbe, '#94a3b8')             as untergruppe_farbe,
       p.name            as artikel,
       p.text_roh,
       p.menge,
       p.einheit,
       p.einzelpreis_cent,
       p.betrag_cent,
       p.betrag_cent / 100.0 as betrag_eur
  from positionen p
  join bons b on b.id = p.bon_id
  left join haendler h on h.id = b.haendler_id
  left join gruppen ug on ug.id = p.gruppe_id
  left join gruppen hg on hg.id = ug.eltern_id
 where b.status in ('geprueft','wartet','gebucht');
