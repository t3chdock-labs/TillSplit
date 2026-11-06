# TillSplit veröffentlichen – GitHub und Docker Hub

Schritt-für-Schritt-Anleitung für den ersten öffentlichen Start von TillSplit als Open-Source-Projekt:
Quellcode auf **GitHub** (`github.com/t3chdock-labs/TillSplit`), Image auf **Docker Hub** (`t3chdocklabs/tillsplit`)
und optional zusätzlich auf **GHCR** (`ghcr.io/t3chdock-labs/tillsplit`).

Alle Befehle sind für **PowerShell unter Windows** im Projektordner `C:\Temp\TillSplit` geschrieben.
Wo ein Befehl auf Linux/macOS anders lautet, steht es dabei.

> **Grundregel:** Passwörter, API-Schlüssel und Tokens tippst du nur dort ein, wo danach gefragt wird
> (Anmeldedialog, GitHub-Secret-Feld). Nie in Dateien, nie in Befehlszeilen, nie in Issues oder Chats.
> Der Ordner `C:\Temp\BonBuch-Test` ist eine Altkopie mit Secrets – **nie** dorthin wechseln, nichts daraus kopieren.

## Überblick – die Reihenfolge

| # | Schritt | Wo | Dauer |
|---|---|---|---|
| 0 | Werkzeuge installieren (git, optional gh) | PC | 5 min |
| 1 | Projekt aufräumen und auf Secrets prüfen | PC | 20 min |
| 2 | Platzhalter auf echte Werte setzen | PC | 10 min |
| 3 | Lizenz bestätigen | – | 2 min |
| 4 | GitHub-Organisation und Repository anlegen | github.com | 10 min |
| 5 | Lokales git-Repository, erster Commit, erster Push | PC | 10 min |
| 6 | Repository-Einstellungen (Sicherheit, Beschreibung) | github.com | 10 min |
| 7 | Docker-Hub-Konto, Repository, Access Token | hub.docker.com | 10 min |
| 8 | Secrets für GitHub Actions hinterlegen | github.com | 5 min |
| 9 | Erste Version taggen → Image wird automatisch gebaut | PC + github.com | 30–90 min (Build) |
| 10 | GitHub-Release schreiben, GHCR-Paket öffentlich machen | github.com | 10 min |
| 11 | Nacharbeiten (Docker-Hub-Beschreibung, eigene Installation umstellen) | – | 10 min |
| – | Anhang A: Image von Hand bauen und pushen (ohne Actions) | PC | – |
| – | Anhang B: Checkliste für jede weitere Version | – | – |

Bereits im Projekt vorbereitet (von dieser Anleitung angelegt, bitte kurz durchsehen):

| Datei | Zweck |
|---|---|
| `.gitignore` | hält `node_modules`, `dist`, `.env`, Backups, Dumps, Testbons aus dem Repository |
| `.dockerignore` | hält dasselbe plus `.git`, `.github`, `docs` aus dem Image |
| `.github/workflows/docker.yml` | baut bei Tag `v*.*.*` das Image für amd64 + arm64 und pusht es nach Docker Hub und GHCR |
| `.github/workflows/pruefen.yml` | Typprüfung von Server und Oberfläche bei jedem Push/PR |
| `.github/dependabot.yml` | wöchentliche Update-Hinweise für npm, Docker und Actions |
| `.github/ISSUE_TEMPLATE/*` | Vorlagen „Fehler melden“ und „Idee“ (zweisprachig) |
| `.github/pull_request_template.md` | Prüfliste für Pull Requests |
| `SECURITY.md` | wie Sicherheitslücken vertraulich gemeldet werden |
| `CONTRIBUTING.md` | wie man mitmacht, inkl. Lizenz der Beiträge |

Schon vorher vorhanden: `LICENSE` (AGPL-3.0), `README.md` (englisch), `README.de.md` (deutsch),
`THIRD_PARTY_LICENSES.md`, `.github/FUNDING.yml`.

