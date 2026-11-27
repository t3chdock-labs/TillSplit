-- Sammelkarte: Kreditkarte, deren Umsätze gesammelt abgebucht werden (z. B. Amazon Visa -> eine Abbuchung je Abrechnung vom Girokonto)
alter table kartenzuordnung add column if not exists sammel boolean not null default false;
-- Suchwörter für den Empfänger der Abbuchung, durch Komma getrennt (leer = Openbank, Zinia)
alter table kartenzuordnung add column if not exists empfaenger text;

-- Vorschläge aus der Kartenabrechnung: Karte (letzte 4 Ziffern) und Differenz, falls keine Auswahl genau passt
alter table sammel_vorschlaege add column if not exists karte text;
alter table sammel_vorschlaege add column if not exists differenz_cent int not null default 0;
