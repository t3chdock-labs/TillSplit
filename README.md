# TillSplit 0.1.00

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/tamperold)

[Deutsch](README.de.md) · **English**

Capture receipts (photo, screenshot, PDF), read them item by item, analyse spending by product group and split the matching debit in **Actual Budget** by category. Actual stays in charge of the bookkeeping, TillSplit adds the details.

The interface is available in **English** and **German** (see [Languages](#languages)).

## How it works

1. **Upload:** on the phone via the camera button or “Share” from another app (Android), on the PC via drag & drop, file picker or Ctrl+V.
2. **Read:** Claude (or Ollama locally) reads store, date, total and every line item and assigns each item to a subgroup (vegetables, drinks, sweets …).
3. **Review:** image and line items side by side. The total is cross-checked. Every correction is remembered as a rule and applied automatically in future.
4. **Book:** TillSplit looks for the matching debit in Actual (same amount, −4 to +10 days) and splits it by **main group** (groceries, drugstore, DIY …). For cash payments a new transaction can be created. Changed transactions get the tag `#tillsplit`.
5. **Three levels:** main group (groceries) → group (drinks, vegetables, sweets …) → **type** (cola, mineral water, juice · tomato, cucumber · chocolate, gummies). The AI derives the type from the receipt text without brand and size; if a line is too cryptic it stays empty and reports use the item name. Corrected types are learned just like groups.
6. **Finances:** a separate page with transactions from Actual – income, expenses, savings rate, pie chart groups → categories → payees, history with an income line, top payees and expenses, net worth of investment accounts. Under *Settings → Finances* you choose the budgets (several possible), net worth accounts and categories to exclude (e.g. transfers between budgets). Data is re-imported every `FINANZEN_STUNDEN` hours (default 3) and on demand.
7. **Long receipts:** every photo can be cropped (with a magnifier at the corners), rotated and filtered when uploading. Several photos of one long receipt are joined into one image with “Parts of one long receipt”.
8. **Reports:** overview by group, history, top items, stores and weekdays; click bars and pie segments to see the individual items with links to their receipts. “Items” shows the price history per product.

### Cash, cards and accounts

- **When uploading** TillSplit asks how you paid: “From receipt” (detect automatically), “Card / account” or “Cash”. Optionally choose the Actual account.
- **Card on the receipt:** for card payments TillSplit reads the last 4 digits of the card (never more). Under *Settings → Actual → Cards → accounts* each card is assigned to an account. When you pick an account by hand once, TillSplit remembers the card.
- **Cash** (Settings → Actual → Cash payments):
  - **Move from category** (default, no separate cash account): ATM withdrawals get a category such as “Cash” in Actual. For each cash receipt TillSplit creates a **zero-amount** transaction in the chosen account: +total on “Cash”, −parts on groceries, drugstore etc. The balance and bank reconciliation are untouched, but expenses end up in the right categories.
  - **Separate cash account:** cash receipts are booked there as expenses.
  - **Only in TillSplit:** Actual stays unchanged.
- **Card payments:** since bank data is often imported only once a month, the receipt gets the status **“Waiting for bank”**. A background job (every `ABGLEICH_STUNDEN`, default 6) looks for exactly one matching debit and splits it automatically. After an import you can also trigger it via **Receipts → Match with Actual**. If several debits have the same amount, you choose the right one.

Original files are stored as `<BON_DIR>/<year>/<month>/<date>_<store>_<total>.jpg|pdf` by default. HEIC photos (iPhone) are stored as JPEG.

## Deployment with Docker Swarm

### 1. Build the image

```bash
docker build -t tillsplit:0.1.0 .
```

With several nodes, push the image to a registry and set `TILLSPLIT_IMAGE`.

### 2. Create secrets

```bash
openssl rand -base64 24 | docker secret create tillsplit_db_passwort -
openssl rand -base64 32 | docker secret create tillsplit_schluessel -
printf '%s' 'LONG-BACKUP-PASSWORD' | docker secret create tillsplit_backup_passwort -
printf '%s' 'sk-ant-…'            | docker secret create tillsplit_anthropic_key -
printf '%s' 'ACTUAL-SERVER-PASSWORD' | docker secret create tillsplit_actual_passwort -
```

`tillsplit_schluessel` encrypts stored credentials (Actual passwords of the households, TOTP secrets). **Back it up** – without it these data are unusable after a restore.

### 3. Adjust `docker-stack.yml`

| Placeholder | Meaning |
|---|---|
| `PUBLIC_URL` | public address, e.g. `https://receipts.example.com` (passkeys, HSTS) |
| `ACTUAL_SERVER_URL` | Actual server for the first household (more households in the admin area) |
| `ACTUAL_SYNC_ID` | Actual → Settings → Advanced settings → “Sync ID” |
| `OLLAMA_URL` | machine running Ollama, e.g. `http://192.168.1.50:11434` |
| `TILLSPLIT_SPRACHE` | default language of the installation, `en` or `de` (optional) |
| NFS `addr` / `device` | share for receipt storage |
| Traefik labels / domain | adapt to your reverse proxy |
| `node.hostname` | node where Postgres keeps its data |

```bash
docker stack deploy -c docker-stack.yml tillsplit
```

### 4. First start

On the very first start the log shows a **setup code** (`docker service logs tillsplit_app`). Use it in the browser to create the first administrator – the language chosen there becomes the language of the installation. Alternatively set `ADMIN_EMAIL` and `ADMIN_PASSWORD_FILE`.

A setup tour then guides you through the remaining steps: two-factor sign-in, text recognition, Actual, product groups, storage, finances, members and backups.

## Languages

The interface and messages are available in **English** and **German**. On the first visit the browser language is used; it can be changed on the sign-in page and under *My account* (then it applies to the account on all devices). Numbers, dates and month names follow the chosen language.

The **language of the installation** is chosen by the first administrator during setup (changeable under *Settings → Actual → Text recognition*, default via `TILLSPLIT_SPRACHE=en|de`). The AI names items and types in this language, the default product groups are created in it, and notices created in the background use it. The text printed on the receipt is always kept as is. Tesseract reads German and English by default (`TESSERACT_LANG=deu+eng`).

**Contributing a language** needs no code changes:

1. Copy `web/src/sprachen/en.json` and `server/sprachen/en.json` to `<code>.json` (e.g. `fr.json`, ISO 639-1 code).
2. Set `"@sprache"` to the display name (e.g. `"Français"`) and translate the values. The key is the German source text; keep placeholders like `{n}`.
3. Plural forms are separated by `|` in the order of the language's plural categories (`zero|one|two|few|many|other`, only those the language has – English `one|other`, Polish `one|few|many|other`).
4. Run `node werkzeuge/texte-pruefen.mjs` – it lists missing and obsolete entries and broken placeholders.

The language then appears automatically in the language selection; number and date formats come from the browser (`Intl`). For Tesseract, build the image with the matching language pack: `docker build --build-arg TESSERACT_SPRACHEN="deu eng fra" …` and set `TESSERACT_LANG=deu+eng+fra`.

The source code itself (identifiers and comments) is written in German.

## Notifications

A **bell** at the top of the sidebar (top right on the phone) shows new events. Under *My account → Notifications* everyone chooses per event which channels to use:

| Event | Who | Bundling |
|---|---|---|
| New receipts uploaded | the other household members | one message per upload, however many files |
| Receipts read | uploaders and everyone who may review | one message per recognition run (when the queue is empty) |
| Review pending | everyone who may review | daily, every 2 days or weekly at a chosen hour – only if something is open |

Email and Telegram are additionally collected per user: immediately (per minute), every 15 minutes, hourly, every 4 hours or once a day. A test message checks all channels.

| Variable | Meaning |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SICHER` (`true` for port 465) | mail server |
| `SMTP_USER`, `SMTP_PASSWORD` (`_FILE`) | login, if required |
| `SMTP_FROM` | sender, e.g. `TillSplit <tillsplit@example.com>` |
| `TELEGRAM_BOT_TOKEN` (`_FILE`) | bot token from @BotFather; under *My account* each user connects one or more own chats and groups (e.g. “Family”) via one-time link; `/stop` disconnects. Groups get no re-read buttons, and a group can be connected only once |
| `TZ` | time zone for reminders (default `Europe/Berlin`) |
| `PUBLIC_URL` | needed for links in emails and Telegram messages |

**Re-read from Telegram:** if a receipt could not be read or its line items do not match the total, the Telegram message carries buttons such as “REWE: Sonnet 5.5 ≈ 5 cents” for everyone who may review. A tap queues the receipt with the larger model (cost limits apply); you get a new message when it is done. Security: the bot never acts on typed text – only `/start <one-time code>` and `/stop`. Each button carries a random token created by TillSplit that is valid once, for 48 hours, only for that user, receipt and model, and only from the linked chat; permissions are checked again on every tap, booked receipts are never re-read.

The bot uses long polling (no incoming port needed). Use a **dedicated bot** for TillSplit: a bot that another program already polls (e.g. Home Assistant) cannot be shared – both would steal each other's messages. TillSplit detects this and turns Telegram off with a hint in the log.

## Users, households and permissions

- **Household:** its own receipts, product groups, learned assignments, cards, Actual access and receipt storage. A user can belong to several households and switches at the top of the sidebar.
- **Permissions per member:** every member may upload receipts. In addition: *All receipts & reports*, *Review & book receipts*, *Finances* (Actual dashboard) and *Manage household*. Templates: “Upload only” (e.g. children – they only see their own receipts), “Reader”, “Member”, “Member with finances”, “Manager”.
- **Admin area** (administrators only): create users (with an initial password that must be changed at the first sign-in), lock them, reset password or two-factor; households with storage folder and Actual access; members and permissions; audit log of all sign-ins and changes.
- **Receipt storage per household:** a subfolder of `BON_DIR` or an absolute path within `ABLAGE_WURZELN`. Other paths are rejected.

## Sign-in and security

- **Passwords** with Argon2id; at least 10 characters. “Stay signed in” keeps a session for 30 days.
- **Two-factor:** authenticator app (TOTP, with 10 recovery codes) and/or **passkeys** (fingerprint, Face ID, device PIN – even without a password). Passkeys need HTTPS and `PUBLIC_URL`. With `ZWEI_FAKTOR_PFLICHT=true` everyone has to set up a second factor.
- **Sessions** are stored in the database (cookie `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS); *My account* lists all signed-in devices, each can be signed out. Changing the password signs out all other devices.
- **Brute-force protection:** at most 10 sign-in attempts per minute per IP; after 8 failures the account is locked for 15 minutes.
- **Fail2Ban:** failed attempts are logged as `TILLSPLIT_ANMELDUNG_FEHLGESCHLAGEN ip=…`. Filter and jail are in `docs/fail2ban/`. `TRUST_PROXY` must contain the reverse proxy's network so the real client IP arrives (default: private networks).
- **Further hardening:** content security policy and other security headers, origin check against cross-site requests, every query limited to the user's household and permissions, uploads checked by content and re-encoded, credentials stored encrypted, AI cost limits per month and per receipt.

## Receipt storage: template and encryption

Under *Settings → Storage* each household builds folder and file names from building blocks (drag & drop or tap): `{Jahr}` (year), `{Monat}` (month), `{Monatsname}` (month name), `{Tag}` (day), `{Datum}` (date), `{Händler}` (store), `{Summe}` (total), `{Zahlung}` (payment), `{Hochgeladen}` (uploaded by), `{Haushalt}` (household), `{Bon}` (receipt number), plus “Folder” as a new level and custom text. The interface shows the blocks in your language; in the stored template they keep their German names.

**Encryption** (per household): receipt files are stored encrypted with AES-256-GCM (`….jpg.enc`) right at upload. The folder structure stays, but files can only be opened through TillSplit. The key is derived from `TILLSPLIT_SCHLUESSEL` – without it the receipts are lost. Turning encryption on or off converts all existing receipts.

## Deleting a receipt

If a receipt is already booked in Actual, TillSplit asks:
- **Cash receipt** (transaction created by TillSplit): the transaction is deleted in Actual.
- **Card payment** (existing debit was split): the split is undone, the debit stays uncategorized.
- Or Actual stays unchanged.

## Backup and restore

A backup contains the database (`pg_dump`), all receipt storage folders and the key for stored credentials – as `tar.gz`, encrypted with `BACKUP_PASSWORD` (scrypt + AES-256-GCM). Without a password no backups are created.

| Variable | Meaning |
|---|---|
| `BACKUP_PASSWORD` (`_FILE`) | backup password – keep it safe, no backup is readable without it |
| `BACKUP_DIR` | location, ideally another NAS/share than the receipts (default `/data/backups`) |
| `BACKUP_STUNDEN` | interval of automatic backups in hours (default 24, `0` = manual only) |
| `BACKUP_BEHALTEN` | number of backups kept (default 14) |
| `BACKUP_MIT_BONS` | include receipt files (default `true`) |

In the *Admin area → Backups*: back up now, download, delete.

**Restore** (stop TillSplit first):

```bash
# 1. decrypt (in the TillSplit container or with Node on the host)
docker run --rm -i -e BACKUP_PASSWORD='…' -v "$PWD:/b" tillsplit:0.1.0 \
  node dist/werkzeuge/backup-entschluesseln.js /b/tillsplit-….tar.gz.enc > backup.tar.gz
# 2. unpack: datenbank.dump, schluessel.txt, info.json and the receipt folders (data/bons/…)
tar -xzf backup.tar.gz
# 3. restore the database
pg_restore --clean --if-exists --no-owner -d tillsplit datenbank.dump
# 4. copy the receipt folders back, create the content of schluessel.txt as secret tillsplit_schluessel
```

## Text recognition

- **Claude** (cloud, most accurate). The model is chosen under *Settings → Actual → Text recognition*, with an estimated cost per receipt. If the line items do not add up to the total, TillSplit by default asks before a larger model (Sonnet or Opus) re-reads the receipt, showing the expected cost. Monthly and per-receipt limits protect against surprises; costs can be shown in euros or other currencies (ECB reference rates, past costs keep the rate of their day).
- **Ollama** (local vision model, e.g. `qwen2.5vl:7b`).
- **Tesseract** reads the text (PDFs with a text layer directly) and a language model splits it into line items – locally with Ollama (`TEXTMODELL_ANBIETER=ollama`, `OLLAMA_TEXT_MODEL=qwen2.5:7b`) or very cheaply with Claude as a pure text model (`TEXTMODELL_ANBIETER=claude`). Less accurate on crumpled or faded receipts.

Individual receipts can be compared via “Read again”.

**Running on the internet:** only behind a reverse proxy with HTTPS (Traefik, Nginx Proxy Manager, Caddy …), set `PUBLIC_URL`, `ZWEI_FAKTOR_PFLICHT=true`, Fail2Ban or CrowdSec in front. Do not expose Postgres and Actual to the internet.

## Ollama

```bash
ollama pull qwen2.5vl:7b
```

Start Ollama with `OLLAMA_HOST=0.0.0.0` so the server can reach it. Small models tend to mix up lines on long receipts – test before relying on them.

## As an app on the phone

Open the page in the browser and choose “Add to home screen” or “Install app”.

- **Android:** TillSplit then appears in the share menu; screenshots and PDFs can be sent to it directly.
- **iOS:** does not support share targets for web apps. Use the camera button or the file picker.

## Grafana (optional)

The view `v_positionen` contains every reviewed line item with date, month, store, main group, subgroup, item and amount. Create a read-only user for Grafana:

```sql
create role grafana login password '…';
grant connect on database tillsplit to grafana;
grant usage on schema public to grafana;
grant select on v_positionen, bons, positionen, gruppen, haendler to grafana;
```

## Claude costs

Approximate cost per receipt:

| Model | Cost per receipt |
|---|---|
| `claude-haiku-5-5` | about 0.3–0.6 US cents (recommended) |
| `claude-sonnet-5-5` | about 5–8 US cents |
| `claude-opus-5-5` | about 10–16 US cents |

When several receipts are uploaded at once, the instructions are cached (prompt caching): from the second receipt on they cost only 5 %. Usage and cost are shown on every receipt page and under *Statistics*.

## Development

```bash
cd server && npm install && npm run dev   # API on :8080 (needs Postgres, DATABASE_URL)
cd web && npm install && npm run dev      # interface on :5173 with proxy to :8080
node werkzeuge/texte-pruefen.mjs          # check translations
```

Configuration via environment variables, see `server/src/config.ts`. Every variable can also be set as `NAME_FILE`.

## License

TillSplit is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-or-later), see [`LICENSE`](LICENSE).

- Private use and use in clubs, companies or as a service is allowed.
- If you **modify** TillSplit and make it available to others – even only over a network – you must offer those users the modified source code under the same license. The setting `QUELLCODE_URL` adds a “Source code” link to the footer for this.
- **Commercial license:** if you want to use TillSplit in your own product without disclosing the source code, you can ask for a commercial license.

Licenses of the libraries and programs used are listed in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) (regenerate with `node werkzeuge/lizenzen.mjs`).

## Support

TillSplit is free. If it helps you, I'm happy about a coffee: [ko-fi.com/tamperold](https://ko-fi.com/tamperold)

Your own installation shows a “☕ Support TillSplit” button when `SPENDEN_URL` is set (forks put their own link there or leave it out).
