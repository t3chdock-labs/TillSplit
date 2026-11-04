# TillSplit 0.1.00

[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-blue.svg)](LICENSE)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-unterst%C3%BCtzen-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/tamperold)

**Deutsch** · [English](README.md)

Kassenbons erfassen (Foto, Screenshot, PDF), Artikel für Artikel auslesen, nach Warengruppen auswerten und die Abbuchung in **Actual Budget** nach Bereichen aufteilen. Actual bleibt für die Buchhaltung zuständig, TillSplit liefert die Details.

## So funktioniert's

1. **Hochladen:** am Handy über den Kamera-Knopf oder per „Teilen“ aus einer anderen App (Android), am PC per Drag & Drop, Dateiauswahl oder Strg+V.
2. **Lesen:** Claude (oder Ollama lokal) liest Geschäft, Datum, Summe und alle Positionen aus und ordnet jede Position einer Untergruppe zu (Gemüse, Getränke, Süßigkeiten …).
3. **Prüfen:** Bild und Positionen stehen nebeneinander. Die Summe wird gegengeprüft. Jede Korrektur wird als Regel gemerkt und künftig automatisch angewendet.
4. **Buchen:** TillSplit sucht in Actual die passende Abbuchung (gleicher Betrag, −4 bis +10 Tage) und teilt sie nach **Hauptgruppen** auf (Lebensmittel, Drogerie, Baumarkt …). Bei Barzahlung kann eine neue Buchung angelegt werden. Geänderte Buchungen bekommen den Tag `#tillsplit`.
5. **Gliederung in drei Ebenen:** Bereich (Lebensmittel) → Gruppe (Getränke, Gemüse, Süßigkeiten …) → **Sorte** (Cola, Mineralwasser, Saft · Tomate, Gurke · Schokolade, Fruchtgummi). Die Sorte setzt die KI aus dem Bontext, ohne Marke und Größe; ist eine Zeile zu kryptisch, bleibt sie leer und die Auswertung nimmt den Artikelnamen. Korrigierte Sorten werden wie Gruppen gelernt.
6. **Finanzen:** Eigene Seite mit den Buchungen aus Actual – Einnahmen, Ausgaben, Sparquote, Kreisdiagramm Gruppen → Kategorien → Empfänger, Verlauf mit Einnahmen-Linie, größte Empfänger und Ausgaben, Vermögensverlauf der Depots. Unter *Einstellungen → Finanzen* wählst du die Budgets (mehrere möglich), die Vermögenskonten und Kategorien, die nicht mitzählen sollen (z. B. Überweisungen zwischen den Budgets). Die Daten werden alle `FINANZEN_STUNDEN` (Standard 3) und per Knopf neu eingelesen.
7. **Lange Bons:** Beim Hochladen lässt sich jedes Foto zuschneiden (mit Lupe an den Ecken) und drehen. Mehrere Fotos eines langen Bons werden mit „Teile eines langen Bons“ zu einem Bild zusammengefügt.
8. **Auswerten:** Übersicht mit Bereichen, Monatsverlauf, Top-Artikeln, Geschäften und Wochentagen. Unter „Artikel“ gibt es den Preisverlauf je Produkt.

### Bar, Karte und Konten

- **Beim Hochladen** wird gefragt, wie bezahlt wurde: „Vom Bon“ (automatisch erkennen), „Karte / Konto“ oder „Bar“. Optional lässt sich das Actual-Konto vorgeben, z. B. „Haushalt“ oder „DKB“.
- **Karte auf dem Bon:** Bei Kartenzahlung liest TillSplit die letzten 4 Ziffern der Karte (nie mehr). Unter *Einstellungen → KI & Actual → Karten → Konten* wird jede Karte einem Konto zugeordnet. Wählst du beim Prüfen einmal von Hand ein Konto, merkt sich TillSplit die Karte automatisch.
- **Barzahlung** (Einstellungen → Actual → Barzahlungen):
  - **Aus Kategorie umbuchen** (Standard, ohne eigenes Bargeld-Konto): Abhebungen am Geldautomaten bekommen in Actual eine Kategorie wie „Bargeld“ (am einfachsten per Actual-Regel auf den Empfänger der Abhebung). Für jeden Barbon legt TillSplit im gewählten Konto eine Buchung über **0 €** an: +Summe auf „Bargeld“, −Teilbeträge auf Lebensmittel, Drogerie usw. Der Kontostand und der Bankabgleich bleiben unberührt, aber die Ausgaben stehen in den richtigen Kategorien. Was auf „Bargeld“ übrig bleibt, ist Bargeld ohne Bon.
  - **Eigenes Bargeld-Konto:** Barbons werden dort als Ausgabe gebucht.
  - **Nur in TillSplit:** Actual bleibt unverändert.
