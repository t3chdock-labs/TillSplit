**Deutsch** · [English](CHANGELOG.md)

# Änderungen

Alle wichtigen Änderungen an TillSplit. Die Versionen folgen [Semantic Versioning](https://semver.org/lang/de/);
Docker-Images: `t3chdocklabs/tillsplit:<version>` und `ghcr.io/t3chdock-labs/tillsplit:<version>`.

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

[0.1.2]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/t3chdock-labs/TillSplit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/t3chdock-labs/TillSplit/releases/tag/v0.1.0
