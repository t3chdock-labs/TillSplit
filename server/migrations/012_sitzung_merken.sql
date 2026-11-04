-- „Angemeldet bleiben“: gemerkte Sitzungen gelten SITZUNG_TAGE (Standard 30), andere nur bis zum Schließen des Browsers / 12 Stunden
alter table sitzungen add column merken boolean not null default true;
