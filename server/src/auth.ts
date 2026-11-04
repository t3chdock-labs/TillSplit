import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import QRCode from "qrcode";
import { config } from "./config.js";
import { einstellungSchreiben, sql } from "./db.js";
import { datumFormat, SPRACHEN, standardSpracheSetzen, t, type Sprache } from "./i18n.js";
import { standardGruppenUebersetzen } from "./standardGruppen.js";
import {
  codeNormalisieren,
  entschluesseln,
  passwortHashen,
  passwortPruefen,
  passwortSchwach,
  sha256,
  totpGeheimnis,
  totpPruefen,
  totpUri,
  verschluesseln,
  wiederherstellungscodes,
  zufall,
} from "./sicherheit.js";

export type Rechte = { bons_sehen: boolean; bons_bearbeiten: boolean; finanzen_sehen: boolean; verwalten: boolean };
export const ALLE_RECHTE: Rechte = { bons_sehen: true, bons_bearbeiten: true, finanzen_sehen: true, verwalten: true };

export type Nutzer = {
  id: number;
  email: string;
  name: string;
  admin: boolean;
  passwortAendern: boolean;
  zweiFaktor: boolean;
  haushaltId: number | null;
  rechte: Rechte | null;
  sitzung: string; // token_hash
};

declare module "fastify" {
  interface FastifyRequest {
    nutzer?: Nutzer;
  }
}

const COOKIE = "bb_sitzung";
const PASSKEY_COOKIE = "bb_passkey";
const MAX_FEHLVERSUCHE = 8;
const SPERRE_MINUTEN = 15;

export function httpFehler(code: number, text: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(text), { statusCode: code, extra });
}

/**
 * Zugriff auf den aktuellen Haushalt prüfen und dessen ID liefern.
 * Ohne Recht genügt die Mitgliedschaft (z. B. Bons hochladen).
 */
export function zugriff(req: FastifyRequest, recht?: keyof Rechte): number {
  const n = req.nutzer;
  if (!n) throw httpFehler(401, "Nicht angemeldet");
  if (!n.haushaltId || !n.rechte) throw httpFehler(403, "Kein Haushalt ausgewählt");
  if (recht && !n.rechte[recht]) throw httpFehler(403, "Dafür fehlt dir die Berechtigung");
  return n.haushaltId;
}

export function nurAdmin(req: FastifyRequest): Nutzer {
  if (!req.nutzer?.admin) throw httpFehler(403, "Nur für Administratoren");
  return req.nutzer;
}

const ip = (req: FastifyRequest) => req.ip;

export async function protokollieren(req: FastifyRequest | null, aktion: string, details: Record<string, unknown> = {}, benutzerId?: number | null) {
  await sql`
    insert into protokoll (benutzer_id, haushalt_id, aktion, details, ip)
    values (${benutzerId ?? req?.nutzer?.id ?? null}, ${req?.nutzer?.haushaltId ?? null}, ${aktion}, ${sql.json(details as never)}, ${req ? ip(req) : null})`;
}

// --- Passkeys: Relying Party aus PUBLIC_URL oder der aufgerufenen Adresse ---
function rp(req: FastifyRequest) {
  const herkunft = config.oeffentlicheUrl ?? `${req.protocol}://${req.host}`;
  const url = new URL(herkunft);
  return { origin: url.origin, rpID: url.hostname };
}

const istHttps = (req: FastifyRequest) => req.protocol === "https" || (config.oeffentlicheUrl ?? "").startsWith("https:");

/** Gültigkeit einer vollwertigen Sitzung: gemerkt SITZUNG_TAGE, sonst 12 Stunden (und Cookie nur bis zum Schließen des Browsers) */
const sitzungsDauer = (merken: boolean) => (merken ? `${config.sitzungTage} days` : "12 hours");

async function sitzungAnlegen(req: FastifyRequest, antwort: FastifyReply, benutzerId: number, voll: boolean, haushaltId?: number | null, merken = true) {
  const token = zufall(32);
  const dauer = voll ? sitzungsDauer(merken) : "10 minutes";
  const haushalt =
    haushaltId ??
    (await sql<{ haushalt_id: number }[]>`select haushalt_id from mitglieder where benutzer_id = ${benutzerId} order by haushalt_id limit 1`)[0]?.haushalt_id ??
    null;
  await sql`
    insert into sitzungen (token_hash, benutzer_id, haushalt_id, zweiter_faktor, merken, laeuft_ab, ip, geraet)
    values (${sha256(token)}, ${benutzerId}, ${haushalt}, ${voll}, ${merken}, now() + ${dauer}::interval, ${ip(req)}, ${(req.headers["user-agent"] ?? "").slice(0, 200)})`;
  antwort.setCookie(COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: istHttps(req),
    // ohne „Angemeldet bleiben“ ein Sitzungs-Cookie: weg, sobald der Browser geschlossen wird
    ...(voll && !merken ? {} : { maxAge: voll ? config.sitzungTage * 86400 : 600 }),
  });
  if (voll) await sql`update benutzer set letzte_anmeldung = now(), fehlversuche = 0, gesperrt_bis = null where id = ${benutzerId}`;
}