---

## 0. Werkzeuge installieren

Auf diesem PC fehlt **git**. Installieren (PowerShell, danach PowerShell neu öffnen):

```powershell
winget install --id Git.Git -e
```

Optional die GitHub-Kommandozeile (erleichtert Anmeldung, Repo anlegen, Releases):

```powershell
winget install --id GitHub.cli -e
```

Docker Desktop mit `buildx` ist bereits installiert (Docker 29.9, buildx 0.38).

Einmalig deinen Namen und eine E-Mail für Commits setzen. **Tipp:** Nimm die anonyme GitHub-Adresse
(`<ID>+<name>@users.noreply.github.com`, zu finden unter GitHub → Settings → Emails, Haken
„Keep my email addresses private“), sonst steht deine private Adresse dauerhaft öffentlich in jedem Commit.

```powershell
git config --global user.name "Dein Name"
git config --global user.email "12345678+deinname@users.noreply.github.com"
git config --global init.defaultBranch main
git config --global core.autocrlf input
```

`core.autocrlf input` sorgt dafür, dass Shell-Skripte und YAML mit Linux-Zeilenenden im Repository landen.

---

## 1. Projekt aufräumen und auf Secrets prüfen

Ziel: Im ersten Commit darf **nichts** landen, was nicht öffentlich sein soll. Weil im Projekt noch kein
`.git` existiert, gibt es auch keine alte Historie, die bereinigt werden müsste – du startest sauber.

### 1.1 Was ignoriert wird

Die neue `.gitignore` schließt u. a. aus: `node_modules/`, `dist/`, `*.tsbuildinfo`, `.env*`, `*.key`,
`*.pem`, `data/`, `backup*/`, `bons/`, `*.dump`, `*.enc`, `*.zip`, `*.db`, Protokolle.

### 1.2 Bekannte Stellen mit privaten Angaben

Ich habe das Projekt durchsucht: **keine** API-Schlüssel, Tokens oder privaten Schlüssel gefunden, keine
`.env`, keine Backups, keine Bon-Bilder. Es gibt aber **private Infrastruktur-Angaben** in
`docker-stack.yml` (eigene Domain, Knotenname). **Erledigt:**

| Zeile | Platzhalter jetzt |
|---|---|
| `PUBLIC_URL` | `https://bon.example.com` |
| Traefik-Label `Host(...)` | `bon.example.com` |
| `node.hostname` | `DEIN-DB-KNOTEN` |

Deine echte Stack-Datei liegt als `docker-stack.local.yml` daneben und steht in `.gitignore`.
Für den eigenen Server ab jetzt immer diese Datei verwenden:

```powershell
docker stack deploy -c docker-stack.local.yml tillsplit
```

Weitere private Angaben (eigene Domain, Knotennamen, NAS-Adressen) dürfen auch in anderen Dateien nicht
stehen – die Suche in 1.3 a und 2.4 findet sie, wenn du deine Domain dort als Muster ergänzt.

### 1.3 Automatisch prüfen

**a) Schnelle Suche nach typischen Schlüssel-Mustern** (gibt nur Dateinamen und Zeilennummern aus, nicht
den Inhalt – so landet nichts auf dem Bildschirm):

```powershell
$muster = 'sk-ant-[A-Za-z0-9_-]{10,}','ghp_[A-Za-z0-9]{20,}','github_pat_','dckr_pat_','-----BEGIN [A-Z ]*PRIVATE KEY','AKIA[0-9A-Z]{16}','[0-9]{8,10}:[A-Za-z0-9_-]{35}','xox[baprs]-'
Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '\\(node_modules|dist|\.git)\\' } |
  Select-String -Pattern $muster | ForEach-Object { "$($_.Path):$($_.LineNumber)" }
```

Keine Ausgabe = gut.

