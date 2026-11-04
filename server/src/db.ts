import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "./config.js";

export const sql = postgres(config.datenbankUrl, {
  max: Number(process.env.DB_MAX_CONNECTIONS ?? 10),
  ...(config.datenbankPasswort ? { password: config.datenbankPasswort } : {}),
  // numeric als Zahl statt String zurückgeben (Mengen)
  types: {
    numeric: {
      to: 1700,
      from: [1700],
      serialize: (x: number) => String(x),
      parse: (x: string) => Number(x),
    },
  },
  onnotice: () => {},
});

const migrationsVerzeichnis = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

export async function migrieren(): Promise<void> {
  // beim gemeinsamen Start (Docker) kann die Datenbank noch hochfahren: bis zu 60 Sekunden warten
  for (let versuch = 1; ; versuch++) {
    try {
      await sql`select 1`;
      break;
    } catch (fehler) {
      if (versuch >= 30) throw fehler;
      console.log(`Datenbank noch nicht erreichbar (${(fehler as Error).message}) – neuer Versuch in 2 s`);
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }
  await sql`create table if not exists schema_version (datei text primary key, am timestamptz not null default now())`;
  const erledigt = new Set((await sql<{ datei: string }[]>`select datei from schema_version`).map((r) => r.datei));
  const dateien = (await fs.readdir(migrationsVerzeichnis)).filter((d) => d.endsWith(".sql")).sort();
  for (const datei of dateien) {
    if (erledigt.has(datei)) continue;
    // BOM am Dateianfang (manche Editoren unter Windows) würde Postgres als Syntaxfehler melden
    const inhalt = (await fs.readFile(path.join(migrationsVerzeichnis, datei), "utf8")).replace(/^\uFEFF/, "");
    await sql.begin(async (tx) => {
      await tx.unsafe(inhalt);
      await tx`insert into schema_version (datei) values (${datei})`;
    });
    console.log(`Migration ${datei} ausgeführt`);
  }
}

/** Einstellung lesen; haushaltId null = systemweit (z. B. KI), sonst je Haushalt */
export async function einstellungLesen<T>(schluessel: string, standard: T, haushaltId: number | null = null): Promise<T> {
  const [zeile] = await sql<{ wert: T }[]>`
    select wert from einstellungen where schluessel = ${schluessel} and coalesce(haushalt_id, 0) = ${haushaltId ?? 0}`;
  return zeile ? zeile.wert : standard;
}

export async function einstellungSchreiben(schluessel: string, wert: unknown, haushaltId: number | null = null): Promise<void> {
  await sql`
    insert into einstellungen (haushalt_id, schluessel, wert) values (${haushaltId}, ${schluessel}, ${sql.json(wert as never)})
    on conflict (coalesce(haushalt_id, 0), schluessel) do update set wert = excluded.wert`;
}
