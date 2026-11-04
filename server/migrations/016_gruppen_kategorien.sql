-- Actual-Kategorie einer Warengruppe in weiteren Buchungs-Budgets (z. B. Haushaltskonto).
-- Das Haupt-Budget des Haushalts nutzt weiterhin gruppen.actual_kategorie_id.
create table gruppen_kategorien (
  gruppe_id    integer not null references gruppen(id) on delete cascade,
  sync_id      text not null,
  kategorie_id text not null,
  primary key (gruppe_id, sync_id)
);