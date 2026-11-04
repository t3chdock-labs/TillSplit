-- Mehrere Benutzer und Haushalte mit Rechten, Sitzungen, Zwei-Faktor-Anmeldung und Protokoll.
-- Alle bisherigen Daten gehören danach zum Haushalt 1.

create table haushalte (
  id                  serial primary key,
  name                text not null,
  -- Bon-Ablage: Unterordner von BON_DIR oder absoluter Pfad innerhalb von ABLAGE_WURZELN; '' = BON_DIR selbst
  ablage_pfad         text not null default '',
  -- Actual-Zugang (Passwörter verschlüsselt); leer = beim Haushalt 1 die Umgebungsvariablen
  actual_url          text,
  actual_sync_id      text,
  actual_passwort_enc text,
  actual_e2e_enc      text,
  erstellt_am         timestamptz not null default now()
);
insert into haushalte (id, name) values (1, 'Mein Haushalt');
select setval('haushalte_id_seq', 1);

create table benutzer (
  id                 serial primary key,
  email              text not null,
  name               text not null,
  passwort_hash      text,
  ist_admin          boolean not null default false,
  aktiv              boolean not null default true,
  passwort_aendern   boolean not null default false,
  totp_geheimnis_enc text,
  totp_aktiv         boolean not null default false,
  totp_zuletzt       bigint not null default 0,      -- zuletzt genutztes Zeitfenster (gegen Wiederverwendung)
  fehlversuche       integer not null default 0,
  gesperrt_bis       timestamptz,
  erstellt_am        timestamptz not null default now(),
  letzte_anmeldung   timestamptz
);
create unique index benutzer_email_idx on benutzer (lower(email));

-- Rechte je Haushalt; Bons hochladen darf jedes Mitglied
create table mitglieder (
  haushalt_id     integer not null references haushalte(id) on delete cascade,
  benutzer_id     integer not null references benutzer(id) on delete cascade,
  bons_sehen      boolean not null default true,   -- alle Bons und Einkaufs-Auswertung
  bons_bearbeiten boolean not null default true,   -- prüfen, ändern, löschen, buchen
  finanzen_sehen  boolean not null default false,  -- Actual-Finanzen
  verwalten       boolean not null default false,  -- Haushalts-Einstellungen
  primary key (haushalt_id, benutzer_id)
);

create table sitzungen (
  token_hash     text primary key,               -- SHA-256 des Cookie-Werts
  benutzer_id    integer not null references benutzer(id) on delete cascade,
  haushalt_id    integer references haushalte(id) on delete set null,
  zweiter_faktor boolean not null default false, -- false = Passwort ok, zweiter Faktor fehlt noch
  challenge      text,                           -- laufende Passkey-Anfrage
  erstellt_am    timestamptz not null default now(),
  zuletzt_am     timestamptz not null default now(),
  laeuft_ab      timestamptz not null,
  ip             text,
  geraet         text
);
create index sitzungen_benutzer_idx on sitzungen (benutzer_id);

-- Anfragen für die Anmeldung per Passkey (noch ohne Sitzung)
create table passkey_anfragen (
  id         text primary key,
  challenge  text not null,
  laeuft_ab  timestamptz not null
);

create table passkeys (
  id          text primary key,                  -- Credential-ID (base64url)
  benutzer_id integer not null references benutzer(id) on delete cascade,
  public_key  bytea not null,
  zaehler     bigint not null default 0,
  transports  text[],
  name        text not null default 'Passkey',
  erstellt_am timestamptz not null default now(),
  zuletzt_am  timestamptz
);

create table wiederherstellungscodes (
  id          serial primary key,
  benutzer_id integer not null references benutzer(id) on delete cascade,
  code_hash   text not null,
  benutzt_am  timestamptz
);

create table protokoll (
  id          bigserial primary key,
  am          timestamptz not null default now(),
  benutzer_id integer references benutzer(id) on delete set null,
  haushalt_id integer references haushalte(id) on delete set null,
  aktion      text not null,
  details     jsonb,
  ip          text
);
create index protokoll_am_idx on protokoll (am desc);