/** Nach dem zweiten Faktor: Teil-Sitzung durch eine neue, vollwertige ersetzen (neuer Token, „merken“ bleibt) */
async function sitzungAufwerten(req: FastifyRequest, antwort: FastifyReply, tokenHash: string, benutzerId: number) {
  const [alt] = await sql<{ merken: boolean }[]>`delete from sitzungen where token_hash = ${tokenHash} returning merken`;
  await sitzungAnlegen(req, antwort, benutzerId, true, undefined, alt?.merken ?? true);
}

async function sitzungLesen(req: FastifyRequest) {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const hash = sha256(token);
  const [s] = await sql<
    { token_hash: string; benutzer_id: number; haushalt_id: number | null; zweiter_faktor: boolean; merken: boolean; challenge: string | null; zuletzt_am: Date;
      email: string; name: string; ist_admin: boolean; passwort_aendern: boolean; totp_aktiv: boolean; passkeys: number; sprache: string | null; darstellung: unknown }[]
  >`
    select s.token_hash, s.benutzer_id, s.haushalt_id, s.zweiter_faktor, s.merken, s.challenge, s.zuletzt_am,
           b.email, b.name, b.ist_admin, b.passwort_aendern, b.totp_aktiv, b.sprache, b.darstellung,
           (select count(*) from passkeys p where p.benutzer_id = b.id)::int as passkeys
      from sitzungen s join benutzer b on b.id = s.benutzer_id
     where s.token_hash = ${hash} and s.laeuft_ab > now() and b.aktiv`;
  return s ?? null;
}

async function rechteLesen(benutzerId: number, haushaltId: number | null, admin: boolean): Promise<Rechte | null> {
  if (!haushaltId) return null;
  const [m] = await sql<Rechte[]>`
    select bons_sehen, bons_bearbeiten, finanzen_sehen, verwalten from mitglieder
     where benutzer_id = ${benutzerId} and haushalt_id = ${haushaltId}`;
  if (m) return admin ? ALLE_RECHTE : m;
  // Admins dürfen jeden Haushalt verwalten, auch ohne Mitgliedschaft
  if (admin && (await sql`select 1 from haushalte where id = ${haushaltId}`).length) return ALLE_RECHTE;
  return null;
}

// Routen, die ohne (vollständige) Anmeldung erreichbar sind
const OFFEN = new Set([
  "/api/gesundheit",
  "/api/info",
  "/api/auth/status",
  "/api/auth/anmelden",
  "/api/auth/einrichten",
  "/api/auth/passkey/optionen",
  "/api/auth/passkey/anmelden",
]);
// mit Passwort, aber vor dem zweiten Faktor
const TEILWEISE = new Set([
  "/api/auth/zweiter-faktor/totp",
  "/api/auth/zweiter-faktor/passkey/optionen",
  "/api/auth/zweiter-faktor/passkey",
  "/api/auth/abmelden",
]);

let einrichtungsCode: string | null = null;

/** Beim Start: ersten Admin aus ADMIN_EMAIL/ADMIN_PASSWORD anlegen oder einen Einrichtungscode ausgeben */
export async function ersteinrichtung(): Promise<void> {
  const [{ anzahl }] = await sql<{ anzahl: number }[]>`select count(*)::int as anzahl from benutzer`;
  if (anzahl > 0) return;
  if (config.adminEmail && config.adminPasswort) {
    const [b] = await sql<{ id: number }[]>`
      insert into benutzer (email, name, passwort_hash, ist_admin)
      values (${config.adminEmail}, 'Administrator', ${await passwortHashen(config.adminPasswort)}, true) returning id`;
    await sql`insert into mitglieder (haushalt_id, benutzer_id, bons_sehen, bons_bearbeiten, finanzen_sehen, verwalten) values (1, ${b.id}, true, true, true, true)`;
    console.log(`Erster Administrator ${config.adminEmail} angelegt.`);
    return;
  }
  einrichtungsCode = zufall(9);
  console.log("=".repeat(64));
  console.log(`TillSplit-Ersteinrichtung: Code für den ersten Administrator: ${einrichtungsCode}`);
  console.log(`TillSplit setup: code for the first administrator: ${einrichtungsCode}`);
  console.log("=".repeat(64));
}

