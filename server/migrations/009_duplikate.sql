-- Mögliche Duplikate: gleicher Händler, gleiches Datum, gleiche Summe wie ein älterer Bon (z. B. zweimal fotografiert)
alter table bons add column dublette_von integer references bons(id) on delete set null;
-- vom Benutzer bestätigt: kein Duplikat (z. B. zweimal am selben Tag das Gleiche gekauft)
alter table bons add column dublette_ok boolean not null default false;
