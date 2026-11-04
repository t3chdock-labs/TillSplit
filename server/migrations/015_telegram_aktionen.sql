-- Knöpfe in Telegram-Nachrichten (z. B. „Mit Sonnet nachlesen“): TillSplit reagiert nur auf diese selbst erzeugten,
-- einmal gültigen Kennungen – nie auf frei geschriebenen Text
create table telegram_aktionen (
  token       text primary key,
  benutzer_id integer not null references benutzer(id) on delete cascade,
  bon_id      integer not null references bons(id) on delete cascade,
  modell      text not null,
  erstellt_am timestamptz not null default now(),
  benutzt_am  timestamptz
);