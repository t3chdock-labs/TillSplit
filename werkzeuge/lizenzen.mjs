// Erzeugt THIRD_PARTY_LICENSES.md aus den installierten Produktiv-Abhängigkeiten.
// Aufruf im Projektordner (nach npm install in server/ und web/): node werkzeuge/lizenzen.mjs
import fs from "node:fs";
import path from "node:path";

const wurzel = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const zeilen = [];
const hinweise = [];

for (const teil of ["server", "web"]) {
  const basis = path.join(wurzel, teil);
  const lock = JSON.parse(fs.readFileSync(path.join(basis, "package-lock.json"), "utf8"));
  for (const [pfad, p] of Object.entries(lock.packages)) {
    if (!pfad || p.dev) continue;
    const ordner = path.join(basis, pfad);
    let pj = {};
    try {
      pj = JSON.parse(fs.readFileSync(path.join(ordner, "package.json"), "utf8"));
    } catch {
      continue; // für andere Plattformen (nicht installiert)
    }
    let lizenz = p.license ?? pj.license;
    lizenz = typeof lizenz === "object" ? lizenz?.type : lizenz;
    if (!lizenz && fs.existsSync(path.join(ordner, "LICENSE")) && /Permission is hereby granted/.test(fs.readFileSync(path.join(ordner, "LICENSE"), "utf8"))) lizenz = "MIT";
    const quelle = typeof pj.repository === "string" ? pj.repository : pj.repository?.url ?? pj.homepage ?? "";
    zeilen.push({ name: pj.name ?? pfad.replace(/.*node_modules\//, ""), version: pj.version ?? p.version, lizenz: lizenz ?? "siehe Paket", quelle: quelle.replace(/^git\+/, "").replace(/\.git$/, ""), teil });
    // Apache-2.0 verlangt die Weitergabe vorhandener NOTICE-Dateien
    for (const datei of ["NOTICE", "NOTICE.md", "NOTICE.txt"]) {
      if (fs.existsSync(path.join(ordner, datei))) hinweise.push({ name: pj.name, text: fs.readFileSync(path.join(ordner, datei), "utf8").trim() });
    }
  }
}

const eindeutig = [...new Map(zeilen.map((z) => [`${z.name}@${z.version}`, z])).values()].sort((a, b) => a.name.localeCompare(b.name));
const md = [
  "# Lizenzen von Drittanbietern",
  "",
  "TillSplit selbst steht unter der GNU Affero General Public License v3.0 (siehe `LICENSE`).",
  "TillSplit nutzt die folgenden Bibliotheken und Programme. Ihre Lizenztexte liegen jeweils im Paket (`node_modules/<paket>/LICENSE`) bzw. im Docker-Image unter `/usr/share/doc/<paket>/copyright`.",
  "",
  "## Programme im Docker-Image",
  "",
  "| Programm | Lizenz | Zweck |",
  "|---|---|---|",
  "| Node.js | MIT | Laufzeitumgebung |",
  "| Tesseract OCR (tesseract-ocr, tesseract-ocr-deu) | Apache-2.0 | Texterkennung |",
  "| Poppler (poppler-utils: pdftoppm, pdftotext) | GPL-2.0 / GPL-3.0 | PDF in Bild/Text umwandeln (eigenständiges Programm) |",
  "| libheif (libheif-examples: heif-convert) | LGPL-3.0 / MIT | iPhone-Fotos (HEIC) umwandeln |",
  "| PostgreSQL-Client (pg_dump) | PostgreSQL-Lizenz | Backups |",
  "| tini | MIT | Prozessverwaltung im Container |",
  "| Debian GNU/Linux (Basis-Image) | verschiedene freie Lizenzen | Betriebssystem; Quellcode unter https://sources.debian.org |",
  "",
  "## Bibliotheken",
  "",
  "| Paket | Version | Lizenz | Teil | Quelle |",
  "|---|---|---|---|---|",
  ...eindeutig.map((z) => `| ${z.name} | ${z.version} | ${z.lizenz} | ${z.teil === "web" ? "Oberfläche" : "Server"} | ${z.quelle} |`),
  "",
  "Hinweis: `hyperformula` (GPL-3.0) wird von `@actual-app/api` mitgebracht. Deshalb steht TillSplit unter einer GPL-verträglichen Lizenz (AGPL-3.0).",
  "",
];
if (hinweise.length) {
  md.push("## NOTICE-Dateien (Apache-2.0)", "");
  for (const h of hinweise) md.push(`### ${h.name}`, "", "```", h.text, "```", "");
}
fs.writeFileSync(path.join(wurzel, "THIRD_PARTY_LICENSES.md"), md.join("\n"));
console.log(`${eindeutig.length} Pakete, ${hinweise.length} NOTICE-Dateien -> THIRD_PARTY_LICENSES.md`);
