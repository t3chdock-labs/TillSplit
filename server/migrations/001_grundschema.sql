-- TillSplit Grundschema
-- Beträge immer in Cent (integer), Datumswerte als date.

create table gruppen (
  id            serial primary key,
  name          text not null,
  eltern_id     integer references gruppen(id) on delete cascade,
  farbe         text not null default '#64748b',
  sortierung    integer not null default 0,
  -- nur bei Hauptgruppen: Ziel-Kategorie in Actual
  actual_kategorie_id text,
  unique (eltern_id, name)
);

create table haendler (
  id     serial primary key,
  name   text not null unique,
  -- optionale Standard-Hauptgruppe, z. B. Baumarkt für OBI
  standard_gruppe_id integer references gruppen(id) on delete set null
);

create table bons (
  id               serial primary key,
  status           text not null default 'neu'
                   check (status in ('neu','in_arbeit','erkannt','geprueft','gebucht','fehler')),
  fehler           text,
  haendler_id      integer references haendler(id) on delete set null,
  filiale          text,
  datum            date,
  uhrzeit          text,
  summe_cent       integer,
  zahlart          text,
  notiz            text,
  datei_pfad       text not null,
  datei_mime       text not null,
  datei_sha256     text not null unique,
  datei_name       text,
  ki_anbieter      text,
  ki_modell        text,
  ki_rohdaten      jsonb,
  actual_tx_id     text,
  actual_konto_id  text,
  gebucht_am       timestamptz,
  erstellt_am      timestamptz not null default now(),
  geaendert_am     timestamptz not null default now()
);
create index bons_datum_idx on bons (datum);
create index bons_status_idx on bons (status);

create table positionen (
  id              serial primary key,
  bon_id          integer not null references bons(id) on delete cascade,
  nr              integer not null,
  text_roh        text not null,
  name            text not null,
  menge           numeric(10,3),
  einheit         text,
  einzelpreis_cent integer,
  betrag_cent     integer not null,
  gruppe_id       integer references gruppen(id) on delete set null,
  -- woher die Gruppe stammt: ki | regel | hand
  gruppe_quelle   text not null default 'ki'
);
create index positionen_bon_idx on positionen (bon_id);
create index positionen_name_idx on positionen (lower(name));

-- Gelernte Zuordnungen: Kassenbon-Text -> Untergruppe (optional je Händler)
create table regeln (
  id          serial primary key,
  muster      text not null,
  haendler_id integer references haendler(id) on delete cascade,
  gruppe_id   integer not null references gruppen(id) on delete cascade,
  name        text,
  treffer     integer not null default 0,
  erstellt_am timestamptz not null default now()
);
create unique index regeln_muster_idx on regeln (muster, coalesce(haendler_id, 0));

create table einstellungen (
  schluessel text primary key,
  wert       jsonb not null
);

-- Auswertungs-Sicht (auch für Grafana gedacht)
create view v_positionen as
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
 where b.status in ('geprueft','gebucht');

-- Startgruppen (in der Oberfläche frei änderbar)
with h as (
  insert into gruppen (name, farbe, sortierung) values
    ('Lebensmittel', '#16a34a', 1),
    ('Drogerie',     '#db2777', 2),
    ('Haushalt',     '#0891b2', 3),
    ('Baumarkt',     '#ea580c', 4),
    ('Tier',         '#a16207', 5),
    ('Kleidung',     '#7c3aed', 6),
    ('Sonstiges',    '#64748b', 9)
  returning id, name
)
insert into gruppen (name, eltern_id, farbe, sortierung)
select u.name, h.id, u.farbe, u.sortierung
  from h
  join (values
    ('Lebensmittel', 'Obst',                     '#84cc16', 1),
    ('Lebensmittel', 'Gemüse',                   '#22c55e', 2),
    ('Lebensmittel', 'Brot & Backwaren',         '#d97706', 3),
    ('Lebensmittel', 'Milchprodukte & Eier',     '#facc15', 4),
    ('Lebensmittel', 'Käse',                     '#fbbf24', 5),
    ('Lebensmittel', 'Fleisch & Wurst',          '#dc2626', 6),
    ('Lebensmittel', 'Fisch',                    '#0ea5e9', 7),
    ('Lebensmittel', 'Tiefkühl',                 '#38bdf8', 8),
    ('Lebensmittel', 'Nudeln, Reis & Vorrat',    '#a8a29e', 9),
    ('Lebensmittel', 'Konserven & Fertiggerichte','#78716c', 10),
    ('Lebensmittel', 'Gewürze, Öl & Saucen',     '#b45309', 11),
    ('Lebensmittel', 'Süßigkeiten & Snacks',     '#ec4899', 12),
    ('Lebensmittel', 'Getränke',                 '#3b82f6', 13),
    ('Lebensmittel', 'Alkohol',                  '#9333ea', 14),
    ('Lebensmittel', 'Kaffee & Tee',             '#92400e', 15),
    ('Lebensmittel', 'Pfand',                    '#94a3b8', 16),
    ('Drogerie',     'Körperpflege',             '#f472b6', 1),
    ('Drogerie',     'Kosmetik',                 '#e879f9', 2),
    ('Drogerie',     'Hygiene & Papier',         '#f9a8d4', 3),
    ('Drogerie',     'Gesundheit & Medikamente', '#f43f5e', 4),
    ('Drogerie',     'Baby',                     '#fda4af', 5),
    ('Haushalt',     'Reinigung & Waschmittel',  '#06b6d4', 1),
    ('Haushalt',     'Küche & Haushaltswaren',   '#22d3ee', 2),
    ('Haushalt',     'Deko & Wohnen',            '#67e8f9', 3),
    ('Baumarkt',     'Werkzeug',                 '#f97316', 1),
    ('Baumarkt',     'Baumaterial',              '#fb923c', 2),
    ('Baumarkt',     'Garten & Pflanzen',        '#65a30d', 3),
    ('Baumarkt',     'Elektro & Beleuchtung',    '#fdba74', 4),
    ('Tier',         'Tierfutter',               '#ca8a04', 1),
    ('Tier',         'Tierbedarf',               '#eab308', 2),
    ('Kleidung',     'Kleidung & Schuhe',        '#8b5cf6', 1),
    ('Sonstiges',    'Sonstiges',                '#94a3b8', 1)
  ) as u(haupt, name, farbe, sortierung) on u.haupt = h.name;
