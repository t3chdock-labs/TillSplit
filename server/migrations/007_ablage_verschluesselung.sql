-- Ablage nach frei zusammengestellter Vorlage, optionale Verschlüsselung der Bon-Dateien,
-- und Merker, ob TillSplit eine Actual-Buchung selbst angelegt hat (für das Zurücknehmen beim Löschen)

alter table haushalte add column ablage_vorlage text not null default '{Jahr}/{Monat}/{Datum}_{Händler}_{Summe}';
alter table haushalte add column verschluesseln boolean not null default false;

alter table bons add column verschluesselt boolean not null default false;
-- true: Buchung wurde von TillSplit neu angelegt (Barbon) -> beim Löschen entfernen;
-- false: vorhandene Bankbuchung wurde nur aufgeteilt -> beim Löschen Aufteilung zurücknehmen
alter table bons add column actual_tx_angelegt boolean not null default false;
update bons set actual_tx_angelegt = true where zahlung = 'bar' and actual_tx_id is not null;
