-- Darstellung je Benutzer (Hell/Dunkel/System, Akzentfarbe) – gilt auf allen Geräten
alter table benutzer add column if not exists darstellung jsonb;