- **Kartenzahlung:** Weil die Bank nur einmal im Monat importiert wird, bekommt der Bon den Status **„Wartet auf Bank“**. Ein Hintergrundabgleich (alle `ABGLEICH_STUNDEN`, Standard 6) sucht nach genau einer passenden Abbuchung und teilt sie automatisch auf – im festgelegten Konto, oder bei unbekannter Karte in allen Budget-Konten. Wird die Abbuchung so gefunden, merkt sich TillSplit, zu welchem Konto die Karte gehört. Nach einem Import geht es auch sofort über **Bons → Mit Actual abgleichen**. Gibt es mehrere gleich hohe Abbuchungen, wählst du die richtige von Hand.

Ablage der Originale: `<BON_DIR>/<Jahr>/<Monat>/<Datum>_<Geschäft>_<Summe>.jpg|pdf`, z. B. `2026/11/2026-11-02_REWE_47,80.jpg`. HEIC-Fotos (iPhone) werden als JPEG abgelegt.

## Einrichtung im Docker Swarm

### 1. Image bauen

Auf einem Swarm-Knoten (oder lokal und in die Registry pushen):

```bash
docker build -t tillsplit:0.1.0 .
```

Bei mehreren Knoten das Image in eine Registry pushen und `TILLSPLIT_IMAGE` setzen.

### 2. Secrets anlegen

```bash
openssl rand -base64 24 | docker secret create tillsplit_db_passwort -
openssl rand -base64 32 | docker secret create tillsplit_schluessel -
printf '%s' 'LANGES-BACKUP-PASSWORT' | docker secret create tillsplit_backup_passwort -
printf '%s' 'sk-ant-…'            | docker secret create tillsplit_anthropic_key -
printf '%s' 'ACTUAL-SERVERPASSWORT' | docker secret create tillsplit_actual_passwort -
```

`tillsplit_schluessel` verschlüsselt gespeicherte Zugangsdaten (Actual-Passwörter der Haushalte, TOTP-Geheimnisse). **Mitsichern** – ohne ihn sind diese Daten nach einer Wiederherstellung unbrauchbar.

### 3. `docker-stack.yml` anpassen

| Platzhalter | Bedeutung |
|---|---|
| `PUBLIC_URL` | öffentliche Adresse, z. B. `https://bon.example.de` (Passkeys, HSTS) |
| `ACTUAL_SERVER_URL` | Actual-Server für den ersten Haushalt (weitere Haushalte im Admin-Bereich) |
| `ACTUAL_SYNC_ID` | Actual → Einstellungen → Erweiterte Einstellungen → „Sync ID“ |
| `OLLAMA_URL` | Laptop mit Ollama, z. B. `http://192.168.1.50:11434` |
| NFS `addr` / `device` | Share für die Bon-Ablage |
| Traefik-Labels / Domain | an deinen Reverse Proxy anpassen |
| `node.hostname` | Knoten, auf dem Postgres seine Daten hält |

```bash
docker stack deploy -c docker-stack.yml tillsplit
```

### 4. Erster Start

Beim allerersten Start steht im Protokoll ein **Einrichtungscode** (`docker service logs tillsplit_app`). Damit legst du im Browser den ersten Administrator an. Alternativ `ADMIN_EMAIL` und `ADMIN_PASSWORD_FILE` setzen.

**Einstellungen → Warengruppen:** Jeder Hauptgruppe eine Actual-Kategorie zuordnen. **Einstellungen → Actual:** Konten wählen, in denen nach Abbuchungen gesucht wird, sowie eine Standard-Kategorie.

## Sprachen

Oberfläche und Meldungen gibt es auf **Deutsch** und **Englisch**. Beim ersten Aufruf gilt die Browsersprache; umstellen lässt sie sich auf der Anmeldeseite und unter *Mein Konto* (gilt dann für das Konto auf allen Geräten). Zahlen, Datum und Monatsnamen folgen der gewählten Sprache.

