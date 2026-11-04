-- Verbrauch und Kosten der KI-Erkennung je Bon
alter table bons add column ki_eingabe_tokens integer;
alter table bons add column ki_ausgabe_tokens integer;
alter table bons add column ki_cache_tokens integer;   -- aus dem Zwischenspeicher gelesen
alter table bons add column ki_kosten_usd numeric(10, 5);
alter table bons add column ki_sekunden numeric(7, 1);
