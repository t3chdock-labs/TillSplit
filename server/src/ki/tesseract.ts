import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { config } from "../config.js";
import { pdfZuBildern } from "../dateien.js";
import { t } from "../i18n.js";
import type { KiEingabe } from "./index.js";

const ausfuehren = promisify(execFile);

/**
 * Ein Bild mit Tesseract lesen (vorher Graustufen, Kontrast, ausreichende Auflösung).
 * psm 4 = eine Spalte mit unterschiedlich großen Zeilen, psm 6 = ein gleichmäßiger Textblock;
 * schwelle = harte Schwarz-Weiß-Umwandlung (hilft bei grauem, zerknittertem Papier)
 */
export async function bildLesen(bild: Buffer, optionen: { psm?: "4" | "6"; schwelle?: number } = {}): Promise<string> {
  let bearbeitet = sharp(bild, { failOn: "none" })
    .rotate()
    .greyscale()
    .normalize()
    // Kassenbon-Schrift braucht etwa 300 dpi: auf mind. 1600 px Breite bringen
    .resize({ width: 1600, withoutEnlargement: false, fit: "inside" });
  if (optionen.schwelle) bearbeitet = bearbeitet.threshold(optionen.schwelle);
  const vorbereitet = await bearbeitet.png().toBuffer();
  return new Promise((ok, fehler) => {
    // psm 4: eine Textspalte mit unterschiedlich großen Zeilen – passt zu Kassenbons
    const p = spawn("tesseract", ["stdin", "stdout", "-l", config.tesseractSprache, "--psm", optionen.psm ?? "4"], { stdio: ["pipe", "pipe", "pipe"] });
    let text = "";
    let err = "";
    p.stdout.on("data", (d) => (text += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => fehler(new Error(t("Tesseract nicht verfügbar: {meldung}", { meldung: e.message }))));
    p.on("close", (code) => (code === 0 ? ok(text) : fehler(new Error(`Tesseract: ${err.trim().slice(0, 200)}`))));
    p.stdin.end(vorbereitet);
  });
}

/** PDF: zuerst die eingebettete Textebene (Online-Rechnungen), sonst Seiten als Bilder lesen */
async function pdfLesen(pdf: Buffer): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tillsplit-pdf-"));
  try {
    const datei = path.join(dir, "bon.pdf");
    await fs.writeFile(datei, pdf);
    const { stdout } = await ausfuehren("pdftotext", ["-layout", "-l", "6", datei, "-"], { maxBuffer: 10 * 1024 * 1024 });
    if (stdout.replace(/\s/g, "").length > 40) return stdout;
  } catch {
    // keine Textebene oder pdftotext fehlt -> Texterkennung
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  const seiten = await pdfZuBildern(pdf, 300);
  return (await Promise.all(seiten.map((s) => bildLesen(s)))).join("\n\n");
}

/** Text eines Belegs per Tesseract (bzw. PDF-Textebene) */
export async function belegTextLesen(eingabe: KiEingabe): Promise<string> {
  if (eingabe.art === "text") return eingabe.text;
  if (eingabe.art === "pdf") return pdfLesen(eingabe.pdf);
  // Original in voller Auflösung bevorzugen; ohne Original die Abschnitte nacheinander
  if (eingabe.original) return bildLesen(eingabe.original);
  return (await Promise.all(eingabe.bilder.map((s) => bildLesen(s)))).join("\n");
}
