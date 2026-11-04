#!/usr/bin/env node
// Übersetzungen prüfen: sucht alle Texte im Quellcode und vergleicht sie mit den Wörterbüchern.
//
//   node werkzeuge/texte-pruefen.mjs            -> fehlende und überzählige Einträge je Sprache
//   node werkzeuge/texte-pruefen.mjs --vorlage  -> fehlende Einträge als JSON (zum Einfügen und Übersetzen)
//
// Schlüssel ist der deutsche Text. Gefunden werden t("…") sowie auf dem Server feste Fehlermeldungen
// (fehler: "…", httpFehler(…, "…"), new Error("…")), die der Server beim Senden übersetzt.
//
// Translations check: the German text is the key. Copy web/src/sprachen/en.json and server/sprachen/en.json
// to <code>.json, translate the values and register the language in web/src/i18n.ts and server/src/i18n.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vorlage = process.argv.includes("--vorlage");

const BEREICHE = [
  { name: "web", quellen: "web/src", sprachen: "web/src/sprachen", muster: [/\bt\(\s*"((?:[^"\\]|\\.)*)"/g] },
  {
    name: "server",
    quellen: "server/src",
    sprachen: "server/sprachen",
    muster: [
      /\bt\(\s*"((?:[^"\\]|\\.)*)"/g,
      /\bfehler:\s*"((?:[^"\\]|\\.)*)"/g,
      /\bhttpFehler\(\s*\d+,\s*"((?:[^"\\]|\\.)*)"/g,
      /\bnew Error\(\s*"((?:[^"\\]|\\.)*)"/g,
    ],
  },
];

function dateien(verzeichnis) {
  return fs.readdirSync(verzeichnis, { withFileTypes: true }).flatMap((e) => {
    const voll = path.join(verzeichnis, e.name);
    if (e.isDirectory()) return e.name === "sprachen" ? [] : dateien(voll);
    return /\.(ts|tsx)$/.test(e.name) && e.name !== "i18n.ts" ? [voll] : [];
  });
}

let probleme = 0;
const sprachenJeBereich = {};
for (const b of BEREICHE) {
  const schluessel = new Map(); // Text -> erste Fundstelle
  for (const datei of dateien(path.join(wurzel, b.quellen))) {
    const code = fs.readFileSync(datei, "utf8");
    for (const muster of b.muster) {
      for (const m of code.matchAll(muster)) {
        const text = JSON.parse(`"${m[1]}"`);
        // nur Texte mit Buchstaben (keine Codes wie "EUR")
        if (!/[A-Za-zÄÖÜäöüß]{2,}/.test(text)) continue;
        if (!schluessel.has(text)) schluessel.set(text, `${path.relative(wurzel, datei)}:${code.slice(0, m.index).split("\n").length}`);
      }
    }
  }
  const sprachDateien = fs.readdirSync(path.join(wurzel, b.sprachen)).filter((d) => d.endsWith(".json"));
  sprachenJeBereich[b.name] = sprachDateien;
  for (const sd of sprachDateien) {
    const woerterbuch = JSON.parse(fs.readFileSync(path.join(wurzel, b.sprachen, sd), "utf8").replace(/^\uFEFF/, ""));
    const fehlend = [...schluessel.keys()].filter((k) => !woerterbuch[k]);
    if (!woerterbuch["@sprache"]) {
      console.log(`${b.name}/${sd}: "@sprache" (Anzeigename der Sprache) fehlt`);
      probleme++;
    }
    const ueberzaehlig = Object.keys(woerterbuch).filter((k) => !k.startsWith("@") && !schluessel.has(k));
    if (vorlage) {
      if (fehlend.length) console.log(`// ${b.name}/${sd}\n` + JSON.stringify(Object.fromEntries(fehlend.map((k) => [k, ""])), null, 2));
      continue;
    }
    console.log(`${b.name}/${sd}: ${schluessel.size} Texte, ${fehlend.length} fehlen, ${ueberzaehlig.length} überzählig`);
    for (const k of fehlend) console.log(`  fehlt: ${JSON.stringify(k)}  (${schluessel.get(k)})`);
    for (const k of ueberzaehlig) console.log(`  überzählig: ${JSON.stringify(k)}`);
    // Platzhalter müssen in der Übersetzung erhalten bleiben
    for (const [k, v] of Object.entries(woerterbuch).filter(([k]) => !k.startsWith("@"))) {
      const soll = [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
      const ist = [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
      // Mehrzahl: jede Form darf {n} weglassen (z. B. "one item"), daher nur Mengen vergleichen
      if (soll && new Set(soll.split(",")).size !== new Set(ist.split(",")).size) {
        console.log(`  Platzhalter weichen ab: ${JSON.stringify(k)}`);
        probleme++;
      }
    }
    probleme += fehlend.length;
  }
}
// jede Sprache braucht beide Wörterbücher (Oberfläche und Server)
const web = new Set(sprachenJeBereich.web), server = new Set(sprachenJeBereich.server);
for (const d of [...web].filter((x) => !server.has(x))) (console.log(`server/sprachen/${d} fehlt (gibt es nur für die Oberfläche)`), probleme++);
for (const d of [...server].filter((x) => !web.has(x))) (console.log(`web/src/sprachen/${d} fehlt (gibt es nur für den Server)`), probleme++);
if (!vorlage) process.exitCode = probleme ? 1 : 0;
