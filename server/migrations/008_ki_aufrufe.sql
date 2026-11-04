-- Jede KI-Anfrage einzeln, damit Nachlesen und Neu-Lesen in der Kostenstatistik nicht verloren gehen
create table ki_aufrufe (
  id             serial primary key,
  haushalt_id    integer references haushalte(id) on delete cascade,
  bon_id         integer references bons(id) on delete set null,
  zeit           timestamptz not null default now(),
  anlass         text not null check (anlass in ('erkennung', 'nachlesen', 'manuell')),
  anbieter       text not null,
  modell         text not null,
  eingabe_tokens integer,
  ausgabe_tokens integer,
  cache_tokens   integer,
  kosten_usd     numeric(10, 5),
  sekunden       numeric(7, 1)
);
create index ki_aufrufe_haushalt_zeit_idx on ki_aufrufe (haushalt_id, zeit);

-- bisherige Erkennungen übernehmen (Erst- und Nachlesen sind dort schon zusammengezählt)
insert into ki_aufrufe (haushalt_id, bon_id, zeit, anlass, anbieter, modell, eingabe_tokens, ausgabe_tokens, cache_tokens, kosten_usd, sekunden)
select haushalt_id, id, erstellt_am, 'erkennung', coalesce(ki_anbieter, 'claude'), ki_modell,
       ki_eingabe_tokens, ki_ausgabe_tokens, ki_cache_tokens, ki_kosten_usd, ki_sekunden
  from bons where ki_modell is not null;

-- Ergeben die Positionen die Bon-Summe? (false = günstiges Modell hat sich vermutlich verlesen)
alter table bons add column ki_summe_passt boolean;
