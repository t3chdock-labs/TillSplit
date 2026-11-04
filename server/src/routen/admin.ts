import fs from "node:fs";
import fsp from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { actualTrennen } from "../actual.js";
import { backupEinstellungen, backupListe, backupPfad, backupStarten, backupStatus } from "../backup.js";
import { httpFehler, nurAdmin, protokollieren, type Rechte } from "../auth.js";
import { config } from "../config.js";
import { sql } from "../db.js";
import { datumFormat, SPRACHEN, sprache, t, type Sprache } from "../i18n.js";
import { ablageCacheLeeren, ablagePruefen } from "../dateien.js";
import { passwortHashen, passwortSchwach, verschluesseln } from "../sicherheit.js";
import { standardGruppenAnlegen } from "../standardGruppen.js";

const idVon = (wert: string) => {
  const id = Number(wert);
  if (!Number.isInteger(id) || id <= 0) throw httpFehler(400, "Ungültige ID");
  return id;
};
const text = (wert: unknown, max = 200) => (typeof wert === "string" ? wert.trim().slice(0, max) : "");

/** Actual-Adresse: nur http(s), damit der Server nicht auf beliebige Protokolle zugreift */
function actualUrlPruefen(url: string): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw httpFehler(400, "Ungültige Actual-Adresse");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw httpFehler(400, "Actual-Adresse muss mit http:// oder https:// beginnen");
  return u.origin + u.pathname.replace(/\/$/, "");
}

