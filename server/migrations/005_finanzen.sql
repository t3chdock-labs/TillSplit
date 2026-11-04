-- Finanz-Dashboard: Kopie der Actual-Buchungen aller gewählten Budgets (wird regelmäßig neu eingelesen)
create table fin_konten (
  budget      text not null,   -- Sync-ID
  id          text not null,
  name        text not null,
  offbudget   boolean not null default false,
  geschlossen boolean not null default false,
  primary key (budget, id)
);

-- Eine Zeile je Buchung; aufgeteilte Buchungen werden in ihre Teile zerlegt
create table fin_buchungen (
  budget        text not null,
  id            text not null,
  konto_id      text not null,
  datum         date not null,
  betrag_cent   integer not null,
  kategorie_id  text,
  kategorie     text,
  gruppe        text,
  einnahme      boolean not null default false,   -- Kategorie gehört zu einer Einnahmen-Gruppe
  empfaenger    text,
  notiz         text,
  umbuchung     boolean not null default false,   -- Überweisung zwischen eigenen Konten
  primary key (budget, id)
);
create index fin_buchungen_datum_idx on fin_buchungen (datum);
create index fin_buchungen_konto_idx on fin_buchungen (budget, konto_id, datum);

create table fin_budgets (
  sync_id      text primary key,
  name         text not null,
  eingelesen   timestamptz,
  buchungen    integer,
  fehler       text
);
