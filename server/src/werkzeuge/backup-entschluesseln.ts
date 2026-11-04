// Backup entschlüsseln: node dist/werkzeuge/backup-entschluesseln.js <datei.tar.gz.enc> > backup.tar.gz
// Das Passwort kommt aus BACKUP_PASSWORD (bzw. BACKUP_PASSWORD_FILE).
import fs from "node:fs";
import { backupEntschluesseln } from "../backup.js";

const datei = process.argv[2];
let passwort = process.env.BACKUP_PASSWORD;
if (!passwort && process.env.BACKUP_PASSWORD_FILE) passwort = fs.readFileSync(process.env.BACKUP_PASSWORD_FILE, "utf8").trim();
if (!datei || !passwort) {
  console.error("Aufruf: BACKUP_PASSWORD=… node dist/werkzeuge/backup-entschluesseln.js <datei.tar.gz.enc> > backup.tar.gz");
  process.exit(2);
}
if (process.stdout.isTTY) {
  console.error("Bitte die Ausgabe in eine Datei umleiten: … > backup.tar.gz");
  process.exit(2);
}
try {
  await backupEntschluesseln(datei, process.stdout, passwort);
} catch (e) {
  console.error("Entschlüsseln fehlgeschlagen (falsches Passwort oder beschädigte Datei):", (e as Error).message);
  process.exit(1);
}
process.exit(0);