export async function adminRouten(app: FastifyInstance) {
  // ---------- Benutzer ----------
  app.get("/api/admin/benutzer", async (req) => {
    nurAdmin(req);
    return sql`
      select b.id, b.email, b.name, b.ist_admin, b.aktiv, b.passwort_aendern, b.totp_aktiv,
             (select count(*) from passkeys p where p.benutzer_id = b.id)::int as passkeys,
             b.gesperrt_bis > now() as gesperrt,
             to_char(b.letzte_anmeldung at time zone 'Europe/Berlin', ${datumFormat(true)}) as letzte_anmeldung,
             coalesce((select json_agg(json_build_object('haushalt_id', m.haushalt_id, 'haushalt', h.name,
                        'bons_sehen', m.bons_sehen, 'bons_bearbeiten', m.bons_bearbeiten,
                        'finanzen_sehen', m.finanzen_sehen, 'verwalten', m.verwalten) order by h.name)
                         from mitglieder m join haushalte h on h.id = m.haushalt_id where m.benutzer_id = b.id), '[]') as mitgliedschaften
        from benutzer b order by b.name`;
  });

  app.post<{ Body: { email: string; name: string; passwort: string; admin?: boolean } }>("/api/admin/benutzer", async (req, antwort) => {
    nurAdmin(req);
    const email = text(req.body?.email, 200);
    const name = text(req.body?.name, 100);
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || !name) return antwort.code(400).send({ fehler: "Name und gültige E-Mail angeben" });
    const schwach = passwortSchwach(String(req.body?.passwort ?? ""));
    if (schwach) return antwort.code(400).send({ fehler: schwach });
    const [vorhanden] = await sql`select 1 from benutzer where lower(email) = lower(${email})`;
    if (vorhanden) return antwort.code(409).send({ fehler: "Diese E-Mail ist schon vergeben" });
    // Startpasswort muss bei der ersten Anmeldung geändert werden
    const [b] = await sql<{ id: number }[]>`
      insert into benutzer (email, name, passwort_hash, ist_admin, passwort_aendern)
      values (${email}, ${name}, ${await passwortHashen(req.body.passwort)}, ${Boolean(req.body.admin)}, true) returning id`;
    await protokollieren(req, "benutzer_angelegt", { email, admin: Boolean(req.body.admin) });
    return { id: b.id };
  });

  app.put<{
    Params: { id: string };
    Body: { name?: string; email?: string; admin?: boolean; aktiv?: boolean; passwort?: string; zweiFaktorZuruecksetzen?: boolean; entsperren?: boolean };
  }>("/api/admin/benutzer/:id", async (req, antwort) => {
    const ich = nurAdmin(req);
    const id = idVon(req.params.id);
    const b = req.body ?? {};
    if (id === ich.id && (b.admin === false || b.aktiv === false)) {
      return antwort.code(400).send({ fehler: "Du kannst dir die Admin-Rechte nicht selbst entziehen oder dich deaktivieren" });
    }
    if (b.name !== undefined) await sql`update benutzer set name = ${text(b.name, 100) || "Ohne Namen"} where id = ${id}`;
    if (b.email !== undefined) {
      const email = text(b.email, 200);
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return antwort.code(400).send({ fehler: "Ungültige E-Mail" });
      const [vergeben] = await sql`select 1 from benutzer where lower(email) = lower(${email}) and id <> ${id}`;
      if (vergeben) return antwort.code(409).send({ fehler: "Diese E-Mail ist schon vergeben" });
      await sql`update benutzer set email = ${email} where id = ${id}`;
    }
    if (b.admin !== undefined) await sql`update benutzer set ist_admin = ${Boolean(b.admin)} where id = ${id}`;
    if (b.aktiv !== undefined) {
      await sql`update benutzer set aktiv = ${Boolean(b.aktiv)} where id = ${id}`;
      if (!b.aktiv) await sql`delete from sitzungen where benutzer_id = ${id}`;
    }
    if (b.passwort) {
      const schwach = passwortSchwach(b.passwort);
      if (schwach) return antwort.code(400).send({ fehler: schwach });
      await sql`update benutzer set passwort_hash = ${await passwortHashen(b.passwort)}, passwort_aendern = true, fehlversuche = 0, gesperrt_bis = null where id = ${id}`;
      await sql`delete from sitzungen where benutzer_id = ${id}`;
    }
    if (b.zweiFaktorZuruecksetzen) {
      await sql`update benutzer set totp_aktiv = false, totp_geheimnis_enc = null where id = ${id}`;
      await sql`delete from passkeys where benutzer_id = ${id}`;
      await sql`delete from wiederherstellungscodes where benutzer_id = ${id}`;
      await sql`delete from sitzungen where benutzer_id = ${id}`;
    }
    if (b.entsperren) await sql`update benutzer set fehlversuche = 0, gesperrt_bis = null where id = ${id}`;
    await protokollieren(req, "benutzer_geaendert", {
      id, felder: Object.keys(b).filter((k) => k !== "passwort"), passwortGesetzt: Boolean(b.passwort),
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/benutzer/:id", async (req, antwort) => {
    const ich = nurAdmin(req);
    const id = idVon(req.params.id);
    if (id === ich.id) return antwort.code(400).send({ fehler: "Du kannst dich nicht selbst löschen" });
    await sql`delete from benutzer where id = ${id}`;
    await protokollieren(req, "benutzer_geloescht", { id });
    return { ok: true };
  });

  // ---------- Haushalte ----------
  app.get("/api/admin/haushalte", async (req) => {
    nurAdmin(req);
    const haushalte = await sql`
      select h.id, h.name, h.ablage_pfad, h.actual_url, h.actual_sync_id,
             h.actual_passwort_enc is not null as actual_passwort_gesetzt, h.actual_e2e_enc is not null as actual_e2e_gesetzt,
             (select count(*) from bons b where b.haushalt_id = h.id)::int as bons,
             coalesce((select json_agg(json_build_object('benutzer_id', m.benutzer_id, 'name', u.name, 'email', u.email,
                        'bons_sehen', m.bons_sehen, 'bons_bearbeiten', m.bons_bearbeiten,
                        'finanzen_sehen', m.finanzen_sehen, 'verwalten', m.verwalten) order by u.name)
                         from mitglieder m join benutzer u on u.id = m.benutzer_id where m.haushalt_id = h.id), '[]') as mitglieder
        from haushalte h order by h.name`;
    return {
      haushalte,
      bonVerzeichnis: config.bonVerzeichnis,
      ablageWurzeln: config.ablageWurzeln,
      // Haushalt 1 kann den Actual-Zugang aus den Umgebungsvariablen nutzen
      umgebungActual: Boolean(config.actual.serverUrl && config.actual.passwort && config.actual.syncId),
    };
  });

  app.post<{ Body: { name: string; ablage_pfad?: string; sprache?: string } }>("/api/admin/haushalte", async (req, antwort) => {
    nurAdmin(req);
    const name = text(req.body?.name, 100);
    if (!name) return antwort.code(400).send({ fehler: "Name fehlt" });
    let pfad: string;
    try {
      pfad = ablagePruefen(text(req.body?.ablage_pfad, 500));
    } catch (e) {
      return antwort.code(400).send({ fehler: (e as Error).message });
    }
    const id = await sql.begin(async (tx) => {
      const [h] = await tx<{ id: number }[]>`insert into haushalte (name, ablage_pfad) values (${name}, ${pfad}) returning id`;
      // ohne Angabe eigener Unterordner, damit sich Haushalte nicht mischen
      if (!pfad) await tx`update haushalte set ablage_pfad = ${`haushalt-${h.id}`} where id = ${h.id}`;
      // Startgruppen in der Sprache dessen, der den Haushalt anlegt
      await standardGruppenAnlegen(tx, h.id, SPRACHEN.includes(req.body?.sprache as Sprache) ? (req.body!.sprache as Sprache) : sprache());
      return h.id;
    });
    await protokollieren(req, "haushalt_angelegt", { id, name });
    return { id };
  });

  app.put<{
    Params: { id: string };
    Body: { name?: string; ablage_pfad?: string; actual_url?: string; actual_sync_id?: string; actual_passwort?: string; actual_e2e?: string };
  }>("/api/admin/haushalte/:id", async (req, antwort) => {
    nurAdmin(req);
    const id = idVon(req.params.id);
    const b = req.body ?? {};
    if (b.name !== undefined) await sql`update haushalte set name = ${text(b.name, 100) || t("Haushalt")} where id = ${id}`;
    if (b.ablage_pfad !== undefined) {
      try {
        await sql`update haushalte set ablage_pfad = ${ablagePruefen(text(b.ablage_pfad, 500))} where id = ${id}`;
      } catch (e) {
        return antwort.code(400).send({ fehler: (e as Error).message });
      }
      ablageCacheLeeren();
    }
    if (b.actual_url !== undefined) await sql`update haushalte set actual_url = ${actualUrlPruefen(text(b.actual_url, 300))} where id = ${id}`;
    if (b.actual_sync_id !== undefined) await sql`update haushalte set actual_sync_id = ${text(b.actual_sync_id, 100) || null} where id = ${id}`;
    // Passwörter nur setzen, wenn angegeben; "-" löscht sie
    if (b.actual_passwort) {
      await sql`update haushalte set actual_passwort_enc = ${b.actual_passwort === "-" ? null : verschluesseln(b.actual_passwort)} where id = ${id}`;
    }
    if (b.actual_e2e) await sql`update haushalte set actual_e2e_enc = ${b.actual_e2e === "-" ? null : verschluesseln(b.actual_e2e)} where id = ${id}`;
    actualTrennen();
    await protokollieren(req, "haushalt_geaendert", { id, felder: Object.keys(b).filter((k) => !k.includes("passwort") && k !== "actual_e2e") });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/haushalte/:id", async (req, antwort) => {
    nurAdmin(req);
    const id = idVon(req.params.id);
    const [{ bons, anzahl }] = await sql<{ bons: number; anzahl: number }[]>`
      select (select count(*) from bons where haushalt_id = ${id})::int as bons, (select count(*) from haushalte)::int as anzahl`;
    if (bons > 0) return antwort.code(409).send({ fehler: t("Der Haushalt hat noch {n} Bons – bitte erst löschen oder behalten", { n: bons }) });
    if (anzahl <= 1) return antwort.code(400).send({ fehler: "Der letzte Haushalt kann nicht gelöscht werden" });
    await sql`delete from haushalte where id = ${id}`;
    await protokollieren(req, "haushalt_geloescht", { id });
    return { ok: true };
  });

  // Mitglied hinzufügen oder Rechte ändern
  app.put<{ Params: { id: string; benutzerId: string }; Body: Partial<Rechte> }>("/api/admin/haushalte/:id/mitglieder/:benutzerId", async (req) => {
    nurAdmin(req);
    const id = idVon(req.params.id);
    const benutzerId = idVon(req.params.benutzerId);
    const r = req.body ?? {};
    const recht = (k: keyof Rechte, standard: boolean) => (r[k] === undefined ? standard : Boolean(r[k]));
    await sql`
      insert into mitglieder (haushalt_id, benutzer_id, bons_sehen, bons_bearbeiten, finanzen_sehen, verwalten)
      values (${id}, ${benutzerId}, ${recht("bons_sehen", true)}, ${recht("bons_bearbeiten", true)}, ${recht("finanzen_sehen", false)}, ${recht("verwalten", false)})
      on conflict (haushalt_id, benutzer_id) do update set
        bons_sehen = ${recht("bons_sehen", true)}, bons_bearbeiten = ${recht("bons_bearbeiten", true)},
        finanzen_sehen = ${recht("finanzen_sehen", false)}, verwalten = ${recht("verwalten", false)}`;
    await protokollieren(req, "rechte_geaendert", { haushalt: id, benutzer: benutzerId, rechte: r });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; benutzerId: string } }>("/api/admin/haushalte/:id/mitglieder/:benutzerId", async (req) => {
    nurAdmin(req);
    const id = idVon(req.params.id);
    const benutzerId = idVon(req.params.benutzerId);
    await sql`delete from mitglieder where haushalt_id = ${id} and benutzer_id = ${benutzerId}`;
    await sql`update sitzungen set haushalt_id = null where benutzer_id = ${benutzerId} and haushalt_id = ${id}`;
    await protokollieren(req, "mitglied_entfernt", { haushalt: id, benutzer: benutzerId });
    return { ok: true };
  });

  // ---------- Backups ----------
  app.get("/api/admin/backups", async (req) => {
    nurAdmin(req);
    return { einstellungen: backupEinstellungen(), status: backupStatus(), liste: await backupListe() };
  });

  app.post("/api/admin/backups", async (req) => {
    nurAdmin(req);
    await protokollieren(req, "backup_gestartet");
    // im Hintergrund – bei vielen Bons dauert das
    void backupStarten().catch(() => {});
    return { ok: true };
  });

  app.get<{ Params: { name: string } }>("/api/admin/backups/:name", async (req, antwort) => {
    nurAdmin(req);
    const pfad = await backupPfad(req.params.name);
    if (!pfad) throw httpFehler(404, "Backup nicht gefunden");
    await protokollieren(req, "backup_heruntergeladen", { name: req.params.name });
    antwort.header("content-type", "application/octet-stream");
    antwort.header("content-disposition", `attachment; filename="${req.params.name}"`);
    return antwort.send(fs.createReadStream(pfad));
  });

  app.delete<{ Params: { name: string } }>("/api/admin/backups/:name", async (req) => {
    nurAdmin(req);
    const pfad = await backupPfad(req.params.name);
    if (!pfad) throw httpFehler(404, "Backup nicht gefunden");
    await fsp.rm(pfad, { force: true });
    await protokollieren(req, "backup_geloescht", { name: req.params.name });
    return { ok: true };
  });

  // ---------- Protokoll ----------
  app.get<{ Querystring: { seite?: string } }>("/api/admin/protokoll", async (req) => {
    nurAdmin(req);
    const seite = Math.max(1, Math.min(1000, Number(req.query.seite) || 1));
    return sql`
      select p.id, to_char(p.am at time zone 'Europe/Berlin', ${datumFormat(true, true)}) as am, p.aktion, p.details, p.ip,
             u.name as benutzer, u.email, h.name as haushalt
        from protokoll p left join benutzer u on u.id = p.benutzer_id left join haushalte h on h.id = p.haushalt_id
       order by p.am desc limit 100 offset ${(seite - 1) * 100}`;
  });
}