**b) Gründliche Prüfung mit gitleaks** (empfohlen, läuft als Docker-Container, liest nur):

```powershell
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest dir /repo --redact
```

`--redact` blendet gefundene Werte aus. Ergebnis `no leaks found` = gut. Nach dem ersten Commit
(Schritt 5) zusätzlich die Historie prüfen:

```powershell
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest git /repo --redact
```

**c) Nach dem `git add` in Schritt 5** noch einmal ansehen, was wirklich hineinkommt (siehe dort).

### 1.4 Falls doch einmal etwas Geheimes committet wurde

- **Noch nicht gepusht:** `git reset --soft HEAD~1`, Datei entfernen/in `.gitignore`, neu committen.
- **Schon gepusht:** Den Schlüssel **sofort beim Anbieter widerrufen und neu erzeugen** (Anthropic-Konsole,
  Docker Hub, Telegram …) – das ist der wichtigste Schritt, denn öffentliche Repos werden binnen Minuten
  automatisch durchsucht. Danach die Historie bereinigen:

  ```powershell
  pip install git-filter-repo
  git filter-repo --invert-paths --path pfad/zur/datei
  git push --force --all
  ```

  Bei einem ganz frischen Repo ist es oft einfacher: Repo auf GitHub löschen, lokal `.git` löschen, sauber neu beginnen.

---

## 2. Platzhalter auf echte Werte setzen

Sobald feststeht, dass das Repository `github.com/t3chdock-labs/TillSplit` heißt (Schritt 4), diese Stellen ändern.
Du kannst sie schon jetzt ändern – sie werden ja erst mit dem Push sichtbar.

### 2.1 Quellcode-Link (`SOURCE_URL`, erledigt)

Pflicht wegen AGPL: Die Fußzeile verlinkt auf den Quellcode. Der Standard steht fest im Code
(`server/src/config.ts`: `https://github.com/t3chdock-labs/TillSplit`), in der Vorlage ist nichts zu setzen.
Wer TillSplit verändert betreibt, setzt `SOURCE_URL` auf sein eigenes Repository.

### 2.2 Ko-fi (erledigt)

Der Spenden-Link `https://ko-fi.com/tamperold` ist bereits eingetragen:

| Datei | Stelle |
|---|---|
| `.github/FUNDING.yml` | `ko_fi: tamperold` (GitHub zeigt damit den Knopf „Sponsor“) |
| `README.md` / `README.de.md` | Badge oben und Abschnitt „Support/Unterstützen“ |
| `server/src/config.ts` | Standard für `DONATE_URL` (Knopf „☕ TillSplit unterstützen“ in jeder Installation) |

Betreiber können den Knopf mit `DONATE_URL=off` ausblenden oder mit einem eigenen Link ersetzen.

### 2.3 Image-Name in Doku und Stack (erledigt)

- `docker-stack.yml`: `image: t3chdocklabs/tillsplit:0.1.0`
- `README.md` / `README.de.md`, Abschnitt „1. Image“: `docker pull` für Docker Hub und GHCR.

### 2.4 Sonstiges prüfen

```powershell
Get-ChildItem -Recurse -File -Include *.md,*.ts,*.tsx,*.yml,*.json |
  Where-Object { $_.FullName -notmatch '\\(node_modules|dist)\\' } |
  Select-String -Pattern 'TILLSPLIT-REPOSITORY','BonBuch','DEINE-DOMAIN' |
  ForEach-Object { "$($_.Path):$($_.LineNumber)" }
```

Keine Ausgabe = alle Platzhalter und alten Namen erledigt.

---

## 3. Lizenz – Empfehlung: AGPL-3.0 beibehalten

Das Projekt steht bereits unter **AGPL-3.0-or-later** (`LICENSE`, beide `package.json`, READMEs, Fußzeile).

