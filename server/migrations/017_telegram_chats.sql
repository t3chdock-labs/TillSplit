-- Mehrere Telegram-Chats je Benutzer: eigene Chats (privat) und Gruppen (z. B. „Familie“)
create table telegram_chats (
  id          serial primary key,
  benutzer_id integer not null references benutzer(id) on delete cascade,
  chat_id     text not null,
  titel       text not null default '',
  gruppe      boolean not null default false, -- Gruppen bekommen keine Knöpfe (jeder dort könnte sie drücken)
  erstellt_am timestamptz not null default now(),
  unique (benutzer_id, chat_id)
);
-- eine Gruppe nur einmal verbinden, sonst kämen die Meldungen dort mehrfach an
create unique index telegram_chats_gruppe_idx on telegram_chats (chat_id) where gruppe;

insert into telegram_chats (benutzer_id, chat_id, titel)
  select id, telegram_chat_id, 'Telegram' from benutzer where telegram_chat_id is not null;
alter table benutzer drop column telegram_chat_id;