Die **Sprache der Installation** wählt der erste Administrator bei der Ersteinrichtung (änderbar unter *Einstellungen → Actual → Texterkennung*, Vorgabe auch per `TILLSPLIT_SPRACHE=de|en`). In ihr benennt die KI Artikel und Sorten, in ihr werden die Standard-Warengruppen angelegt und Hinweise geschrieben, die im Hintergrund entstehen. Der Text vom Bon bleibt immer, wie er ist. Tesseract liest standardmäßig Deutsch und Englisch (`TESSERACT_LANG=deu+eng`).

**Neue Sprache beitragen** – ganz ohne Programmänderung:

1. `web/src/sprachen/en.json` und `server/sprachen/en.json` nach `<code>.json` kopieren (z. B. `fr.json`, Sprachcode nach ISO 639-1).
2. `"@sprache"` auf den Anzeigenamen setzen (z. B. `"Français"`) und die Werte übersetzen. Schlüssel ist der deutsche Text, Platzhalter wie `{n}` bleiben stehen.
3. Mehrzahlformen werden mit `|` getrennt, in der Reihenfolge der Mehrzahl-Kategorien der Sprache (`zero|one|two|few|many|other`, nur die vorhandenen – Englisch `one|other`, Polnisch `one|few|many|other`).
4. `node werkzeuge/texte-pruefen.mjs` zeigt fehlende und überzählige Einträge sowie kaputte Platzhalter.

Die Sprache erscheint danach automatisch in der Auswahl; Zahlen- und Datumsformate kommen aus dem Browser (`Intl`). Für Tesseract das Image mit dem passenden Sprachpaket bauen: `docker build --build-arg TESSERACT_SPRACHEN="deu eng fra" …` und `TESSERACT_LANG=deu+eng+fra` setzen.

## Benachrichtigungen

Eine **Glocke** oben in der Seitenleiste (am Handy oben rechts) zeigt neue Ereignisse. Unter *Mein Konto → Benachrichtigungen* legt jeder fest, über welche Kanäle er was erfährt:

| Ereignis | An wen | Bündelung |
|---|---|---|
| Neue Bons hochgeladen | die anderen Mitglieder des Haushalts | eine Nachricht je Upload, egal wie viele Dateien |
| Bons gelesen | Hochladende und alle, die prüfen dürfen | eine Nachricht je Lesedurchgang (wenn die Warteschlange leer ist) |
| Prüfung ausstehend | alle, die prüfen dürfen | täglich, alle 2 Tage oder wöchentlich zur gewählten Uhrzeit – nur wenn etwas offen ist |

E-Mail und Telegram werden je Benutzer zusätzlich gesammelt: sofort (je Minute), alle 15 Minuten, stündlich, alle 4 Stunden oder einmal täglich. Eine Testnachricht prüft alle Kanäle.

