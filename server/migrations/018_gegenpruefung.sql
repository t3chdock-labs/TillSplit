-- Gegenprüfung Bild <-> erkannte Daten: unabhängig per Tesseract gelesener Text und Ergebnis (ok | abweichung | unbekannt)
alter table bons add column if not exists pruef_text text;
alter table bons add column if not exists gegenpruefung text;