| | AGPL-3.0 | MIT |
|---|---|---|
| Nutzung, auch kommerziell | erlaubt | erlaubt |
| Wer es verändert **und als Web-Dienst anbietet** | muss den geänderten Code offenlegen | muss nichts offenlegen |
| Schutz vor „Fremd-SaaS ohne Gegenleistung“ | ja | nein |
| Duale/kommerzielle Lizenz möglich | ja (README bietet sie schon an) | sinnlos |
| Hürde für Firmen-Beiträge | etwas höher | sehr niedrig |

**Empfehlung: AGPL-3.0 behalten.** Für eine selbst gehostete Web-App ist sie die übliche Wahl (Nextcloud,
Mastodon, Immich, Plausible …): Die normale GPL greift bei reinen Web-Diensten nicht, weil die Software nicht
„weitergegeben“ wird – erst die AGPL verpflichtet Anbieter eines Dienstes zur Offenlegung. MIT wäre nur
sinnvoll, wenn maximale Verbreitung wichtiger ist als Rückfluss von Änderungen.

**Wichtig wegen der angebotenen kommerziellen Lizenz:** Du kannst fremde Beiträge nur dann kommerziell
weiterlizenzieren, wenn die Beitragenden dir das erlauben. Dafür steht in `CONTRIBUTING.md` eine Klausel,
die per `git commit -s` bestätigt wird. Rechtlich belastbarer ist eine echte CLA (z. B. über
„CLA Assistant“ als GitHub-App). Das ist keine Rechtsberatung – bei ernsthaften kommerziellen Plänen lohnt
ein kurzer Blick eines Anwalts.

Nichts weiter zu tun, außer: im Kopf der `LICENSE`-Datei ändert sich nichts (der AGPL-Text bleibt
unverändert). Optional kannst du am Ende von `README.md` eine Zeile „Copyright © 2026 Dein Name“ ergänzen.