export async function authRouten(app: FastifyInstance) {
  // --- Prüfung jeder API-Anfrage ---
  app.addHook("onRequest", async (req, antwort) => {
    // nach der tatsächlich getroffenen Route entscheiden (nicht nach dem rohen Adresstext),
    // damit Schreibweisen wie //api/… die Prüfung nicht umgehen
    const roh = req.url.split("?")[0].replace(/\/{2,}/g, "/");
    const pfad = req.routeOptions?.url ?? roh;
    if (!pfad.startsWith("/api/") && !roh.startsWith("/api/")) return;

    // Schutz gegen Cross-Site-Anfragen: verändernde Anfragen nur von der eigenen Seite
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const herkunft = req.headers.origin;
      if (herkunft) {
        let host = "";
        try {
          host = new URL(herkunft).host;
        } catch {
          // ungültige Angabe -> unten abgelehnt
        }
        const erlaubt = new Set([req.host, config.oeffentlicheUrl ? new URL(config.oeffentlicheUrl).host : ""]);
        if (!erlaubt.has(host)) return antwort.code(403).send({ fehler: "Anfrage von fremder Seite abgelehnt" });
      }
    }

    if (OFFEN.has(pfad)) return;
    const s = await sitzungLesen(req);
    if (!s) {
      if (pfad === "/api/teilen") return antwort.redirect("/anmelden", 303);
      return antwort.code(401).send({ fehler: "Nicht angemeldet" });
    }
    if (!s.zweiter_faktor) {
      if (TEILWEISE.has(pfad)) {
        req.nutzer = { id: s.benutzer_id, email: s.email, name: s.name, admin: false, passwortAendern: s.passwort_aendern, zweiFaktor: false, haushaltId: null, rechte: null, sitzung: s.token_hash };
        return;
      }
      return antwort.code(401).send({ fehler: "Zweiter Faktor fehlt" });
    }

    // Sitzung verlängern (höchstens alle 5 Minuten schreiben)
    if (Date.now() - s.zuletzt_am.getTime() > 5 * 60_000) {
      await sql`update sitzungen set zuletzt_am = now(), laeuft_ab = now() + ${sitzungsDauer(s.merken)}::interval where token_hash = ${s.token_hash}`;
      // gemerkte Sitzung: auch das Cookie verlängern, damit aktive Geräte angemeldet bleiben
      if (s.merken) {
        const token = req.cookies[COOKIE];
        if (token) antwort.setCookie(COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", secure: istHttps(req), maxAge: config.sitzungTage * 86400 });
      }
    }
    const zweiFaktor = s.totp_aktiv || s.passkeys > 0;
    req.nutzer = {
      id: s.benutzer_id,
      email: s.email,
      name: s.name,
      admin: s.ist_admin,
      passwortAendern: s.passwort_aendern,
      zweiFaktor,
      haushaltId: s.haushalt_id,
      rechte: await rechteLesen(s.benutzer_id, s.haushalt_id, s.ist_admin),
      sitzung: s.token_hash,
    };

    // Pflichtschritte: neues Passwort setzen bzw. zweiten Faktor einrichten
    const kontoPfad = pfad.startsWith("/api/auth/") || pfad.startsWith("/api/konto");
    if (s.passwort_aendern && !kontoPfad) return antwort.code(403).send({ fehler: "Bitte zuerst ein eigenes Passwort festlegen", passwortAendern: true });
    if (config.zweiFaktorPflicht && !zweiFaktor && !kontoPfad) {
      return antwort.code(403).send({ fehler: "Bitte zuerst die Zwei-Faktor-Anmeldung einrichten", zweiFaktorEinrichten: true });
    }
  });

  // Anmelde-Routen eng begrenzen (je IP)
  const begrenzt = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.get("/api/auth/status", async (req) => {
    const [{ anzahl }] = await sql<{ anzahl: number }[]>`select count(*)::int as anzahl from benutzer`;
    if (anzahl === 0) return { angemeldet: false, einrichtung: true };
    const s = await sitzungLesen(req);
    if (!s) return { angemeldet: false };
    if (!s.zweiter_faktor) return { angemeldet: false, zweiterFaktor: { totp: s.totp_aktiv, passkey: s.passkeys > 0 } };
    const haushalte = s.ist_admin
      ? await sql`select h.id, h.name from haushalte h order by h.name`
      : await sql`select h.id, h.name from haushalte h join mitglieder m on m.haushalt_id = h.id where m.benutzer_id = ${s.benutzer_id} order by h.name`;
    const zweiFaktor = s.totp_aktiv || s.passkeys > 0;
    return {
      angemeldet: true,
      nutzer: { id: s.benutzer_id, email: s.email, name: s.name, admin: s.ist_admin, sprache: s.sprache, darstellung: s.darstellung },
      haushaltId: s.haushalt_id,
      haushalte,
      rechte: await rechteLesen(s.benutzer_id, s.haushalt_id, s.ist_admin),
      passwortAendern: s.passwort_aendern,
      zweiFaktor,
      zweiFaktorEinrichten: config.zweiFaktorPflicht && !zweiFaktor,
    };
  });

  app.post<{ Body: { code: string; email: string; name: string; passwort: string; sprache?: string } }>("/api/auth/einrichten", begrenzt, async (req, antwort) => {
    const [{ anzahl }] = await sql<{ anzahl: number }[]>`select count(*)::int as anzahl from benutzer`;
    if (anzahl > 0 || !einrichtungsCode) return antwort.code(403).send({ fehler: "Die Einrichtung ist bereits abgeschlossen" });
    const { code, email, name, passwort, sprache: gewaehlt } = req.body ?? ({} as never);
    if (code?.trim() !== einrichtungsCode) {
      console.warn(`TILLSPLIT_ANMELDUNG_FEHLGESCHLAGEN ip=${ip(req)} grund=einrichtungscode`);
      return antwort.code(403).send({ fehler: "Einrichtungscode falsch – er steht im Server-Protokoll" });
    }
    if (!email?.includes("@") || !name?.trim()) return antwort.code(400).send({ fehler: "Name und E-Mail angeben" });
    const schwach = passwortSchwach(passwort ?? "");
    if (schwach) return antwort.code(400).send({ fehler: schwach });
    const [b] = await sql<{ id: number }[]>`
      insert into benutzer (email, name, passwort_hash, ist_admin, sprache)
      values (${email.trim()}, ${name.trim()}, ${await passwortHashen(passwort)}, true, ${SPRACHEN.includes(gewaehlt as Sprache) ? gewaehlt! : null}) returning id`;
    // die Sprache des ersten Administrators gilt für die Installation (Artikelnamen, Meldungen im Hintergrund)
    if (SPRACHEN.includes(gewaehlt as Sprache)) {
      await einstellungSchreiben("sprache", gewaehlt);
      standardSpracheSetzen(gewaehlt);
      // Startgruppen des ersten Haushalts in dieser Sprache, solange noch nichts darauf gebucht ist
      await standardGruppenUebersetzen(1, gewaehlt as Sprache);
    }
    await sql`insert into mitglieder (haushalt_id, benutzer_id, bons_sehen, bons_bearbeiten, finanzen_sehen, verwalten) values (1, ${b.id}, true, true, true, true)`;
    einrichtungsCode = null;
    await protokollieren(req, "ersteinrichtung", { email }, b.id);
    await sitzungAnlegen(req, antwort, b.id, true, 1);
    return { ok: true };
  });

  app.post<{ Body: { email: string; passwort: string; merken?: boolean } }>("/api/auth/anmelden", begrenzt, async (req, antwort) => {
    const email = String(req.body?.email ?? "").trim();
    const passwort = String(req.body?.passwort ?? "");
    const merken = req.body?.merken !== false;
    const [b] = await sql<{ id: number; passwort_hash: string | null; aktiv: boolean; gesperrt_bis: Date | null; fehlversuche: number; totp_aktiv: boolean; passkeys: number }[]>`
      select id, passwort_hash, aktiv, gesperrt_bis, fehlversuche, totp_aktiv,
             (select count(*) from passkeys p where p.benutzer_id = benutzer.id)::int as passkeys
        from benutzer where lower(email) = lower(${email})`;
    const richtig = await passwortPruefen(passwort, b?.passwort_hash ?? null);

    if (b?.gesperrt_bis && b.gesperrt_bis > new Date()) {
      console.warn(`TILLSPLIT_ANMELDUNG_FEHLGESCHLAGEN ip=${ip(req)} email=${email} grund=gesperrt`);
      return antwort.code(429).send({ fehler: "Zu viele Fehlversuche – bitte später erneut versuchen" });
    }
    if (!b || !richtig || !b.aktiv) {
      console.warn(`TILLSPLIT_ANMELDUNG_FEHLGESCHLAGEN ip=${ip(req)} email=${email}`);
      if (b) {
        await sql`
          update benutzer set fehlversuche = fehlversuche + 1,
                 gesperrt_bis = case when fehlversuche + 1 >= ${MAX_FEHLVERSUCHE} then now() + ${`${SPERRE_MINUTEN} minutes`}::interval else gesperrt_bis end
           where id = ${b.id}`;
        await protokollieren(req, "anmeldung_fehlgeschlagen", { email }, b.id);
      }
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      return antwort.code(401).send({ fehler: "E-Mail oder Passwort falsch" });
    }

    const zweiterFaktor = b.totp_aktiv || b.passkeys > 0;
    await sitzungAnlegen(req, antwort, b.id, !zweiterFaktor, undefined, merken);
    if (!zweiterFaktor) await protokollieren(req, "anmeldung", { verfahren: "passwort" }, b.id);
    return zweiterFaktor ? { zweiterFaktor: { totp: b.totp_aktiv, passkey: b.passkeys > 0 } } : { ok: true };
  });

  app.post<{ Body: { code: string } }>("/api/auth/zweiter-faktor/totp", begrenzt, async (req, antwort) => {
    const n = req.nutzer!;
    const [b] = await sql<{ totp_geheimnis_enc: string | null; totp_aktiv: boolean; totp_zuletzt: string; gesperrt_bis: Date | null }[]>`
      select totp_geheimnis_enc, totp_aktiv, totp_zuletzt, gesperrt_bis from benutzer where id = ${n.id}`;
    if (b.gesperrt_bis && b.gesperrt_bis > new Date()) return antwort.code(429).send({ fehler: "Zu viele Fehlversuche – bitte später erneut versuchen" });
    const code = String(req.body?.code ?? "");

    let ok = false;
    if (b.totp_aktiv && b.totp_geheimnis_enc) {
      const fenster = totpPruefen(entschluesseln(b.totp_geheimnis_enc)!, code, Number(b.totp_zuletzt));
      if (fenster) {
        await sql`update benutzer set totp_zuletzt = ${fenster} where id = ${n.id}`;
        ok = true;
      }
    }
    // alternativ ein Wiederherstellungscode (je einmal verwendbar)
    if (!ok && codeNormalisieren(code).length >= 10) {
      const treffer = await sql`
        update wiederherstellungscodes set benutzt_am = now()
         where benutzer_id = ${n.id} and benutzt_am is null and code_hash = ${sha256(codeNormalisieren(code))} returning id`;
      if (treffer.length) {
        ok = true;
        await protokollieren(req, "wiederherstellungscode_benutzt", {}, n.id);
      }
    }
    if (!ok) {
      console.warn(`TILLSPLIT_ANMELDUNG_FEHLGESCHLAGEN ip=${ip(req)} email=${n.email} grund=totp`);
      await sql`
        update benutzer set fehlversuche = fehlversuche + 1,
               gesperrt_bis = case when fehlversuche + 1 >= ${MAX_FEHLVERSUCHE} then now() + ${`${SPERRE_MINUTEN} minutes`}::interval else gesperrt_bis end
         where id = ${n.id}`;
      return antwort.code(401).send({ fehler: "Code falsch" });
    }
    await sitzungAufwerten(req, antwort, n.sitzung, n.id);
    await protokollieren(req, "anmeldung", { verfahren: "passwort+totp" }, n.id);
    return { ok: true };
  });

  // Passkey als zweiter Faktor (nach dem Passwort)
  app.post("/api/auth/zweiter-faktor/passkey/optionen", begrenzt, async (req) => {
    const n = req.nutzer!;
    const keys = await sql<{ id: string; transports: string[] | null }[]>`select id, transports from passkeys where benutzer_id = ${n.id}`;
    const optionen = await generateAuthenticationOptions({
      rpID: rp(req).rpID,
      userVerification: "preferred",
      allowCredentials: keys.map((k) => ({ id: k.id, transports: (k.transports ?? undefined) as AuthenticatorTransport[] | undefined })),
    });
    await sql`update sitzungen set challenge = ${optionen.challenge} where token_hash = ${n.sitzung}`;
    return optionen;
  });

  app.post<{ Body: AuthenticationResponseJSON }>("/api/auth/zweiter-faktor/passkey", begrenzt, async (req, antwort) => {
    const n = req.nutzer!;
    const [s] = await sql<{ challenge: string | null }[]>`select challenge from sitzungen where token_hash = ${n.sitzung}`;
    const benutzerId = await passkeyPruefen(req, req.body, s?.challenge ?? null);
    if (benutzerId !== n.id) return antwort.code(401).send({ fehler: "Passkey nicht erkannt" });
    await sitzungAufwerten(req, antwort, n.sitzung, n.id);
    await protokollieren(req, "anmeldung", { verfahren: "passwort+passkey" }, n.id);
    return { ok: true };
  });

  // Anmeldung nur mit Passkey (ohne Passwort)
  app.post("/api/auth/passkey/optionen", begrenzt, async (req, antwort) => {
    const optionen = await generateAuthenticationOptions({ rpID: rp(req).rpID, userVerification: "required" });
    const id = zufall(16);
    await sql`delete from passkey_anfragen where laeuft_ab < now()`;
    await sql`insert into passkey_anfragen (id, challenge, laeuft_ab) values (${id}, ${optionen.challenge}, now() + interval '5 minutes')`;
    antwort.setCookie(PASSKEY_COOKIE, id, { path: "/api/auth/passkey", httpOnly: true, sameSite: "strict", secure: istHttps(req), maxAge: 300 });
    return optionen;
  });

  app.post<{ Body: AuthenticationResponseJSON; Querystring: { merken?: string } }>("/api/auth/passkey/anmelden", begrenzt, async (req, antwort) => {
    const anfrage = req.cookies[PASSKEY_COOKIE];
    const [a] = anfrage
      ? await sql<{ challenge: string }[]>`delete from passkey_anfragen where id = ${anfrage} and laeuft_ab > now() returning challenge`
      : [];
    const benutzerId = await passkeyPruefen(req, req.body, a?.challenge ?? null, true);
    if (!benutzerId) return antwort.code(401).send({ fehler: "Passkey nicht erkannt" });
    const [b] = await sql<{ aktiv: boolean }[]>`select aktiv from benutzer where id = ${benutzerId}`;
    if (!b?.aktiv) return antwort.code(401).send({ fehler: "Konto deaktiviert" });
    antwort.clearCookie(PASSKEY_COOKIE, { path: "/api/auth/passkey" });
    await sitzungAnlegen(req, antwort, benutzerId, true, undefined, req.query.merken !== "0");
    await protokollieren(req, "anmeldung", { verfahren: "passkey" }, benutzerId);
    return { ok: true };
  });

  app.post("/api/auth/abmelden", async (req, antwort) => {
    const token = req.cookies[COOKIE];
    if (token) await sql`delete from sitzungen where token_hash = ${sha256(token)}`;
    antwort.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post<{ Body: { haushaltId: number } }>("/api/auth/haushalt", async (req, antwort) => {
    const n = req.nutzer!;
    const id = Number(req.body?.haushaltId);
    if (!(await rechteLesen(n.id, id, n.admin))) return antwort.code(403).send({ fehler: "Kein Zugriff auf diesen Haushalt" });
    await sql`update sitzungen set haushalt_id = ${id} where token_hash = ${n.sitzung}`;
    return { ok: true };
  });

  // ================= Mein Konto =================
  app.get("/api/konto", async (req) => {
    const n = req.nutzer!;
    const [b] = await sql`select email, name, totp_aktiv, passwort_aendern from benutzer where id = ${n.id}`;
    const passkeys = await sql`
      select id, name, to_char(erstellt_am at time zone 'Europe/Berlin', ${datumFormat()}) as erstellt, to_char(zuletzt_am at time zone 'Europe/Berlin', ${datumFormat()}) as zuletzt
        from passkeys where benutzer_id = ${n.id} order by erstellt_am`;
    const sitzungen = await sql`
      select left(token_hash, 12) as id, ip, geraet, to_char(erstellt_am at time zone 'Europe/Berlin', ${datumFormat(true)}) as erstellt,
             to_char(zuletzt_am at time zone 'Europe/Berlin', ${datumFormat(true)}) as zuletzt, token_hash = ${n.sitzung} as diese
        from sitzungen where benutzer_id = ${n.id} and zweiter_faktor and laeuft_ab > now() order by zuletzt_am desc`;
    const [{ codes }] = await sql<{ codes: number }[]>`
      select count(*)::int as codes from wiederherstellungscodes where benutzer_id = ${n.id} and benutzt_am is null`;
    return { ...b, passkeys, sitzungen, offeneCodes: codes, zweiFaktorPflicht: config.zweiFaktorPflicht };
  });

  app.put<{ Body: { sprache: string } }>("/api/konto/sprache", async (req, antwort) => {
    const neu = String(req.body?.sprache ?? "");
    if (!SPRACHEN.includes(neu as Sprache)) return antwort.code(400).send({ fehler: "Unbekannte Sprache" });
    await sql`update benutzer set sprache = ${neu} where id = ${req.nutzer!.id}`;
    return { ok: true };
  });

  // Darstellung: nur bekannte Werte speichern (Vorlage oder #rrggbb)
  app.put<{ Body: { modus: string; akzent: string } }>("/api/konto/darstellung", async (req, antwort) => {
    const modus = String(req.body?.modus ?? "");
    const akzent = String(req.body?.akzent ?? "");
    if (!["system", "hell", "dunkel"].includes(modus) || !/^([a-z]{2,12}|#[0-9a-fA-F]{6})$/.test(akzent)) return antwort.code(400).send({ fehler: "Ungültige Darstellung" });
    await sql`update benutzer set darstellung = ${sql.json({ modus, akzent })} where id = ${req.nutzer!.id}`;
    return { ok: true };
  });

  app.put<{ Body: { name: string } }>("/api/konto/name", async (req, antwort) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return antwort.code(400).send({ fehler: "Name fehlt" });
    await sql`update benutzer set name = ${name} where id = ${req.nutzer!.id}`;
    return { ok: true };
  });

  app.put<{ Body: { alt: string; neu: string } }>("/api/konto/passwort", begrenzt, async (req, antwort) => {
    const n = req.nutzer!;
    const [b] = await sql<{ passwort_hash: string | null }[]>`select passwort_hash from benutzer where id = ${n.id}`;
    if (!(await passwortPruefen(String(req.body?.alt ?? ""), b.passwort_hash))) return antwort.code(400).send({ fehler: "Bisheriges Passwort falsch" });
    const schwach = passwortSchwach(String(req.body?.neu ?? ""));
    if (schwach) return antwort.code(400).send({ fehler: schwach });
    await sql`update benutzer set passwort_hash = ${await passwortHashen(req.body.neu)}, passwort_aendern = false where id = ${n.id}`;
    // alle anderen Sitzungen beenden
    await sql`delete from sitzungen where benutzer_id = ${n.id} and token_hash <> ${n.sitzung}`;
    await protokollieren(req, "passwort_geaendert");
    return { ok: true };
  });

  app.post("/api/konto/totp/start", async (req) => {
    const n = req.nutzer!;
    const geheimnis = totpGeheimnis();
    // erst nach Bestätigung aktiv
    await sql`update benutzer set totp_geheimnis_enc = ${verschluesseln(geheimnis)}, totp_aktiv = false where id = ${n.id} and not totp_aktiv`;
    const [b] = await sql<{ totp_aktiv: boolean }[]>`select totp_aktiv from benutzer where id = ${n.id}`;
    if (b.totp_aktiv) throw httpFehler(400, "TOTP ist bereits eingerichtet");
    const uri = totpUri(geheimnis, n.email);
    return { geheimnis, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  });

  app.post<{ Body: { code: string } }>("/api/konto/totp/bestaetigen", begrenzt, async (req, antwort) => {
    const n = req.nutzer!;
    const [b] = await sql<{ totp_geheimnis_enc: string | null; totp_aktiv: boolean }[]>`select totp_geheimnis_enc, totp_aktiv from benutzer where id = ${n.id}`;
    if (b.totp_aktiv || !b.totp_geheimnis_enc) return antwort.code(400).send({ fehler: "Bitte die Einrichtung neu starten" });
    const fenster = totpPruefen(entschluesseln(b.totp_geheimnis_enc)!, String(req.body?.code ?? ""));
    if (!fenster) return antwort.code(400).send({ fehler: "Code stimmt nicht – Uhrzeit am Handy prüfen" });
    await sql`update benutzer set totp_aktiv = true, totp_zuletzt = ${fenster} where id = ${n.id}`;
    await protokollieren(req, "totp_eingerichtet");
    return { ok: true, codes: await codesErzeugen(n.id) };
  });

  app.post<{ Body: { passwort: string } }>("/api/konto/totp/aus", begrenzt, async (req, antwort) => {
    const n = req.nutzer!;
    if (!(await passwortRichtig(n.id, req.body?.passwort))) return antwort.code(400).send({ fehler: "Passwort falsch" });
    const [{ passkeys }] = await sql<{ passkeys: number }[]>`select count(*)::int as passkeys from passkeys where benutzer_id = ${n.id}`;
    if (config.zweiFaktorPflicht && passkeys === 0) return antwort.code(400).send({ fehler: "Zwei-Faktor ist Pflicht – erst einen Passkey anlegen" });
    await sql`update benutzer set totp_aktiv = false, totp_geheimnis_enc = null where id = ${n.id}`;
    await protokollieren(req, "totp_entfernt");
    return { ok: true };
  });

  app.post<{ Body: { passwort: string } }>("/api/konto/wiederherstellungscodes", begrenzt, async (req, antwort) => {
    const n = req.nutzer!;
    if (!(await passwortRichtig(n.id, req.body?.passwort))) return antwort.code(400).send({ fehler: "Passwort falsch" });
    await protokollieren(req, "wiederherstellungscodes_neu");
    return { codes: await codesErzeugen(n.id) };
  });

  app.post("/api/konto/passkey/optionen", async (req) => {
    const n = req.nutzer!;
    const vorhanden = await sql<{ id: string }[]>`select id from passkeys where benutzer_id = ${n.id}`;
    const optionen = await generateRegistrationOptions({
      rpName: "TillSplit",
      rpID: rp(req).rpID,
      userName: n.email,
      userDisplayName: n.name,
      userID: new TextEncoder().encode(`tillsplit-${n.id}`),
      attestationType: "none",
      excludeCredentials: vorhanden.map((k) => ({ id: k.id })),
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });
    await sql`update sitzungen set challenge = ${optionen.challenge} where token_hash = ${n.sitzung}`;
    return optionen;
  });

  app.post<{ Body: { antwort: RegistrationResponseJSON; name?: string } }>("/api/konto/passkey", async (req, antwort) => {
    const n = req.nutzer!;
    const [s] = await sql<{ challenge: string | null }[]>`select challenge from sitzungen where token_hash = ${n.sitzung}`;
    if (!s?.challenge) return antwort.code(400).send({ fehler: "Bitte erneut versuchen" });
    const { origin, rpID } = rp(req);
    const ergebnis = await verifyRegistrationResponse({
      response: req.body.antwort,
      expectedChallenge: s.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    }).catch((e: Error) => {
      throw httpFehler(400, t("Passkey abgelehnt: {meldung}", { meldung: e.message }));
    });
    if (!ergebnis.verified || !ergebnis.registrationInfo) return antwort.code(400).send({ fehler: "Passkey konnte nicht geprüft werden" });
    const k = ergebnis.registrationInfo.credential;
    await sql`
      insert into passkeys (id, benutzer_id, public_key, zaehler, transports, name)
      values (${k.id}, ${n.id}, ${Buffer.from(k.publicKey)}, ${k.counter}, ${k.transports ?? null}, ${String(req.body.name ?? "").trim().slice(0, 60) || "Passkey"})`;
    await sql`update sitzungen set challenge = null where token_hash = ${n.sitzung}`;
    await protokollieren(req, "passkey_angelegt");
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/konto/passkey/:id", async (req, antwort) => {
    const n = req.nutzer!;
    const [{ rest, totp }] = await sql<{ rest: number; totp: boolean }[]>`
      select (select count(*) from passkeys where benutzer_id = ${n.id} and id <> ${req.params.id})::int as rest,
             (select totp_aktiv from benutzer where id = ${n.id}) as totp`;
    if (config.zweiFaktorPflicht && rest === 0 && !totp) return antwort.code(400).send({ fehler: "Zwei-Faktor ist Pflicht – erst TOTP einrichten" });
    await sql`delete from passkeys where id = ${req.params.id} and benutzer_id = ${n.id}`;
    await protokollieren(req, "passkey_entfernt");
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/konto/sitzungen/:id", async (req) => {
    const n = req.nutzer!;
    await sql`delete from sitzungen where benutzer_id = ${n.id} and left(token_hash, 12) = ${req.params.id} and token_hash <> ${n.sitzung}`;
    return { ok: true };
  });
}

async function passwortRichtig(benutzerId: number, passwort: unknown): Promise<boolean> {
  const [b] = await sql<{ passwort_hash: string | null }[]>`select passwort_hash from benutzer where id = ${benutzerId}`;
  return passwortPruefen(String(passwort ?? ""), b?.passwort_hash ?? null);
}

async function codesErzeugen(benutzerId: number): Promise<string[]> {
  const codes = wiederherstellungscodes();
  await sql.begin(async (tx) => {
    await tx`delete from wiederherstellungscodes where benutzer_id = ${benutzerId}`;
    await tx`insert into wiederherstellungscodes ${tx(codes.map((c) => ({ benutzer_id: benutzerId, code_hash: sha256(codeNormalisieren(c)) })))}`;
  });
  return codes;
}

/** Passkey-Antwort prüfen; liefert die Benutzer-ID oder null */
async function passkeyPruefen(req: FastifyRequest, antwort: AuthenticationResponseJSON, challenge: string | null, verifizierungNoetig = false): Promise<number | null> {
  if (!challenge || !antwort?.id) return null;
  const [k] = await sql<{ id: string; benutzer_id: number; public_key: Buffer; zaehler: string; transports: string[] | null }[]>`
    select id, benutzer_id, public_key, zaehler, transports from passkeys where id = ${antwort.id}`;
  if (!k) {
    console.warn(`TILLSPLIT_ANMELDUNG_FEHLGESCHLAGEN ip=${ip(req)} grund=passkey_unbekannt`);
    return null;
  }
  const { origin, rpID } = rp(req);
  const ergebnis = await verifyAuthenticationResponse({
    response: antwort,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: verifizierungNoetig,
    credential: {
      id: k.id,
      publicKey: new Uint8Array(k.public_key),
      counter: Number(k.zaehler),
      transports: (k.transports ?? undefined) as AuthenticatorTransport[] | undefined,
    },
  }).catch(() => null);
  if (!ergebnis?.verified) {
    console.warn(`TILLSPLIT_ANMELDUNG_FEHLGESCHLAGEN ip=${ip(req)} grund=passkey`);
    return null;
  }
  await sql`update passkeys set zaehler = ${ergebnis.authenticationInfo.newCounter}, zuletzt_am = now() where id = ${k.id}`;
  return k.benutzer_id;
}
