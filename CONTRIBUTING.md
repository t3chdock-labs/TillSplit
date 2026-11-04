# Contributing · Mitmachen

**English** · [Deutsch](#deutsch)

Thanks for helping with TillSplit!

## Before you start

- **Bugs and ideas:** open an issue using one of the templates. Security problems: see [SECURITY.md](SECURITY.md).
- **Larger changes:** please open an issue first so we can agree on the approach.

## Development

```bash
cd server && npm install && npm run dev   # API on :8080 (needs Postgres, DATABASE_URL)
cd web && npm install && npm run dev      # UI on :5173, proxies to :8080
```

Before opening a pull request:

```bash
cd server && npm run check
cd web && npm run check
node werkzeuge/texte-pruefen.mjs          # all UI texts translated?
```

## Code conventions

- Code, identifiers and comments are **German** (e.g. `bons.ts`, `haendler`, `pruefen`). Please keep it that way.
- Every visible text goes through `t("…")`; the German text is the key. Add the English translation to
  `web/src/sprachen/en.json` or `server/sprachen/en.json`.
- New database changes go into a new numbered file in `server/migrations/`.
- Never commit `.env` files, API keys, real receipts or backups.

## License of contributions

TillSplit is licensed under **AGPL-3.0-or-later**. The maintainer also offers a commercial license.
By submitting a pull request you agree that your contribution is licensed under AGPL-3.0-or-later **and**
that the maintainer may additionally distribute it under other license terms (including the commercial license).
Please confirm this by adding a sign-off line to your commits (`git commit -s`):

```
Signed-off-by: Your Name <you@example.com>
```

---

## Deutsch

Danke, dass du bei TillSplit mithilfst!

- **Fehler und Ideen:** Issue mit einer der Vorlagen anlegen. Sicherheitsprobleme: siehe [SECURITY.md](SECURITY.md).
- **Größere Änderungen:** bitte zuerst ein Issue öffnen, damit wir den Weg absprechen.
- **Vor dem Pull Request:** `npm run check` in `server` und `web`, dazu `node werkzeuge/texte-pruefen.mjs`.
- **Code und Kommentare sind deutsch.** Sichtbare Texte laufen über `t("…")`, der deutsche Text ist der Schlüssel;
  die englische Übersetzung kommt nach `web/src/sprachen/en.json` bzw. `server/sprachen/en.json`.
- Datenbankänderungen als neue nummerierte Datei in `server/migrations/`.
- Niemals `.env`, API-Schlüssel, echte Bons oder Backups einchecken.

**Lizenz der Beiträge:** TillSplit steht unter AGPL-3.0-or-later, zusätzlich gibt es eine kommerzielle Lizenz.
Mit einem Pull Request erklärst du dich einverstanden, dass dein Beitrag unter AGPL-3.0-or-later steht **und**
der Betreuer ihn zusätzlich unter anderen Bedingungen (auch der kommerziellen Lizenz) weitergeben darf.
Bestätige das mit `git commit -s` (Zeile `Signed-off-by:`).