-- --- Daten den Haushalten zuordnen ---
alter table bons add column haushalt_id integer not null default 1 references haushalte(id) on delete cascade;
alter table bons alter column haushalt_id drop default;
alter table bons add column hochgeladen_von integer references benutzer(id) on delete set null;
alter table bons drop constraint bons_datei_sha256_key;
create unique index bons_datei_idx on bons (haushalt_id, datei_sha256);
drop index bons_actual_tx_idx;
create unique index bons_actual_tx_idx on bons (haushalt_id, actual_tx_id) where actual_tx_id is not null;
create index bons_haushalt_idx on bons (haushalt_id, datum);

alter table gruppen add column haushalt_id integer not null default 1 references haushalte(id) on delete cascade;
alter table gruppen alter column haushalt_id drop default;

alter table regeln add column haushalt_id integer not null default 1 references haushalte(id) on delete cascade;
alter table regeln alter column haushalt_id drop default;
drop index regeln_muster_idx;
create unique index regeln_muster_idx on regeln (haushalt_id, muster, coalesce(haendler_id, 0));

alter table kartenzuordnung add column haushalt_id integer not null default 1 references haushalte(id) on delete cascade;
alter table kartenzuordnung alter column haushalt_id drop default;
alter table kartenzuordnung drop constraint kartenzuordnung_pkey;
alter table kartenzuordnung add primary key (haushalt_id, endziffern);

-- Einstellungen: haushalt_id null = systemweit (z. B. KI), sonst je Haushalt (Actual, Finanzen)
alter table einstellungen add column haushalt_id integer references haushalte(id) on delete cascade;
update einstellungen set haushalt_id = 1 where schluessel in ('actual', 'finanzen');
alter table einstellungen drop constraint einstellungen_pkey;
create unique index einstellungen_idx on einstellungen (coalesce(haushalt_id, 0), schluessel);

alter table fin_konten add column haushalt_id integer not null default 1 references haushalte(id) on delete cascade;
alter table fin_konten alter column haushalt_id drop default;
alter table fin_konten drop constraint fin_konten_pkey;
alter table fin_konten add primary key (haushalt_id, budget, id);

alter table fin_buchungen add column haushalt_id integer not null default 1 references haushalte(id) on delete cascade;
alter table fin_buchungen alter column haushalt_id drop default;
alter table fin_buchungen drop constraint fin_buchungen_pkey;
alter table fin_buchungen add primary key (haushalt_id, budget, id);
drop index fin_buchungen_konto_idx;
create index fin_buchungen_konto_idx on fin_buchungen (haushalt_id, budget, konto_id, datum);

alter table fin_budgets add column haushalt_id integer not null default 1 references haushalte(id) on delete cascade;
alter table fin_budgets alter column haushalt_id drop default;
alter table fin_budgets drop constraint fin_budgets_pkey;
alter table fin_budgets add primary key (haushalt_id, sync_id);

drop view v_positionen;
create view v_positionen as
select p.id              as position_id,
       b.id              as bon_id,
       b.haushalt_id,
       b.hochgeladen_von,
       b.datum,
       date_trunc('month', b.datum)::date as monat,
       h.name            as haendler,
       coalesce(hg.name, ug.name, 'Ohne Gruppe') as hauptgruppe,
       coalesce(ug.name, 'Ohne Gruppe')          as untergruppe,
       coalesce(nullif(p.sorte, ''), p.name)     as sorte,
       coalesce(hg.farbe, ug.farbe, '#94a3b8')   as hauptgruppe_farbe,
       coalesce(ug.farbe, '#94a3b8')             as untergruppe_farbe,
       p.name            as artikel,
       p.text_roh,
       p.menge,
       p.einheit,
       p.einzelpreis_cent,
       p.betrag_cent,
       p.betrag_cent / 100.0 as betrag_eur
  from positionen p
  join bons b on b.id = p.bon_id
  left join haendler h on h.id = b.haendler_id
  left join gruppen ug on ug.id = p.gruppe_id
  left join gruppen hg on hg.id = ug.eltern_id
 where b.status in ('geprueft','wartet','gebucht');
