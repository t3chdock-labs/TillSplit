import type { FastifyInstance } from "fastify";
import { httpFehler } from "../auth.js";
import {
  einstellungVon,
  INTERVALLE,
  mailVerfuegbar,
  telegramLink,
  telegramVerfuegbar,
  testSenden,
  textVon,
} from "../benachrichtigungen.js";
import { sql } from "../db.js";
import { t } from "../i18n.js";

/** Glocke, eigene Einstellungen und Telegram-Verbindung – jeweils nur für den angemeldeten Benutzer */
export async function benachrichtigungRouten(app: FastifyInstance) {
  const nutzer = (req: { nutzer?: { id: number } }) => {
    if (!req.nutzer) throw httpFehler(401, "Nicht angemeldet");
    return req.nutzer.id;
  };

  app.get("/api/benachrichtigungen", async (req) => {
    const id = nutzer(req);
    const zeilen = await sql<{ id: number; art: string; daten: Record<string, unknown>; erstellt_am: Date; gelesen_am: Date | null }[]>`
      select id, art, daten, erstellt_am, gelesen_am from benachrichtigungen
       where benutzer_id = ${id} and glocke order by erstellt_am desc limit 50`;
    return {
      eintraege: zeilen.map((z) => ({ id: z.id, art: z.art, ...textVon(z.art, z.daten), erstellt: z.erstellt_am, gelesen: Boolean(z.gelesen_am) })),
      ungelesen: zeilen.filter((z) => !z.gelesen_am).length,
    };
  });

  app.get("/api/benachrichtigungen/anzahl", async (req) => {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from benachrichtigungen where benutzer_id = ${nutzer(req)} and glocke and gelesen_am is null`;
    return { ungelesen: n };
  });

  /** Eine (id) oder alle als gelesen markieren */
  app.post<{ Body: { id?: number } }>("/api/benachrichtigungen/gelesen", async (req) => {
    const id = nutzer(req);
    const eine = Number(req.body?.id);
    if (Number.isInteger(eine) && eine > 0) {
      await sql`update benachrichtigungen set gelesen_am = now() where id = ${eine} and benutzer_id = ${id} and gelesen_am is null`;
    } else {
      await sql`update benachrichtigungen set gelesen_am = now() where benutzer_id = ${id} and gelesen_am is null`;
    }
    return { ok: true };
  });

  app.get("/api/benachrichtigungen/einstellungen", async (req) => {
    const id = nutzer(req);
    const [b] = await sql<{ email: string; benachrichtigung: unknown }[]>`select email, benachrichtigung from benutzer where id = ${id}`;
    const chats = await sql<{ id: number; titel: string; gruppe: boolean }[]>`
      select id, titel, gruppe from telegram_chats where benutzer_id = ${id} order by gruppe, id`;
    return {
      einstellung: einstellungVon(b.benachrichtigung),
      intervalle: INTERVALLE,
      mail: { verfuegbar: mailVerfuegbar(), adresse: b.email },
      telegram: { verfuegbar: telegramVerfuegbar(), verbunden: chats.length > 0, chats },
    };
  });

  app.put("/api/benachrichtigungen/einstellungen", async (req) => {
    const einstellung = einstellungVon(req.body);
    await sql`update benutzer set benachrichtigung = ${sql.json(einstellung as never)} where id = ${nutzer(req)}`;
    return { ok: true, einstellung };
  });

  /** Link zum Bot mit Einmal-Code; der Bot verbindet beim /start den eigenen Chat bzw. die gewählte Gruppe */
  app.post<{ Body: { gruppe?: boolean } }>("/api/benachrichtigungen/telegram", async (req) => {
    try {
      return { link: await telegramLink(nutzer(req), req.body?.gruppe === true) };
    } catch (fehler) {
      throw httpFehler(400, (fehler as Error).message);
    }
  });

  /** Einen verbundenen Chat trennen */
  app.delete<{ Params: { id: string } }>("/api/benachrichtigungen/telegram/:id", async (req) => {
    await sql`delete from telegram_chats where id = ${Number(req.params.id) || 0} and benutzer_id = ${nutzer(req)}`;
    return { ok: true };
  });

  app.post("/api/benachrichtigungen/test", async (req) => {
    const ergebnis = await testSenden(nutzer(req));
    const teile = [
      t("Glocke: ok"),
      ergebnis.mail && (ergebnis.mail === "ok" ? t("E-Mail: gesendet") : t("E-Mail: {fehler}", { fehler: ergebnis.mail })),
      ergebnis.telegram && (ergebnis.telegram === "ok" ? t("Telegram: gesendet") : t("Telegram: {fehler}", { fehler: ergebnis.telegram })),
    ].filter(Boolean);
    return { text: teile.join(" · ") };
  });
}
