-- Position unsicher gelesen (Zeile unleserlich, Artikel oder Gruppe geraten) – muss beim Prüfen bestätigt werden
alter table positionen add column if not exists unsicher boolean not null default false;
-- bisherige Bons: Platzhalter-Namen der KI nachträglich markieren
update positionen set unsicher = true where name ~* '(unbekannt|unleserlich|unknown|unreadable|illegible)';