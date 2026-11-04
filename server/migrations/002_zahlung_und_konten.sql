-- Zahlart, Konto und automatischer Abgleich mit Actual

alter table bons drop constraint if exists bons_status_check;
alter table bons add constraint bons_status_check
  check (status in ('neu','in_arbeit','erkannt','geprueft','wartet','gebucht','fehler'));

-- bar | karte | unbekannt; Quelle: ki (vom Bon gelesen) oder hand (beim Hochladen/Prüfen gewählt)
alter table bons add column zahlung text not null default 'unbekannt'
  check (zahlung in ('bar','karte','unbekannt'));
alter table bons add column zahlung_quelle text not null default 'ki';
-- nur die letzten 4 Ziffern der Karte, nie die ganze Nummer
alter table bons add column karte_endziffern text check (karte_endziffern ~ '^[0-9]{4}$');
-- actual_konto_id ist ab jetzt auch das gewünschte Konto vor der Buchung; Quelle: hand | karte | bargeld
alter table bons add column konto_quelle text;
alter table bons add column abgleich_hinweis text;
alter table bons add column abgleich_am timestamptz;

-- eine Actual-Buchung darf nur zu einem Bon gehören
create unique index bons_actual_tx_idx on bons (actual_tx_id) where actual_tx_id is not null;

-- Karte (letzte 4 Ziffern) -> Actual-Konto, z. B. 1234 -> "DKB", 5678 -> "Haushalt"
create table kartenzuordnung (
  endziffern      text primary key check (endziffern ~ '^[0-9]{4}$'),
  actual_konto_id text not null,
  bezeichnung     text
);

create or replace view v_positionen as
select p.id              as position_id,
       b.id              as bon_id,
       b.datum,
       date_trunc('month', b.datum)::date as monat,
       h.name            as haendler,
       coalesce(hg.name, ug.name, 'Ohne Gruppe') as hauptgruppe,
       coalesce(ug.name, 'Ohne Gruppe')          as untergruppe,
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
