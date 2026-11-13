**Deutsch** · [English](CHANGELOG.md)

# Änderungen

Alle wichtigen Änderungen an TillSplit. Die Versionen folgen [Semantic Versioning](https://semver.org/lang/de/);
Docker-Images: `t3chdocklabs/tillsplit:<version>` und `ghcr.io/t3chdock-labs/tillsplit:<version>`.

## [0.1.4] – 2026-11-13

### Neu
- **Erstattung:** Rücksendungen verrechnen. Am gekauften Bon „Rückgabe erfassen“ wählen und die zurückgegebenen
  Positionen ankreuzen (der erstattete Betrag ist änderbar) – oder den Erstattungsbeleg wie einen Bon hochladen.
  Die Erstattung trägt negative Beträge, hängt am Kauf und wird der Gutschrift in Actual zugeordnet, auf dieselben
  Bereiche wie der Kauf. Die Übersicht rechnet sie von den Ausgaben der Warengruppe ab.
- **Kauf wird automatisch gefunden:** über die Bestellnummer, sonst über Geschäft und erstattete Positionen. Ist der
  Kauf nicht eindeutig, zeigt die Erstattung die möglichen Bons zur Auswahl.
- Die Gutschrift wird bis 45 Tage nach der Rückgabe gesucht; späte Geldeingänge nur, wenn der Empfänger zum
  Geschäft passt. Dieselbe Rückgabe doppelt (von Hand und als Beleg) wird als mögliches Duplikat markiert.
- **Preisänderungen:** Die Übersicht zeigt unten, was teurer und was günstiger geworden ist – je Liste die 100
  größten Änderungen in Prozent. Verglichen wird der letzte Preis im Zeitraum mit dem Preis davor, je Artikel und
  Geschäft. Ein Klick zeigt alle Käufe des Artikels in diesem Geschäft.

## [0.1.3] – 2026-11-11

### Neu
- **Sammelbuchung:** Mehrere Bons gemeinsam auf eine Abbuchung buchen, z. B. mehrere Amazon-Rechnungen, die
  zusammen abgebucht werden. In der Bon-Liste „Zusammen buchen“ wählen, Bons ankreuzen und die Abbuchung über
  die Summe auswählen; sie wird in Actual nach den Bereichen aller Bons aufgeteilt. Geht auch nachträglich mit
  bereits hochgeladenen Bons.
- **Vorschläge beim Abgleich:** Ergeben mehrere offene Bons desselben Geschäfts zusammen genau eine Abbuchung,
  schlägt TillSplit die Sammelbuchung vor – gebucht wird erst nach Bestätigung.
- Bon-Seite zeigt alle Bons einer Sammelbuchung; „Sammelbuchung auflösen“ nimmt die Aufteilung in Actual zurück.
  Wird ein Bon geändert, wird die ganze Sammelbuchung neu aufgeteilt; wird einer gelöscht, wird sie aufgelöst.

## [0.1.2] – 2026-11-06

### Neu
- **PDF-Anzeige:** PDF-Bons und Rechnungen werden direkt auf der Bon-Seite angezeigt (pdf.js), auch auf
  Handys, deren Browser PDFs nicht eingebettet darstellen. Antippen vergrößert, Link „PDF öffnen“.
- **Vorschaubilder** in der Bon-Liste: bei PDFs die erste Seite (mit kleinem „PDF“-Etikett), Fotos
  verkleinert, damit die Liste schneller lädt.
- **Übersicht nach Actual-Konto filtern:** nur Bons eines Kontos auswerten (Barbons zählen zum
  Bargeld-Konto, Bons ohne Konto stehen unter „Ohne Konto“). Gilt für alle Kennzahlen, Diagramme, den
  Vergleich zum Vorzeitraum und die Einzelposten; die Wahl merkt sich jedes Gerät.
- **Einrichtungsassistent:** neuer Schritt „Finanzen einrichten“ mit Unterpunkten (weitere Budgets,
  Finanz-Dashboard, Kategorien je Budget), die automatisch als erledigt erkannt werden.
- **Kategorien automatisch zuordnen:** Gleichnamige Actual-Kategorien werden beim Verbinden oder Hinzufügen
  eines Budgets automatisch den Warengruppen zugeordnet; Knopf „Nach Namen zuordnen“ für den Rest.

### Geändert
- **Warengruppen:** oben das Actual-Budget wählen, dann je Gruppe eine Kategorie – alle Gruppen
  untereinander in voller Breite (auf Handy und PC lesbar); die Kategorie-Auswahl ist durchsuchbar.
- Hinweise in Admin und Einstellungen: weitere Budgets desselben Actual-Servers wählt man in den
  Einstellungen, ein zweiter Haushalt ist dafür nicht nötig.
- `docker-stack.yml`: auskommentiertes NFS-Beispiel für das Backup-Volume.

### Behoben
- Einrichtungsassistent: „Kategorien je Budget zuordnen“ wurde nicht als erledigt markiert.

## [0.1.1] – 2026-11-04

### Neu
- Denkaufwand, Ollama-Server, Textmodell (Tesseract) und Backup-Zeitplan in der Oberfläche einstellbar;
  Umgebungsvariablen sind nur noch Startwerte.
- README: Abschnitt Konfiguration und fertige Images.

### Geändert
- Englische Variablennamen (z. B. `REQUIRE_2FA`, `TILLSPLIT_KEY`, `SOURCE_URL`, `DONATE_URL`);
  die deutschen Namen aus 0.1.0 gelten weiter.
- Spenden-Knopf zeigt standardmäßig auf das Projekt, `DONATE_URL=off` blendet ihn aus.
- `docker-stack.yml` verschlankt und englisch kommentiert, Actual ganz in der Oberfläche,
  Traefik-Labels auskommentiert.
- Version überall als SemVer (`0.1.1` statt `0.1.01`).

## [0.1.0] – 2026-11-04

Erste öffentliche Version.

[0.1.4]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/t3chdock-labs/TillSplit/releases/tag/v0.1.0
