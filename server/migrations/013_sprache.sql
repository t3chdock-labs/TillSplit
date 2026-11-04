-- Oberflächensprache je Benutzer (null = Browsersprache)
alter table benutzer add column if not exists sprache text;