| Variable | Bedeutung |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SICHER` (`true` bei Port 465) | Mailserver |
| `SMTP_USER`, `SMTP_PASSWORD` (`_FILE`) | Anmeldung, falls nötig |
| `SMTP_FROM` | Absender, z. B. `TillSplit <tillsplit@example.com>` |
| `TELEGRAM_BOT_TOKEN` (`_FILE`) | Token vom @BotFather; unter *Mein Konto* verbindet jeder einen oder mehrere eigene Chats und Gruppen (z. B. „Familie“) per Einmal-Link, `/stop` trennt. Gruppen bekommen keine Nachlese-Knöpfe, und eine Gruppe lässt sich nur einmal verbinden |
| `TZ` | Zeitzone der Erinnerungen (Standard `Europe/Berlin`) |
| `PUBLIC_URL` | nötig für Links in Mails und Telegram-Nachrichten |

**Nachlesen per Telegram:** Konnte ein Bon nicht gelesen werden oder passen die Positionen nicht zur Summe, trägt die Telegram-Nachricht Knöpfe wie „REWE: Sonnet 5.5 ≈ 5 Cent“ – für alle, die prüfen dürfen. Ein Tipp reiht den Bon mit dem größeren Modell ein (Kostenschutz gilt); ist er fertig, kommt eine neue Nachricht. Sicherheit: Auf geschriebenen Text reagiert der Bot nie – nur auf `/start <Einmal-Code>` und `/stop`. Jeder Knopf trägt eine zufällige, von TillSplit erzeugte Kennung, die nur einmal, 48 Stunden lang, nur für diesen Benutzer, Bon und dieses Modell und nur aus dem verknüpften Chat gilt; die Berechtigung wird bei jedem Tipp neu geprüft, gebuchte Bons werden nie neu gelesen.

Der Bot fragt selbst bei Telegram nach (kein offener Port nötig). TillSplit braucht einen **eigenen Bot**: Einen Bot, den schon ein anderes Programm abfragt (z. B. Home Assistant), kann man nicht teilen – beide würden sich gegenseitig Nachrichten wegnehmen. TillSplit erkennt das und schaltet Telegram mit Hinweis im Protokoll ab.

## Benutzer, Haushalte und Rechte

- **Haushalt:** eigene Bons, Warengruppen, gelernte Zuordnungen, Karten, Actual-Zugang und Bon-Ablage. Ein Benutzer kann zu mehreren Haushalten gehören und wechselt oben in der Seitenleiste.
- **Rechte je Mitglied:** Bons hochladen darf jedes Mitglied. Dazu einzeln: *Alle Bons & Auswertung*, *Bons prüfen & buchen*, *Finanzen* (Actual-Dashboard) und *Haushalt verwalten*. Vorlagen: „Nur hochladen“ (z. B. Kinder – sehen nur ihre eigenen Bons), „Leser“, „Mitglied“, „Mitglied mit Finanzen“, „Verwalter“.
- **Admin-Bereich** (nur Administratoren): Benutzer anlegen (mit Startpasswort, das bei der ersten Anmeldung geändert werden muss), sperren, Passwort oder Zwei-Faktor zurücksetzen; Haushalte mit Ablage-Ordner und Actual-Zugang; Mitglieder und Rechte; Protokoll aller Anmeldungen und Änderungen.
- **Bon-Ablage je Haushalt:** Unterordner von `BON_DIR` oder ein absoluter Pfad innerhalb von `ABLAGE_WURZELN` (z. B. ein eigener NFS-Mount je Haushalt). Andere Pfade werden abgelehnt.

## Anmeldung und Sicherheit

- **Passwörter** mit Argon2id; mindestens 10 Zeichen.
- **Zwei-Faktor:** Authenticator-App (TOTP, mit 10 Wiederherstellungscodes) und/oder **Passkeys** (Fingerabdruck, Face-ID, Geräte-PIN – auch ganz ohne Passwort). Passkeys brauchen HTTPS und `PUBLIC_URL`. Mit `ZWEI_FAKTOR_PFLICHT=true` müssen alle einen zweiten Faktor einrichten.
- **Sitzungen** liegen in der Datenbank (Cookie nur `HttpOnly`, `SameSite=Lax`, bei HTTPS `Secure`); unter *Mein Konto* sind alle angemeldeten Geräte sichtbar und einzeln abmeldbar. Passwortänderung meldet alle anderen Geräte ab.
- **Schutz vor Raten:** je IP höchstens 10 Anmeldeversuche pro Minute; nach 8 Fehlversuchen wird das Konto 15 Minuten gesperrt.
- **Fail2Ban:** Fehlversuche stehen als `TILLSPLIT_ANMELDUNG_FEHLGESCHLAGEN ip=…` im Protokoll. Filter und Jail liegen unter `docs/fail2ban/`. Damit die echte Client-IP ankommt, muss `TRUST_PROXY` das Netz des Reverse Proxys enthalten (Standard: private Netze).
- **Weitere Härtung:** Content-Security-Policy und weitere Sicherheits-Header, Schutz vor Anfragen fremder Seiten (Origin-Prüfung), jede Abfrage auf den eigenen Haushalt und die eigenen Rechte beschränkt, Uploads nach Inhalt geprüft und neu kodiert, Zugangsdaten verschlüsselt gespeichert.

## Bon-Ablage: Vorlage und Verschlüsselung

Unter *Einstellungen → Ablage* stellt jeder Haushalt Ordner und Dateinamen aus Bausteinen zusammen (Drag & Drop oder Antippen): `{Jahr}`, `{Monat}`, `{Monatsname}`, `{Tag}`, `{Datum}`, `{Händler}`, `{Summe}`, `{Zahlung}`, `{Hochgeladen}`, `{Haushalt}`, `{Bon}`, dazu „Ordner“ als neue Ebene und eigener Text. Beispiele: `{Jahr}/{Monat}/{Datum}_{Händler}_{Summe}` (Standard) oder `{Jahr}/{Händler}/{Datum}_{Summe}`. Vorhandene Bons lassen sich nach einer neuen Vorlage umbenennen.

**Verschlüsselung** (je Haushalt): Bon-Dateien werden mit AES-256-GCM verschlüsselt abgelegt (`….jpg.enc`), schon beim Hochladen. Die Ordnerstruktur bleibt erhalten, öffnen lassen sich die Dateien aber nur noch über TillSplit. Der Schlüssel wird aus `TILLSPLIT_SCHLUESSEL` abgeleitet – ohne ihn sind die Bons verloren. Beim Ein- und Ausschalten werden alle vorhandenen Bons umgewandelt.

## Bon löschen

Ist ein Bon schon in Actual gebucht, fragt TillSplit beim Löschen nach:
- **Barbon** (Buchung von TillSplit angelegt): die Buchung wird in Actual gelöscht.
- **Kartenzahlung** (vorhandene Abbuchung aufgeteilt): die Aufteilung wird zurückgenommen, die Abbuchung bleibt unkategorisiert stehen.
- Oder Actual bleibt unverändert.

## Backup und Wiederherstellung

Ein Backup enthält die Datenbank (`pg_dump`), alle Bon-Ablagen und den Schlüssel für gespeicherte Zugangsdaten – als `tar.gz`, verschlüsselt mit `BACKUP_PASSWORD` (scrypt + AES-256-GCM). Ohne gesetztes Passwort werden keine Backups erstellt.

| Variable | Bedeutung |
|---|---|
| `BACKUP_PASSWORD` (`_FILE`) | Passwort der Backups – gut aufbewahren, ohne es ist kein Backup lesbar |
| `BACKUP_DIR` | Ablage, am besten ein anderes NAS/Share als die Bons (Standard `/data/backups`) |
| `BACKUP_STUNDEN` | Abstand automatischer Backups (Standard 24, `0` = nur von Hand) |
| `BACKUP_BEHALTEN` | Anzahl aufbewahrter Backups (Standard 14) |
| `BACKUP_MIT_BONS` | Bon-Dateien mitsichern (Standard `true`) |

Im *Admin-Bereich → Backups*: sofort sichern, herunterladen, löschen.

**Wiederherstellen** (TillSplit vorher stoppen):

```bash
# 1. entschlüsseln (im TillSplit-Container oder mit Node auf dem Host)
docker run --rm -i -e BACKUP_PASSWORD='…' -v "$PWD:/b" tillsplit:0.1.0 \
  node dist/werkzeuge/backup-entschluesseln.js /b/tillsplit-….tar.gz.enc > backup.tar.gz