**Name/Marke:** Für „TillSplit“ wurde keine Markenrecherche gemacht. Vor größerer Bekanntheit lohnt eine
kurze Suche in den Registern von DPMA (<https://register.dpma.de>), EUIPO (<https://euipo.europa.eu/eSearch>)
und WIPO (<https://branddb.wipo.int>), vor allem in den Klassen 9 und 42 (Software).

---

## 4. GitHub-Organisation und Repository anlegen

**Erledigt:** Dachorganisation `t3chdock-labs` (für TillSplit und spätere Projekte), Repository
`t3chdock-labs/TillSplit`. Auf Docker Hub heißt der Namensraum `t3chdocklabs` – dort sind keine
Bindestriche erlaubt. Zusätzlich ist `t3chdock` auf GitHub vorsorglich gesichert.

| | Adresse |
|---|---|
| Quellcode | `https://github.com/t3chdock-labs/TillSplit` |
| Docker Hub | `t3chdocklabs/tillsplit` |
| GHCR | `ghcr.io/t3chdock-labs/tillsplit` (Image-Namen müssen kleingeschrieben sein) |

### 4.1 Organisation

1. Mit deinem persönlichen Konto auf <https://github.com> anmelden (Zwei-Faktor-Anmeldung sollte aktiv sein).
2. Oben rechts **+ → New organization → Free** wählen.
3. Organization name: `t3chdock-labs`, Kontakt-E-Mail eintragen, „My personal account“ auswählen.
4. Einladungen überspringen.

Vorteil der Organisation: Das Projekt hängt nicht an deinem Benutzernamen, weitere Betreuer und weitere
Projekte lassen sich später hinzufügen.

### 4.2 Repository

1. In der Organisation **Repositories → New repository**.
2. Owner `t3chdock-labs`, Name `TillSplit`, Description:
   `Self-hosted receipt scanner: reads receipts with AI and splits them into Actual Budget`
3. **Public**.
4. **Nicht** „Add a README“, **keine** `.gitignore`, **keine** Lizenz anklicken – das alles bringst du mit.
   Sonst gibt es beim ersten Push einen Konflikt.
5. **Create repository**.

Mit gh geht es auch per Befehl (nach `gh auth login`):

```powershell
gh repo create t3chdock-labs/TillSplit --public --description "Self-hosted receipt scanner: reads receipts with AI and splits them into Actual Budget"
```

---

## 5. Lokales git-Repository, erster Commit, erster Push

```powershell
cd C:\Temp\TillSplit
git init
git add .
```

**Jetzt ansehen, was hineinkommt** – bevor du committest:

```powershell
git status --short
git status --short | Select-String 'node_modules|dist/|\.env|tsbuildinfo|\.dump|\.zip|\.bak|data/|backup'
```

Die zweite Zeile muss **leer** bleiben. Erwartet sind etwa: `.dockerignore`, `.gitignore`, `.github/…`,
`CONTRIBUTING.md`, `Dockerfile`, `LICENSE`, `README*.md`, `SECURITY.md`, `THIRD_PARTY_LICENSES.md`,
`docker-stack.yml`, `docs/…`, `server/` (ohne `node_modules`, `dist`), `web/` (ohne `node_modules`, `dist`),
`werkzeuge/`. Falls etwas Falsches drin ist: `git rm --cached <pfad>`, in `.gitignore` eintragen, erneut `git add .`.

Dann committen, Historie mit gitleaks prüfen (Schritt 1.3 b, zweiter Befehl) und pushen:

```powershell
git commit -m "TillSplit 0.1.0 – erste öffentliche Version"
git remote add origin https://github.com/t3chdock-labs/TillSplit.git
git push -u origin main
```

Beim ersten Push öffnet sich ein Browserfenster zur Anmeldung bei GitHub (Git Credential Manager).
Dort anmelden – kein Token in die Konsole kopieren.

---

## 6. Repository-Einstellungen

Auf `github.com/t3chdock-labs/TillSplit`:

1. **About** (Zahnrad rechts oben auf der Startseite): Topics setzen, z. B.
   `actual-budget`, `receipts`, `receipt-scanner`, `self-hosted`, `budgeting`, `ocr`, `claude`, `ollama`,
   `docker`, `personal-finance`. Website leer lassen oder später Docker-Hub-Link.
2. **Settings → General → Features:** *Issues* an, *Discussions* an (die Issue-Vorlage verweist auf
   Discussions für Fragen), *Wiki* aus.
3. **Settings → Advanced Security** (bzw. *Code security*):
   - *Private vulnerability reporting* → **Enable** (nötig für `SECURITY.md`)
   - *Dependabot alerts* und *Dependabot security updates* → **Enable**
   - *Secret Protection / Push protection* → **Enable** (blockiert künftige Pushes mit Schlüsseln)
4. **Settings → Branches → Add branch ruleset** für `main` (optional, empfohlen sobald andere mitmachen):
   Pull Request erforderlich, Status-Check „Prüfen“ erforderlich, Force-Push verbieten.
5. **Settings → Actions → General:** *Workflow permissions* auf „Read repository contents“ lassen
   (die Workflows fordern `packages: write` selbst an).

Die READMEs sind schon zweisprachig mit Umschalter (`**Deutsch** · [English](README.md)`), GitHub zeigt
automatisch `README.md` (englisch) an – passend für ein internationales Publikum.

---

## 7. Docker Hub – Konto, Repository, Access Token

### 7.1 Namensraum `t3chdocklabs` sichern

Auf Docker Hub sind **Organisationen kostenpflichtig** (Team-Plan). Für ein Ein-Personen-Projekt reicht ein
**eigenes, kostenloses Benutzerkonto mit dem Namen `t3chdocklabs`** (**erledigt**):

1. Auf <https://hub.docker.com/signup> ein Konto `t3chdocklabs` anlegen (eigene E-Mail-Adresse oder ein
   Plus-Alias wie `dein.name+docker@…`). Zwei-Faktor-Anmeldung aktivieren.
2. Später, wenn das Projekt wächst: Bewerbung beim **Docker-Sponsored Open Source Program**
   (<https://www.docker.com/community/open-source/application/>) – bringt kostenlose Organisation,
   keine Pull-Limits für Nutzer und ein „Sponsored OSS“-Abzeichen. Voraussetzung u. a.: aktives Projekt,
   OSI-Lizenz (AGPL erfüllt das), keine kommerzielle Hauptnutzung.

### 7.2 Repository anlegen

**Repositories → Create a repository**: Namespace `t3chdocklabs`, Name `tillsplit`, *Public*,
Short description: `Self-hosted receipt scanner for Actual Budget (amd64, arm64)`.
(Würde beim ersten Push auch automatisch angelegt, so stimmt aber gleich die Beschreibung.)

### 7.3 Access Token für GitHub Actions

1. Avatar → **Account settings → Personal access tokens → Generate new token**.
2. Beschreibung `github-actions-tillsplit`, Ablauf z. B. 1 Jahr (im Kalender notieren),
   Berechtigung **Read & Write**.
3. **Generate** – das Token wird nur einmal angezeigt. Nicht speichern, nicht kopieren in Dateien;
   direkt weiter zu Schritt 8 und dort in das Secret-Feld einfügen. Geht es verloren: einfach ein neues erzeugen.

---

## 8. Secrets für GitHub Actions hinterlegen

Auf `github.com/t3chdock-labs/TillSplit` → **Settings → Secrets and variables → Actions**:

| Reiter | Name | Wert |
|---|---|---|
| **Variables** → New repository variable | `DOCKERHUB_USERNAME` | `t3chdocklabs` |
| **Secrets** → New repository secret | `DOCKERHUB_TOKEN` | das Token aus 7.3 (einfügen, speichern) |

Für **GHCR** ist nichts nötig – der Workflow nutzt das eingebaute `GITHUB_TOKEN`.

Was der Workflow `.github/workflows/docker.yml` tut:

- startet bei jedem Tag `v*.*.*` (oder von Hand unter *Actions → Docker-Image → Run workflow*),
- baut mit `docker buildx` für **linux/amd64 und linux/arm64**,
- vergibt aus `v0.1.0` die Tags `0.1.0`, `0.1` und `latest`,
- pusht nach `docker.io/t3chdocklabs/tillsplit` **und** `ghcr.io/t3chdock-labs/tillsplit`,
- erzeugt SBOM und Provenance (Herkunftsnachweis), nutzt einen Build-Cache.

Soll es **nur Docker Hub** sein: in `docker.yml` den Schritt „Anmelden bei GHCR“ und die Zeile
`${{ env.GHCR_IMAGE }}` unter `images:` löschen.

> **Dauer:** arm64 wird auf GitHub per QEMU emuliert, `better-sqlite3` wird dabei kompiliert –
> rechne beim ersten Lauf mit 30–90 Minuten. Wird das lästig, kann man später auf native arm64-Runner
> (`ubuntu-24.04-arm`, für öffentliche Repos kostenlos) mit getrennten Jobs umstellen.

> Die Versionen der Actions (`actions/checkout@v5`, `docker/build-push-action@v6` …) waren beim Schreiben
> aktuell; Dependabot meldet neuere automatisch als Pull Request.

---

## 9. Versionsschema und erste Version taggen

### 9.1 Schema

Überall dieselbe Schreibweise nach SemVer: `MAJOR.MINOR.PATCH`, z. B. `0.1.1`, `0.2.0`.
Nur der git-Tag bekommt ein `v` davor (`v0.1.1`), das ist Konvention und startet den Docker-Workflow.
(Bis 0.1.0 wurde in Fußzeile und Titel zweistellig `0.1.00` angezeigt – das ist abgeschafft.)

Regel: neue Funktionen → MINOR, Korrekturen → PATCH, inkompatible Änderung (vor 1.0 ebenfalls MINOR) → MAJOR.

Stellen, an denen die Version steht (bei jeder neuen Version alle anpassen):

| Datei | Wert für 0.1.1 |
|---|---|
| `server/package.json`, `web/package.json` → `version` | `0.1.1` (`npm version 0.1.1 --no-git-tag-version`) |
| `server/src/index.ts` → `version:` (bei `/api/info`) | `"0.1.1"` |
| `web/src/komponenten/Fusszeile.tsx` (Ersatzwert) | `"0.1.1"` |
| `server/src/backup.ts` → `version:` (in `info.json`) | `"0.1.1"` |
| `README.md`, `README.de.md` Zeile 1 und `docker pull` / `docker run` | `0.1.1` |
| `docker-stack.yml` → `image:` | `t3chdocklabs/tillsplit:0.1.1` |

### 9.2 Erste Version

Für 0.1.0 stimmen alle Werte bereits. Vorher noch die Drittlizenzen aktualisieren und prüfen:

```powershell
node werkzeuge/lizenzen.mjs
cd server; npm run check; cd ..\web; npm run check; cd ..
git add -A; git commit -m "Drittlizenzen aktualisiert"   # nur falls sich etwas geändert hat
```

Lokal einmal testen, ob das Image baut (nur amd64, schnell):

```powershell
docker build -t tillsplit:test .
```

Dann taggen und den Tag pushen – das startet den Build:

```powershell
git tag -a v0.1.0 -m "TillSplit 0.1.0"
git push origin main
git push origin v0.1.0
```

Fortschritt: `github.com/t3chdock-labs/TillSplit/actions`. Wenn der Lauf grün ist:

```powershell
docker buildx imagetools inspect t3chdocklabs/tillsplit:0.1.0
```

zeigt beide Plattformen (`linux/amd64`, `linux/arm64`).

**Schlägt der Login fehl:** Variable heißt exakt `DOCKERHUB_USERNAME` (unter *Variables*, nicht *Secrets*),
Token hat „Read & Write“. Workflow danach über *Re-run jobs* erneut starten – kein neuer Tag nötig.

---

## 10. GitHub-Release und GHCR

### 10.1 Release

**Releases → Draft a new release**:

- Tag: `v0.1.0` (vorhandenen auswählen)
- Titel: `TillSplit 0.1.0`
- Text (Beispiel):

  ```markdown
  First public release.

  **Docker:** `docker pull t3chdocklabs/tillsplit:0.1.0` (also `ghcr.io/t3chdock-labs/tillsplit:0.1.0`) – amd64 and arm64.
  Setup: see [README](https://github.com/t3chdock-labs/TillSplit#deployment-with-docker-swarm) · [Deutsch](https://github.com/t3chdock-labs/TillSplit/blob/main/README.de.md)

  ### Highlights
  - Read receipts with Claude, Ollama or Tesseract
  - Split card payments into Actual Budget categories
  - …
  ```

- „Set as the latest release“ → **Publish release**.

Mit gh: `gh release create v0.1.0 --title "TillSplit 0.1.0" --notes-file notizen.md`
(oder `--generate-notes` für eine automatische Liste ab der zweiten Version).

### 10.2 GHCR-Paket öffentlich machen

Neue GHCR-Pakete sind zunächst **privat**:
Organisation `t3chdock-labs` → **Packages → tillsplit → Package settings → Change visibility → Public**.
Dort unter *Manage Actions access* prüfen, dass das Repository `t3chdock-labs/TillSplit` **Write** hat.
Das Paket wird über das Label `org.opencontainers.image.source` automatisch mit dem Repo verknüpft.

---

## 11. Nacharbeiten

1. **Docker-Hub-Beschreibung:** Auf `hub.docker.com/r/t3chdocklabs/tillsplit` → *Overview → Edit* einen kurzen
   Text einfügen: Was ist TillSplit, `docker pull`-Befehl, Link zum GitHub-README, Lizenz AGPL-3.0, unterstützte
   Plattformen. (Das komplette README zu kopieren ist unnötig; der Link reicht.)
2. **Eigene Installation umstellen:** In deiner `docker-stack.local.yml` `image: t3chdocklabs/tillsplit:0.1.0`
   setzen, bei Bedarf `SOURCE_URL` und `DONATE_URL` eintragen, dann
   `docker stack deploy -c docker-stack.local.yml tillsplit`. Fußzeile prüfen: Version `0.1.0`, Link „Quellcode“.
3. **Altkopie:** `C:\Temp\BonBuch-Test` enthält Secrets – nicht ins Repo, nicht hochladen. Wenn nicht mehr
   gebraucht, selbst löschen.
4. **Bekanntmachen (optional):** Actual-Budget-Community (Discord, GitHub-Discussions von Actual),
   r/selfhosted, Liste „awesome-selfhosted“ (dort per Pull Request, Voraussetzungen beachten).
5. **Docker-Token-Ablauf** im Kalender notieren (Schritt 7.3).

---

## Anhang A: Image von Hand bauen und pushen (ohne GitHub Actions)

Falls du vor dem Einrichten der Actions schon ein Image veröffentlichen willst oder Actions ausfallen.

```powershell
# Anmelden – das Token wird abgefragt, nicht in den Befehl schreiben
docker login -u t3chdocklabs

# Builder für mehrere Plattformen (einmalig)
docker buildx create --name tillsplit-builder --driver docker-container --use
docker buildx inspect --bootstrap

# Bauen und direkt pushen (amd64 + arm64)
docker buildx build `
  --platform linux/amd64,linux/arm64 `
  --label org.opencontainers.image.source=https://github.com/t3chdock-labs/TillSplit `
  --label org.opencontainers.image.licenses=AGPL-3.0-or-later `
  -t t3chdocklabs/tillsplit:0.1.0 `
  -t t3chdocklabs/tillsplit:0.1 `
  -t t3chdocklabs/tillsplit:latest `
  --push .

# Kontrolle
docker buildx imagetools inspect t3chdocklabs/tillsplit:0.1.0
```

Zusätzlich GHCR: Auf GitHub ein *Personal access token (classic)* mit nur `write:packages` erzeugen, dann
`docker login ghcr.io -u DEIN-GITHUB-NAME` (Token bei der Abfrage einfügen) und im Build-Befehl weitere
`-t ghcr.io/t3chdock-labs/tillsplit:0.1.0` usw. ergänzen.

Multi-Arch-Images lassen sich nicht in den lokalen Docker-Speicher laden, deshalb `--push`.
Nur lokal testen: `docker buildx build --platform linux/arm64 -t tillsplit:arm-test --load .`

Unter Linux/macOS statt der Backticks `` ` `` am Zeilenende einen Backslash `\` verwenden.

---

## Anhang B: Checkliste für jede weitere Version

1. Version in allen Stellen aus 9.1 erhöhen (z. B. `0.1.1`).
2. `node werkzeuge/lizenzen.mjs` (falls Abhängigkeiten geändert), `npm run check` in `server` und `web`,
   `node werkzeuge/texte-pruefen.mjs`.
3. gitleaks über das Repository laufen lassen (Schritt 1.3 b).
4. `CHANGELOG.md` und `CHANGELOG.de.md` um die neue Version ergänzen (Neu / Geändert / Behoben, Vergleichslink unten).
5. Commit, dann:
   ```powershell
   git tag -a v0.1.1 -m "TillSplit 0.1.1"
   git push origin main
   git push origin v0.1.1
   ```
6. Actions-Lauf abwarten, Release mit Titel `TillSplit 0.1.1` anlegen, als Text den Abschnitt aus `CHANGELOG.md`.
7. Eigene Installation auf das neue Image umstellen.
