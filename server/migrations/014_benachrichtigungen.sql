-- Benachrichtigungen je Benutzer: Glocke in der Oberfläche, gesammelt per E-Mail und Telegram
create table benachrichtigungen (
  id          bigserial primary key,
  benutzer_id integer not null references benutzer(id) on delete cascade,
  haushalt_id integer references haushalte(id) on delete cascade,
  art         text not null,                 -- hochgeladen | erkannt | erinnerung | test
  daten       jsonb not null default '{}',   -- Werte für den Text (wird in der Sprache des Lesers erzeugt)
  erstellt_am timestamptz not null default now(),
  glocke      boolean not null default true, -- in der Oberfläche anzeigen
  gelesen_am  timestamptz,
  mail_offen  boolean not null default false,
  telegram_offen boolean not null default false
);
create index benachrichtigungen_benutzer_idx on benachrichtigungen (benutzer_id, erstellt_am desc);
create index benachrichtigungen_offen_idx on benachrichtigungen (benutzer_id) where mail_offen or telegram_offen;

alter table benutzer add column if not exists benachrichtigung jsonb not null default '{}';
alter table benutzer add column if not exists telegram_chat_id text;
alter table benutzer add column if not exists erinnerung_am timestamptz;