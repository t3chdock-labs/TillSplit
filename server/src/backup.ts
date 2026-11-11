import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { once } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { config } from "./config.js";
import { einstellungLesen, sql } from "./db.js";
import { schluesselRoh } from "./sicherheit.js";

/**
 * Backup: Datenbank (pg_dump), alle Bon-Ablagen und der Schlüssel für gespeicherte Zugangsdaten
 * als tar.gz – verschlüsselt mit BACKUP_PASSWORD (scrypt + AES-256-GCM).
 * Format: "BBBAK1" | Salz (16) | IV (12) | verschlüsselter Inhalt | Tag (16)
 */
const KOPF = Buffer.from("BBBAK1");
const scrypt = promisify(crypto.scrypt) as (pw: string, salz: Buffer, laenge: number, opt: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

/** Zeitplan aus der Oberfläche (Admin-Bereich → Backups); ohne gespeicherte Werte gelten BACKUP_INTERVAL_HOURS, BACKUP_KEEP, BACKUP_INCLUDE_RECEIPTS */
export type BackupPlan = { stunden: number; behalten: number; mitBons: boolean };

export const backupPlan = async (): Promise<BackupPlan> => ({
  stunden: config.backup.stunden,
  behalten: config.backup.behalten,
  mitBons: config.backup.mitBons,
  ...(await einstellungLesen<Partial<BackupPlan>>("backup", {})),
});

// Verzeichnis und Passwort bleiben bewusst außerhalb der Datenbank: das Verzeichnis muss im Container
// eingebunden sein, und ohne Passwort ließe sich ein Backup nach einem Totalausfall nicht entschlüsseln
export const backupEinstellungen = async () => ({
  verzeichnis: config.backup.verzeichnis,
  passwortGesetzt: Boolean(config.backup.passwort),
  ...(await backupPlan()),
});

let laeuft: Promise<string> | null = null;
let letzterFehler: string | null = null;

function ausfuehren(befehl: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((ok, fehler) => {
    const p = spawn(befehl, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", fehler);
    p.on("close", (code) => (code === 0 ? ok() : fehler(new Error(`${befehl}: ${err.trim().slice(0, 300) || `Fehlercode ${code}`}`))));
  });
}

/** Verbindungsdaten für pg_dump aus DATABASE_URL (Passwort über die Umgebung, nicht als Argument) */
function pgUmgebung(): NodeJS.ProcessEnv {
  const u = new URL(config.datenbankUrl);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGDATABASE: u.pathname.replace(/^\//, ""),
    PGPASSWORD: config.datenbankPasswort ?? decodeURIComponent(u.password),
  };
}

async function backupErstellen(): Promise<string> {
  const passwort = config.backup.passwort;
  if (!passwort) throw new Error("BACKUP_PASSWORD ist nicht gesetzt – ohne Passwort werden keine Backups erstellt");
  const plan = await backupPlan();
  await fsp.mkdir(config.backup.verzeichnis, { recursive: true, mode: 0o700 });
  const arbeit = await fsp.mkdtemp(path.join(config.datenVerzeichnis, "backup-"));
  const name = `tillsplit-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.tar.gz.enc`;
  const ziel = path.join(config.backup.verzeichnis, name);
  const teil = `${ziel}.teil`;
  try {
    await ausfuehren("pg_dump", ["--format=custom", "--no-owner", "--file", path.join(arbeit, "datenbank.dump")], pgUmgebung());
    await fsp.writeFile(path.join(arbeit, "schluessel.txt"), schluesselRoh() + "\n", { mode: 0o600 });
    const haushalte = await sql`select id, name, ablage_pfad, verschluesseln from haushalte order by id`;
    await fsp.writeFile(
      path.join(arbeit, "info.json"),
      JSON.stringify({ erstellt: new Date().toISOString(), version: "0.1.3", bonVerzeichnis: config.bonVerzeichnis, ablageWurzeln: config.ablageWurzeln, haushalte }, null, 2),
    );

    // Bon-Ablagen (mit absolutem Pfad; tar entfernt den führenden Schrägstrich)
    const ablagen = plan.mitBons
      ? [config.bonVerzeichnis, ...config.ablageWurzeln].filter((p) => fs.existsSync(p))
      : [];
    const tar = spawn("tar", ["-czf", "-", "-C", arbeit, "datenbank.dump", "schluessel.txt", "info.json", ...ablagen], { stdio: ["ignore", "pipe", "pipe"] });
    let tarFehler = "";
    tar.stderr.on("data", (d) => (tarFehler += d));
    const tarEnde = new Promise<number>((ok) => tar.on("close", ok));

    const salz = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const schluessel = await scrypt(passwort, salz, 32, SCRYPT);
    const chiffre = crypto.createCipheriv("aes-256-gcm", schluessel, iv);
    const aus = fs.createWriteStream(teil, { mode: 0o600 });
    aus.write(Buffer.concat([KOPF, salz, iv]));
    for await (const stueck of tar.stdout.pipe(chiffre)) {
      if (!aus.write(stueck)) await once(aus, "drain");
    }
    // Prüfsumme (GCM-Tag) ans Ende
    aus.end(chiffre.getAuthTag());
    await once(aus, "finish");
    // tar meldet 1, wenn sich Dateien während des Lesens ändern – das ist kein Abbruch
    const code = await tarEnde;
    if (code > 1) throw new Error(`tar: ${tarFehler.trim().slice(0, 300)}`);
    await fsp.rename(teil, ziel);
    await aufraeumen(plan.behalten);
    letzterFehler = null;
    return name;
  } catch (e) {
    letzterFehler = (e as Error).message;
    await fsp.rm(teil, { force: true });
    throw e;
  } finally {
    await fsp.rm(arbeit, { recursive: true, force: true });
  }
}

/** Nur eines gleichzeitig */
export function backupStarten(): Promise<string> {
  laeuft ??= backupErstellen().finally(() => (laeuft = null));
  return laeuft;
}

async function aufraeumen(behalten: number) {
  const alle = await backupListe();
  for (const alt of alle.slice(Math.max(1, behalten))) await fsp.rm(path.join(config.backup.verzeichnis, alt.name), { force: true });
}

export async function backupListe(): Promise<{ name: string; groesse: number; erstellt: string }[]> {
  let namen: string[] = [];
  try {
    namen = (await fsp.readdir(config.backup.verzeichnis)).filter((n) => /^tillsplit-[\d-]+\.tar\.gz\.enc$/.test(n));
  } catch {
    return [];
  }
  const liste = await Promise.all(
    namen.map(async (name) => {
      const s = await fsp.stat(path.join(config.backup.verzeichnis, name));
      return { name, groesse: s.size, erstellt: s.mtime.toISOString() };
    }),
  );
  return liste.sort((a, b) => b.erstellt.localeCompare(a.erstellt));
}

/** Pfad eines Backups – nur Namen aus der Liste, keine Pfadangaben von außen */
export async function backupPfad(name: string): Promise<string | null> {
  return (await backupListe()).some((b) => b.name === name) ? path.join(config.backup.verzeichnis, name) : null;
}

export const backupStatus = () => ({ laeuft: Boolean(laeuft), letzterFehler });

/** Regelmäßig sichern, wenn das letzte Backup älter als der eingestellte Abstand ist (0 = nur von Hand) */
export function backupPlanen(): void {
  if (!config.backup.passwort) return;
  const pruefen = async () => {
    const { stunden } = await backupPlan();
    if (!stunden) return;
    const [neuestes] = await backupListe();
    const alter = neuestes ? (Date.now() - Date.parse(neuestes.erstellt)) / 3_600_000 : Infinity;
    if (alter >= stunden) {
      await backupStarten()
        .then((n) => console.log(`Backup erstellt: ${n}`))
        .catch((e) => console.error("Backup fehlgeschlagen:", (e as Error).message));
    }
  };
  setTimeout(() => void pruefen(), 10 * 60_000);
  setInterval(() => void pruefen(), 60 * 60_000);
}

/** Backup-Datei entschlüsseln (für die Wiederherstellung, siehe werkzeuge/backup-entschluesseln) */
export async function backupEntschluesseln(quelle: string, ziel: NodeJS.WritableStream, passwort: string): Promise<void> {
  const groesse = (await fsp.stat(quelle)).size;
  const fd = await fsp.open(quelle, "r");
  const kopf = Buffer.alloc(34);
  const tag = Buffer.alloc(16);
  await fd.read(kopf, 0, 34, 0);
  await fd.read(tag, 0, 16, groesse - 16);
  await fd.close();
  if (!kopf.subarray(0, 6).equals(KOPF)) throw new Error("Keine TillSplit-Backup-Datei");
  const schluessel = await scrypt(passwort, kopf.subarray(6, 22), 32, SCRYPT);
  const d = crypto.createDecipheriv("aes-256-gcm", schluessel, kopf.subarray(22, 34));
  d.setAuthTag(tag);
  await pipeline(fs.createReadStream(quelle, { start: 34, end: groesse - 17 }), d, ziel);
}
