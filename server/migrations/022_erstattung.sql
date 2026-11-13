-- Erstattung: Beleg über zurückbekommenes Geld (Rücksendung, Gutschrift) mit negativen Beträgen,
-- verknüpft mit dem ursprünglichen Bon. Der Geldeingang in Actual wird den Bereichen des Kaufs zugeordnet.
alter table bons add column if not exists erstattung boolean not null default false;
alter table bons add column if not exists erstattung_von integer references bons(id) on delete set null;
-- true = Ursprungsbon von Hand gewählt oder entfernt -> nicht erneut automatisch suchen
alter table bons add column if not exists erstattung_fest boolean not null default false;
-- Bestell- oder Auftragsnummer (Onlinebestellungen): Rechnung und Gutschrift tragen dieselbe Nummer
alter table bons add column if not exists bestellnummer text;
create index if not exists bons_erstattung_von_idx on bons (erstattung_von) where erstattung_von is not null;
