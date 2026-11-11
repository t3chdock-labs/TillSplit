-- Sammelbuchung: mehrere Bons teilen sich eine Abbuchung in Actual (z. B. mehrere Amazon-Rechnungen, eine Abbuchung)
alter table bons add column if not exists sammel boolean not null default false;

-- eine Abbuchung gehört weiterhin zu genau einem Bon – außer bei Sammelbuchungen
drop index if exists bons_actual_tx_idx;
create unique index bons_actual_tx_idx on bons (haushalt_id, actual_tx_id) where actual_tx_id is not null and not sammel;
create index if not exists bons_sammel_idx on bons (haushalt_id, actual_tx_id) where sammel;

-- Vorschläge aus dem Abgleich: offene Bons, deren Summe genau eine Abbuchung ergibt
create table if not exists sammel_vorschlaege (
  id           serial primary key,
  haushalt_id  int not null references haushalte(id) on delete cascade,
  bon_ids      int[] not null,
  actual_tx_id text not null,
  budget       text not null,
  konto_id     text not null,
  konto        text not null,
  datum        date not null,
  betrag_cent  int not null,
  empfaenger   text not null default '',
  verworfen    boolean not null default false,
  erstellt_am  timestamptz not null default now(),
  unique (haushalt_id, actual_tx_id)
);