# 2. auspacken: datenbank.dump, schluessel.txt, info.json und die Bon-Ordner (data/bons/…)
tar -xzf backup.tar.gz
# 3. Datenbank zurückspielen
pg_restore --clean --if-exists --no-owner -d tillsplit datenbank.dump
# 4. Bon-Ordner an ihren Platz kopieren, Inhalt von schluessel.txt als Secret tillsplit_schluessel anlegen
```

## Texterkennung mit Tesseract

Als dritter Weg neben Claude und Ollama-Bildmodellen: **Tesseract** liest den Text des Bons (PDFs mit Textebene direkt), ein Sprachmodell gliedert ihn in Positionen. Das braucht weit weniger Rechenleistung als ein Bildmodell und läuft komplett lokal mit Ollama (`TEXTMODELL_ANBIETER=ollama`, `OLLAMA_TEXT_MODEL=qwen2.5:7b`) – oder sehr günstig mit Claude als reinem Textmodell (`TEXTMODELL_ANBIETER=claude`, ca. 0,1 Cent je Bon). Bei zerknitterten oder blassen Bons ist es ungenauer als ein Bildmodell. Auswahl im Admin unter *Einstellungen → Actual → Texterkennung* oder je Bon über „Neu lesen → mit Tesseract“.

**Im Internet betreiben:** nur hinter einem Reverse Proxy mit HTTPS (Traefik, Nginx Proxy Manager, Caddy …), `PUBLIC_URL` setzen, `ZWEI_FAKTOR_PFLICHT=true`, Fail2Ban oder CrowdSec davor. Postgres und Actual nicht ins Internet freigeben.

## Ollama auf dem Laptop

```bash
ollama pull qwen2.5vl:7b
```

Damit der Server den Laptop erreicht, Ollama mit `OLLAMA_HOST=0.0.0.0` starten. In den Einstellungen auf „Ollama“ umstellen oder einzelne Bons über „Neu lesen → mit Ollama“ vergleichen. Kleine Modelle verwechseln bei langen Bons gern Zeilen, das lohnt sich vorher zu testen.

## Als App aufs Handy

Seite im Browser öffnen und „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ wählen.

- **Android:** TillSplit erscheint danach im Teilen-Menü, Screenshots und PDFs lassen sich direkt hineinschicken.
- **iOS:** unterstützt kein Teilen-Ziel für Web-Apps. Dort den Kamera-Knopf oder die Dateiauswahl nutzen.

## Grafana (optional)

Die Sicht `v_positionen` enthält jede geprüfte Position mit Datum, Monat, Geschäft, Haupt- und Untergruppe, Artikel und Betrag. Für Grafana einen Lese-Benutzer anlegen:

```sql
create role grafana login password '…';
grant connect on database tillsplit to grafana;
grant usage on schema public to grafana;
grant select on v_positionen, bons, positionen, gruppen, haendler to grafana;
```

Dazu Postgres im Stack für Grafana erreichbar machen (gemeinsames Netzwerk oder Port).

## Kosten Claude

Gemessen an einem kurzen Bon (4 Positionen, rund 5.800 Eingabe-Tokens, davon 4.000 Anweisung):

| Modell | Kosten je Bon |
|---|---|
| `claude-haiku-5-5` | ca. 0,1–0,3 US-Cent |
| `claude-sonnet-5-5` | ca. 2 US-Cent |
| `claude-opus-5-5` | ca. 3,5–5 US-Cent, lange Bons bis ca. 15 Cent |

Empfohlen: `CLAUDE_MODEL=claude-haiku-5-5`. Passt die Summe der Positionen nicht zur Bonsumme, fragt TillSplit standardmäßig nach, bevor ein größeres Modell (Sonnet oder Opus) mit Angabe der voraussichtlichen Kosten nachliest; einstellbar unter *Einstellungen → Actual → Texterkennung*, ebenso Monats- und Bon-Limit. `CLAUDE_EFFORT=low` spart bei Haiku kaum, ordnet aber schlechter zu – besser `medium` lassen.

Werden mehrere Bons auf einmal hochgeladen, wird die Anweisung zwischengespeichert (Prompt-Caching): ab dem zweiten Bon kostet sie nur noch 5 %. Verbrauch und Kosten stehen auf jeder Bon-Seite unter dem Bild.

## Entwicklung

```bash
cd server && npm install && npm run dev   # API auf :8080 (braucht Postgres, DATABASE_URL)
cd web && npm install && npm run dev      # Oberfläche auf :5173 mit Proxy auf :8080
```

Konfiguration über Umgebungsvariablen, siehe `server/src/config.ts`. Jede Variable kann auch als `NAME_FILE` gesetzt werden.

## Lizenz

TillSplit steht unter der **GNU Affero General Public License v3.0** (AGPL-3.0-or-later), siehe [`LICENSE`](LICENSE).

- Privat und in Vereinen, Firmen oder als Dienst nutzen ist erlaubt.
- Wer TillSplit **verändert** und anderen – auch nur über das Netz – zur Verfügung stellt, muss diesen Nutzern den geänderten Quellcode unter derselben Lizenz anbieten. Dafür gibt es die Einstellung `QUELLCODE_URL` (Link „Quellcode“ in der Fußzeile).
- **Kommerzielle Lizenz:** Wer TillSplit in einem eigenen Produkt nutzen möchte, ohne den Quellcode offenzulegen, kann eine kommerzielle Lizenz anfragen.

Die Lizenzen der verwendeten Bibliotheken und Programme stehen in [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) (neu erzeugen mit `node werkzeuge/lizenzen.mjs`).

## Unterstützen

TillSplit ist kostenlos. Wenn es dir hilft, freue ich mich über einen Kaffee: [ko-fi.com/tamperold](https://ko-fi.com/tamperold)

In der eigenen Installation erscheint ein Knopf „☕ TillSplit unterstützen“, wenn `SPENDEN_URL` gesetzt ist (Forks tragen dort ihren eigenen Link ein oder lassen ihn weg).
