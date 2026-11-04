import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { sql } from "./db.js";
import { gebiet, mitSprache, spracheGueltig, standardSprache, t, type Sprache } from "./i18n.js";
import { kostenPruefen, waehrungMitKurs } from "./ki/index.js";
import { CLAUDE_MODELLE, kostenSchaetzen, modellName } from "./ki/kosten.js";
import { einreihen } from "./verarbeitung.js";

/**
 * Benachrichtigungen: Glocke in der Oberfläche, E-Mail und Telegram.
 *
 * Ereignisse werden je Empfänger als Zeile gespeichert (Art + Werte, der Text entsteht erst beim Lesen
 * in der Sprache des Empfängers). Ein Stapel-Upload und ein Lesedurchgang ergeben je ein Ereignis.
 * Mail und Telegram werden gesammelt: alle offenen Ereignisse eines Benutzers gehen gemeinsam raus,
 * sobald das älteste das eingestellte Intervall erreicht hat (0 = beim nächsten Minutentakt).
 */

export const ARTEN = ["hochgeladen", "erkannt", "erinnerung"] as const;
export type Art = (typeof ARTEN)[number] | "test";
type Kanaele = { glocke: boolean; mail: boolean; telegram: boolean };
export type BenachrichtigungEinstellung = {
  ereignisse: Record<(typeof ARTEN)[number], Kanaele>;
  /** Minuten, die Mail/Telegram sammeln (0 = sofort) */
  intervall: number;
  /** Erinnerung an offene Prüfungen: alle n Tage (0 = aus) zur vollen Stunde */
  erinnerung: { tage: number; stunde: number };
};

export const INTERVALLE = [0, 15, 60, 240, 1440];
export const STANDARD: BenachrichtigungEinstellung = {
  ereignisse: {
    hochgeladen: { glocke: true, mail: false, telegram: false },
    erkannt: { glocke: true, mail: false, telegram: false },
    erinnerung: { glocke: true, mail: false, telegram: false },
  },
  intervall: 0,
  erinnerung: { tage: 1, stunde: 18 },
};

export function einstellungVon(roh: unknown): BenachrichtigungEinstellung {
  const r = (roh ?? {}) as Partial<BenachrichtigungEinstellung>;
  const ereignisse = Object.fromEntries(
    ARTEN.map((a) => {
      const k = (r.ereignisse?.[a] ?? {}) as Partial<Kanaele>;
      const s = STANDARD.ereignisse[a];
      return [a, { glocke: k.glocke ?? s.glocke, mail: k.mail ?? s.mail, telegram: k.telegram ?? s.telegram }];
    }),
  ) as BenachrichtigungEinstellung["ereignisse"];
  const intervall = INTERVALLE.includes(Number(r.intervall)) ? Number(r.intervall) : STANDARD.intervall;
  const tage = [0, 1, 2, 7].includes(Number(r.erinnerung?.tage)) ? Number(r.erinnerung!.tage) : STANDARD.erinnerung.tage;
  const stunde = Math.min(23, Math.max(0, Math.round(Number(r.erinnerung?.stunde ?? STANDARD.erinnerung.stunde))));
  return { ereignisse, intervall, erinnerung: { tage, stunde: Number.isFinite(stunde) ? stunde : 18 } };
}

export const mailVerfuegbar = () => Boolean(config.smtp.host && config.smtp.absender);
export const telegramVerfuegbar = () => Boolean(config.telegramToken);

// ---------- Ereignisse anlegen ----------

type Empfaenger = { id: number; benachrichtigung: unknown; telegram: boolean };
/** SQL-Teil: hat der Benutzer b mindestens einen Telegram-Chat verbunden? */
const hatTelegram = sql`exists (select 1 from telegram_chats c where c.benutzer_id = b.id) as telegram`;

/** Ereignis für mehrere Benutzer anlegen – je nach deren Einstellung für Glocke, Mail, Telegram */
async function anlegen(empfaenger: Empfaenger[], haushaltId: number | null, art: Art, daten: Record<string, unknown>): Promise<void> {
  for (const e of empfaenger) {
    const k: Kanaele =
      art === "test" ? { glocke: true, mail: true, telegram: true } : einstellungVon(e.benachrichtigung).ereignisse[art];
    const mail = k.mail && mailVerfuegbar();
    const telegram = k.telegram && telegramVerfuegbar() && e.telegram;
    if (!k.glocke && !mail && !telegram) continue;
    await sql`
      insert into benachrichtigungen (benutzer_id, haushalt_id, art, daten, glocke, mail_offen, telegram_offen)
      values (${e.id}, ${haushaltId}, ${art}, ${sql.json(daten as never)}, ${k.glocke}, ${mail}, ${telegram})`;
  }
}

/** Mitglieder eines Haushalts mit einem Recht (Administratoren ohne Mitgliedschaft bekommen nichts) */
const mitglieder = (haushaltId: number, recht: "bons_sehen" | "bons_bearbeiten") => sql<Empfaenger[]>`
  select b.id, b.benachrichtigung, ${hatTelegram}
    from mitglieder m join benutzer b on b.id = m.benutzer_id
   where m.haushalt_id = ${haushaltId} and b.aktiv and (case when ${recht} = 'bons_sehen' then m.bons_sehen else m.bons_bearbeiten end)`;

/** Neue Bons hochgeladen (ein Ereignis je Upload, auch bei vielen Dateien) – an die anderen Mitglieder */
export async function bonsHochgeladen(haushaltId: number, vonId: number, bonIds: number[]): Promise<void> {
  if (!bonIds.length) return;
  try {
    const [von] = await sql<{ name: string }[]>`select name from benutzer where id = ${vonId}`;
    const empfaenger = (await mitglieder(haushaltId, "bons_sehen")).filter((e) => e.id !== vonId);
    await anlegen(empfaenger, haushaltId, "hochgeladen", { n: bonIds.length, von: von?.name ?? "?", bon: bonIds.length === 1 ? bonIds[0] : null });
  } catch (fehler) {
    console.error("Benachrichtigung (hochgeladen):", (fehler as Error).message);
  }
}

/**
 * Lesedurchgang abgeschlossen (Warteschlange leer): je Haushalt ein Ereignis an alle, die prüfen dürfen,
 * und an die Hochladenden selbst
 */
export async function bonsGelesen(ergebnisse: { bonId: number; ok: boolean }[]): Promise<void> {
  if (!ergebnisse.length) return;
  try {
    const bons = await sql<{ id: number; haushalt_id: number; hochgeladen_von: number | null; status: string; ki_summe_passt: boolean | null; haendler: string | null }[]>`
      select b.id, b.haushalt_id, b.hochgeladen_von, b.status, b.ki_summe_passt, h.name as haendler
        from bons b left join haendler h on h.id = b.haendler_id where b.id = any(${ergebnisse.map((e) => e.bonId)}::int[])`;
    for (const h of new Set(bons.map((b) => b.haushalt_id))) {
      const eigene = bons.filter((b) => b.haushalt_id === h);
      const ok = eigene.filter((b) => ergebnisse.find((e) => e.bonId === b.id)?.ok);
      const empfaenger = new Map((await mitglieder(h, "bons_bearbeiten")).map((e) => [e.id, e]));
      const hochladende = [...new Set(eigene.map((b) => b.hochgeladen_von).filter((x): x is number => x != null))];
      if (hochladende.length) {
        for (const e of await sql<Empfaenger[]>`select b.id, b.benachrichtigung, ${hatTelegram} from benutzer b where b.id = any(${hochladende}::int[]) and b.aktiv`) {
          empfaenger.set(e.id, e);
        }
      }
      await anlegen([...empfaenger.values()], h, "erkannt", {
        n: ok.length,
        fehler: eigene.length - ok.length,
        bon: eigene.length === 1 ? eigene[0].id : null,
        // Bons, bei denen ein größeres Modell helfen könnte (Telegram bietet dafür Knöpfe an)
        probleme: eigene
          .filter((b) => b.status === "fehler" || (b.status === "erkannt" && b.ki_summe_passt === false))
          .slice(0, 10)
          .map((b) => ({ bon: b.id, haendler: b.haendler, grund: b.status === "fehler" ? "fehler" : "summe" })),
      });
    }
  } catch (fehler) {
    console.error("Benachrichtigung (gelesen):", (fehler as Error).message);
  }
}

/** Testnachricht über alle eingerichteten Kanäle, sofort versenden */
export async function testSenden(benutzerId: number): Promise<{ mail: string | null; telegram: string | null }> {
  const empfaenger = await sql<Empfaenger[]>`select b.id, b.benachrichtigung, ${hatTelegram} from benutzer b where b.id = ${benutzerId}`;
  await anlegen(empfaenger, null, "test", {});
  return versendenFuer(benutzerId, true);
}

// ---------- Texte ----------

type Problem = { bon: number; haendler: string | null; grund: "fehler" | "summe" };
const problemeVon = (d: Record<string, unknown>): Problem[] => (Array.isArray(d.probleme) ? (d.probleme as Problem[]) : []);

export type Eintrag = { titel: string; text: string; link: string };

/** Text eines Ereignisses in der aktuellen Sprache */
export function textVon(art: string, d: Record<string, unknown>): Eintrag {
  const n = Number(d.n ?? 0);
  switch (art) {
    case "hochgeladen":
      return {
        titel: t("Neue Bons"),
        text: t("{von} hat {n} Bon hochgeladen.|{von} hat {n} Bons hochgeladen.", { n, von: String(d.von ?? "") }),
        link: d.bon ? `/bons/${d.bon}` : "/bons",
      };
    case "erkannt": {
      const fehler = Number(d.fehler ?? 0);
      const summe = problemeVon(d).filter((p) => p.grund === "summe");
      const teile = [
        n > 0 ? t("{n} Bon wurde gelesen und wartet auf die Prüfung.|{n} Bons wurden gelesen und warten auf die Prüfung.", { n }) : "",
        fehler > 0 ? t("{n} Bon konnte nicht gelesen werden.|{n} Bons konnten nicht gelesen werden.", { n: fehler }) : "",
        summe.length ? t("Summe passt nicht bei: {liste}.", { liste: summe.map((p) => p.haendler ?? t("Bon {nr}", { nr: p.bon })).join(", ") }) : "",
      ].filter(Boolean);
      return { titel: n > 0 ? t("Bons gelesen") : t("Bons nicht lesbar"), text: teile.join(" "), link: d.bon ? `/bons/${d.bon}` : fehler && !n ? "/bons?status=fehler" : "/bons?status=erkannt" };
    }
    case "erinnerung":
      return {
        titel: t("Prüfung ausstehend"),
        text: t("{n} Bon wartet auf die Prüfung.|{n} Bons warten auf die Prüfung.", { n }),
        link: "/bons?status=erkannt",
      };
    default:
      return { titel: t("Testnachricht"), text: t("Die Benachrichtigungen von TillSplit funktionieren."), link: "/konto" };
  }
}

// ---------- Versand ----------

let transport: nodemailer.Transporter | null = null;
function mailer(): nodemailer.Transporter {
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.sicher,
    ...(config.smtp.benutzer ? { auth: { user: config.smtp.benutzer, pass: config.smtp.passwort ?? "" } } : {}),
  });
  return transport;
}

const absolut = (link: string) => (config.oeffentlicheUrl ? new URL(link, config.oeffentlicheUrl).toString() : null);
const html = (s: string) => s.replace(/[&<>"]/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[z]!);

async function mailSenden(an: string, eintraege: Eintrag[]): Promise<void> {
  const betreff = eintraege.length === 1 ? `TillSplit: ${eintraege[0].titel}` : `TillSplit: ${t("{n} Benachrichtigungen", { n: eintraege.length })}`;
  const zeilen = eintraege.map((e) => `${e.titel}: ${e.text}${absolut(e.link) ? `\n${absolut(e.link)}` : ""}`);
  await mailer().sendMail({
    from: config.smtp.absender,
    to: an,
    subject: betreff,
    text: zeilen.join("\n\n") + `\n\n-- \n${t("Benachrichtigungen einstellen: Mein Konto in TillSplit")}`,
    html:
      eintraege
        .map((e) => {
          const url = absolut(e.link);
          return `<p><b>${html(e.titel)}</b><br>${html(e.text)}${url ? `<br><a href="${html(url)}">${html(t("In TillSplit öffnen"))}</a>` : ""}</p>`;
        })
        .join("") + `<p style="color:#888;font-size:12px">${html(t("Benachrichtigungen einstellen: Mein Konto in TillSplit"))}</p>`,
  });
}

async function telegram(methode: string, daten: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
  const antwort = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${methode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(daten),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await antwort.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`Telegram: ${json.description ?? antwort.status}`);
  return json.result;
}

async function telegramSenden(chatId: string, eintraege: Eintrag[], knoepfe: { text: string; callback_data: string }[][] = []): Promise<void> {
  const text = eintraege
    .map((e) => {
      const url = absolut(e.link);
      return `<b>${html(e.titel)}</b>\n${html(e.text)}${url ? `\n<a href="${html(url)}">${html(t("In TillSplit öffnen"))}</a>` : ""}`;
    })
    .join("\n\n");
  await telegram("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(knoepfe.length ? { reply_markup: { inline_keyboard: knoepfe } } : {}),
  });
}

const spracheVon = (s: string | null): Sprache => (s && spracheGueltig(s) ? s : standardSprache());

/** Offene Mail-/Telegram-Benachrichtigungen eines Benutzers gesammelt versenden (sofort = Intervall ignorieren) */
async function versendenFuer(benutzerId: number, sofort = false): Promise<{ mail: string | null; telegram: string | null }> {
  const ergebnis = { mail: null as string | null, telegram: null as string | null };
  const [b] = await sql<{ email: string; sprache: string | null; benachrichtigung: unknown }[]>`
    select email, sprache, benachrichtigung from benutzer where id = ${benutzerId}`;
  if (!b) return ergebnis;
  const intervall = sofort ? 0 : einstellungVon(b.benachrichtigung).intervall;
  const offen = await sql<{ id: number; art: string; daten: Record<string, unknown>; erstellt_am: Date; mail_offen: boolean; telegram_offen: boolean }[]>`
    select id, art, daten, erstellt_am, mail_offen, telegram_offen from benachrichtigungen
     where benutzer_id = ${benutzerId} and (mail_offen or telegram_offen) order by erstellt_am`;
  if (!offen.length) return ergebnis;
  // gesammelt: erst senden, wenn das älteste offene Ereignis lange genug wartet
  if (!sofort && Date.now() - offen[0].erstellt_am.getTime() < Math.max(intervall, 1) * 60_000 - 5_000) return ergebnis;

  await mitSprache(spracheVon(b.sprache), async () => {
    const mailZeilen = offen.filter((o) => o.mail_offen);
    if (mailZeilen.length) {
      try {
        await mailSenden(b.email, mailZeilen.map((o) => textVon(o.art, o.daten)));
        ergebnis.mail = "ok";
      } catch (fehler) {
        ergebnis.mail = (fehler as Error).message;
        console.error(`Benachrichtigung per Mail an Benutzer ${benutzerId}:`, ergebnis.mail);
      }
      // auch bei Fehler nicht endlos wiederholen
      await sql`update benachrichtigungen set mail_offen = false where id = any(${mailZeilen.map((o) => o.id)}::bigint[])`;
    }
    const tgZeilen = offen.filter((o) => o.telegram_offen);
    if (tgZeilen.length) {
      try {
        const chats = await sql<{ id: number; chat_id: string; gruppe: boolean }[]>`
          select id, chat_id, gruppe from telegram_chats where benutzer_id = ${benutzerId} order by id`;
        if (!chats.length) throw new Error(t("Telegram ist nicht verbunden"));
        const probleme = tgZeilen.filter((o) => o.art === "erkannt").flatMap((o) => problemeVon(o.daten));
        const eintraege = tgZeilen.map((o) => textVon(o.art, o.daten));
        const fehler: string[] = [];
        for (const c of chats) {
          try {
            // Nachlese-Knöpfe nur in eigenen Chats – in Gruppen könnte sie jeder drücken
            await telegramSenden(c.chat_id, eintraege, c.gruppe ? [] : await nachleseKnoepfe(benutzerId, probleme));
          } catch (e) {
            const meldung = (e as Error).message;
            // Bot aus der Gruppe entfernt oder Chat gelöscht/blockiert: Verbindung aufheben
            if (/blocked|kicked|not found|deactivated|upgraded/i.test(meldung)) await sql`delete from telegram_chats where id = ${c.id}`;
            fehler.push(meldung);
          }
        }
        if (fehler.length === chats.length) throw new Error(fehler[0]);
        ergebnis.telegram = "ok";
      } catch (fehler) {
        ergebnis.telegram = (fehler as Error).message;
        console.error(`Benachrichtigung per Telegram an Benutzer ${benutzerId}:`, ergebnis.telegram);
      }
      await sql`update benachrichtigungen set telegram_offen = false where id = any(${tgZeilen.map((o) => o.id)}::bigint[])`;
    }
  });
  return ergebnis;
}

// ---------- Telegram-Knöpfe: mit größerem Modell nachlesen ----------

/**
 * Knöpfe „<Geschäft>: mit Sonnet nachlesen ≈ 5 Cent“ für Bons, die nicht sauber gelesen wurden.
 * Jeder Knopf trägt nur eine zufällige, einmal gültige Kennung (48 Stunden), gebunden an Benutzer, Bon und Modell.
 */
async function nachleseKnoepfe(benutzerId: number, probleme: Problem[]): Promise<{ text: string; callback_data: string }[][]> {
  if (!process.env.ANTHROPIC_API_KEY || !probleme.length) return [];
  const zeilen: { text: string; callback_data: string }[][] = [];
  const { waehrung, kurs } = await waehrungMitKurs();
  const geld = (usd: number) => (usd * kurs).toLocaleString(gebiet(), { style: "currency", currency: waehrung, maximumFractionDigits: usd * kurs < 1 ? 3 : 2 });
  for (const p of probleme.slice(0, 5)) {
    // nur wer den Bon prüfen darf, bekommt Knöpfe; gebuchte Bons werden nicht mehr überschrieben
    const [bon] = await sql<{ status: string }[]>`
      select b.status from bons b join mitglieder m on m.haushalt_id = b.haushalt_id and m.benutzer_id = ${benutzerId} and m.bons_bearbeiten
       where b.id = ${p.bon}`;
    if (!bon || ["gebucht", "neu", "in_arbeit"].includes(bon.status)) continue;
    const [letzter] = await sql<{ modell: string; ein: number; aus: number }[]>`
      select modell, coalesce(eingabe_tokens, 0) + coalesce(cache_tokens, 0) as ein, coalesce(ausgabe_tokens, 0) as aus
        from ki_aufrufe where bon_id = ${p.bon} and anbieter = 'claude' order by zeit desc limit 1`;
    const stufe = letzter ? CLAUDE_MODELLE.findIndex((m) => letzter.modell.startsWith(m.id)) : 0;
    const groessere = CLAUDE_MODELLE.slice(Math.max(1, stufe + 1));
    const zeile: { text: string; callback_data: string }[] = [];
    for (const m of groessere) {
      const token = crypto.randomBytes(16).toString("base64url");
      await sql`insert into telegram_aktionen (token, benutzer_id, bon_id, modell) values (${token}, ${benutzerId}, ${p.bon}, ${m.id})`;
      const usd = letzter ? kostenSchaetzen(m.id, letzter.ein, letzter.aus) : null;
      const name = p.haendler ?? t("Bon {nr}", { nr: p.bon });
      zeile.push({ text: usd != null ? t("{name}: {modell} ≈ {kosten}", { name, modell: m.name, kosten: geld(usd) }) : `${name}: ${m.name}`, callback_data: `n:${token}` });
    }
    if (zeile.length) zeilen.push(zeile);
  }
  return zeilen;
}

type Rueckruf = { id: string; data?: string; message?: { chat: { id: number }; message_id: number; reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] } } };

/** Klick auf einen Knopf: nur eigene, unbenutzte Kennungen aus dem verknüpften Chat werden ausgeführt */
async function rueckrufVerarbeiten(r: Rueckruf): Promise<void> {
  const antworten = (text: string) => telegram("answerCallbackQuery", { callback_query_id: r.id, text, show_alert: true }).catch(() => {});
  const chatId = r.message ? String(r.message.chat.id) : "";
  const token = r.data?.startsWith("n:") ? r.data.slice(2) : "";
  const [a] = token
    ? await sql<{ benutzer_id: number; bon_id: number; modell: string; sprache: string | null; eigener_chat: boolean; haushalt_id: number | null; darf: boolean; status: string | null }[]>`
        select a.benutzer_id, a.bon_id, a.modell, b.sprache, x.haushalt_id, x.status,
               -- nur aus einem eigenen (privaten) Chat des Benutzers
               exists (select 1 from telegram_chats c where c.benutzer_id = a.benutzer_id and c.chat_id = ${chatId} and not c.gruppe) as eigener_chat,
               exists (select 1 from mitglieder m where m.haushalt_id = x.haushalt_id and m.benutzer_id = a.benutzer_id and m.bons_bearbeiten) as darf
          from telegram_aktionen a join benutzer b on b.id = a.benutzer_id and b.aktiv left join bons x on x.id = a.bon_id
         where a.token = ${token} and a.benutzt_am is null and a.erstellt_am > now() - interval '48 hours'`
    : [];
  // unbekannt, abgelaufen, schon benutzt oder aus einem fremden Chat: nichts tun
  if (!a || !a.eigener_chat) return void antworten(t("Dieser Knopf ist nicht mehr gültig."));
  await mitSprache(spracheVon(a.sprache), async () => {
    if (!a.darf || !a.haushalt_id) return void antworten(t("Dafür fehlt dir die Berechtigung"));
    if (a.status === "gebucht") return void antworten(t("Der Bon ist schon gebucht und wird nicht mehr neu gelesen."));
    if (a.status === "neu" || a.status === "in_arbeit") return void antworten(t("Der Bon wird gerade gelesen."));
    // alle Knöpfe dieses Bons verbrauchen (kein doppeltes Nachlesen)
    await sql`update telegram_aktionen set benutzt_am = now() where bon_id = ${a.bon_id} and benutzer_id = ${a.benutzer_id} and benutzt_am is null`;
    const [letzter] = await sql<{ ein: number; aus: number }[]>`
      select coalesce(eingabe_tokens, 0) + coalesce(cache_tokens, 0) as ein, coalesce(ausgabe_tokens, 0) as aus
        from ki_aufrufe where bon_id = ${a.bon_id} and anbieter = 'claude' order by zeit desc limit 1`;
    try {
      await kostenPruefen(a.bon_id, letzter ? (kostenSchaetzen(a.modell, letzter.ein, letzter.aus) ?? 0) : 0);
    } catch (fehler) {
      return void antworten((fehler as Error).message);
    }
    await sql`update bons set status = 'neu', fehler = null where id = ${a.bon_id} and haushalt_id = ${a.haushalt_id}`;
    einreihen(a.bon_id, undefined, a.modell);
    console.log(`Telegram: Benutzer ${a.benutzer_id} lässt Bon ${a.bon_id} mit ${a.modell} nachlesen`);
    await antworten(t("Wird mit {modell} nachgelesen – du bekommst Bescheid, wenn es fertig ist.", { modell: modellName(a.modell) }));
    // Knöpfe dieses Bons aus der Nachricht entfernen
    if (r.message?.reply_markup) {
      const verbraucht = new Set(
        (await sql<{ token: string }[]>`select token from telegram_aktionen where bon_id = ${a.bon_id} and benutzer_id = ${a.benutzer_id}`).map((x) => `n:${x.token}`),
      );
      const rest = r.message.reply_markup.inline_keyboard.map((z) => z.filter((k) => !verbraucht.has(k.callback_data ?? ""))).filter((z) => z.length);
      await telegram("editMessageReplyMarkup", { chat_id: chatId, message_id: r.message.message_id, reply_markup: { inline_keyboard: rest } }).catch(() => {});
    }
  });
}

// für Tests (werkzeuge/…): Knöpfe erzeugen und Klicks verarbeiten, ohne echten Bot
export const _telegramTest = { nachleseKnoepfe, rueckrufVerarbeiten };

// ---------- Erinnerung an offene Prüfungen ----------

// nur den Stundenteil nehmen ("de-DE" formatiert sonst „10 Uhr“)
const stundeJetzt = () =>
  Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: config.zeitzone }).formatToParts(new Date()).find((p) => p.type === "hour")?.value);

async function erinnern(): Promise<void> {
  const stunde = stundeJetzt();
  const benutzer = await sql<(Empfaenger & { erinnerung_am: Date | null })[]>`
    select b.id, b.benachrichtigung, ${hatTelegram}, b.erinnerung_am from benutzer b where b.aktiv`;
  for (const b of benutzer) {
    const e = einstellungVon(b.benachrichtigung);
    if (!e.erinnerung.tage || e.erinnerung.stunde !== stunde) continue;
    // höchstens einmal je Intervall (1 Stunde Spielraum für den Minutentakt)
    if (b.erinnerung_am && Date.now() - b.erinnerung_am.getTime() < e.erinnerung.tage * 86_400_000 - 3_600_000) continue;
    await sql`update benutzer set erinnerung_am = now() where id = ${b.id}`;
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from bons x join mitglieder m on m.haushalt_id = x.haushalt_id
       where m.benutzer_id = ${b.id} and m.bons_bearbeiten and x.status = 'erkannt'`;
    if (n > 0) await anlegen([b], null, "erinnerung", { n });
  }
}

// ---------- Telegram verbinden (Bot liest /start <code>) ----------

const codes = new Map<string, { benutzerId: number; bis: number }>();
let botName: string | null = null;

/**
 * Einmal-Link zum Verbinden: eigener Chat (?start=) oder Gruppe (?startgroup= – Telegram lässt die Gruppe wählen,
 * fügt den Bot hinzu und schickt „/start@<bot> <code>“ in die Gruppe)
 */
export async function telegramLink(benutzerId: number, gruppe = false): Promise<string> {
  if (!telegramVerfuegbar()) throw new Error(t("Telegram ist nicht eingerichtet (TELEGRAM_BOT_TOKEN)"));
  botName ??= ((await telegram("getMe", {})) as { username: string }).username;
  for (const [c, v] of codes) if (v.bis < Date.now()) codes.delete(c);
  const code = crypto.randomBytes(12).toString("base64url");
  codes.set(code, { benutzerId, bis: Date.now() + 15 * 60_000 });
  return `https://t.me/${botName}?${gruppe ? "startgroup" : "start"}=${code}`;
}

type TgNachricht = { chat: { id: number; type: string; title?: string; first_name?: string }; text?: string };

/** /start <code> (verbinden) und /stop (trennen) – in eigenen Chats und Gruppen; jeder andere Text wird ignoriert */
async function befehlVerarbeiten(nachricht: TgNachricht): Promise<void> {
  if (!nachricht.text || !["private", "group", "supergroup"].includes(nachricht.chat.type)) return;
  const chatId = String(nachricht.chat.id);
  const gruppe = nachricht.chat.type !== "private";
  // in Gruppen kommen Befehle als /start@name_des_bots
  const [roh, code] = nachricht.text.trim().split(/\s+/);
  const befehl = roh.split("@")[0];
  if (gruppe && roh.includes("@") && botName && roh.split("@")[1].toLowerCase() !== botName.toLowerCase()) return;
  if (befehl === "/start" && code && codes.has(code)) {
    const { benutzerId, bis } = codes.get(code)!;
    codes.delete(code);
    if (bis < Date.now()) return;
    const [b] = await sql<{ name: string; sprache: string | null }[]>`select name, sprache from benutzer where id = ${benutzerId} and aktiv`;
    if (!b) return;
    await mitSprache(spracheVon(b.sprache), async () => {
      try {
        await sql`
          insert into telegram_chats (benutzer_id, chat_id, titel, gruppe)
          values (${benutzerId}, ${chatId}, ${(nachricht.chat.title ?? nachricht.chat.first_name ?? "Telegram").slice(0, 100)}, ${gruppe})
          on conflict (benutzer_id, chat_id) do update set titel = excluded.titel, gruppe = excluded.gruppe`;
      } catch {
        // eine Gruppe nur einmal (sonst kämen die Meldungen dort doppelt)
        await telegram("sendMessage", { chat_id: chatId, text: t("Diese Gruppe ist schon mit TillSplit verbunden.") });
        return;
      }
      await telegram("sendMessage", {
        chat_id: chatId,
        text: gruppe
          ? t("Verbunden: In diese Gruppe kommen ab jetzt die Benachrichtigungen von TillSplit für {name}.", { name: b.name })
          : t("Verbunden: Hier kommen ab jetzt die Benachrichtigungen von TillSplit für {name}.", { name: b.name }),
      });
    });
  } else if (befehl === "/stop") {
    const geloescht = await sql`delete from telegram_chats where chat_id = ${chatId} returning id`;
    if (geloescht.length) await telegram("sendMessage", { chat_id: chatId, text: t("Getrennt – TillSplit sendet hierher keine Nachrichten mehr.") });
  }
}

let versatz = 0;
async function telegramLauschen(): Promise<void> {
  botName ??= await telegram("getMe", {}).then((r) => (r as { username: string }).username).catch(() => null);
  for (;;) {
    try {
      const updates = (await telegram("getUpdates", { offset: versatz, timeout: 50, allowed_updates: ["message", "callback_query", "my_chat_member"] }, 60_000)) as {
        update_id: number;
        message?: TgNachricht;
        callback_query?: Rueckruf;
        my_chat_member?: { chat: { id: number }; new_chat_member: { status: string } };
      }[];
      for (const u of updates) {
        versatz = u.update_id + 1;
        if (u.callback_query) {
          await rueckrufVerarbeiten(u.callback_query).catch((e) => console.warn("Telegram-Knopf:", (e as Error).message));
          continue;
        }
        // Bot aus einer Gruppe entfernt oder im Chat blockiert: Verbindung aufheben
        const mitglied = u.my_chat_member;
        if (mitglied && ["left", "kicked"].includes(mitglied.new_chat_member.status)) {
          await sql`delete from telegram_chats where chat_id = ${String(mitglied.chat.id)}`;
          continue;
        }
        // Freier Text löst nie etwas aus – nur /start <Einmal-Code> und /stop
        if (u.message) await befehlVerarbeiten(u.message).catch((e) => console.warn("Telegram-Befehl:", (e as Error).message));
      }
    } catch (fehler) {
      const meldung = (fehler as Error).message;
      // Conflict = ein anderes Programm (z. B. Home Assistant) fragt denselben Bot ab und verliert sonst Nachrichten
      if (/conflict/i.test(meldung)) {
        console.error("Telegram: Dieser Bot wird schon von einem anderen Programm abgefragt (z. B. Home Assistant). TillSplit braucht einen eigenen Bot (@BotFather → /newbot). Telegram bleibt bis zum Neustart aus.");
        return;
      }
      console.warn("Telegram:", meldung);
      await new Promise((ok) => setTimeout(ok, 30_000));
    }
  }
}

// ---------- Takt ----------

export function benachrichtigungenPlanen(): void {
  setInterval(async () => {
    try {
      const offen = await sql<{ benutzer_id: number }[]>`
        select distinct benutzer_id from benachrichtigungen where mail_offen or telegram_offen`;
      for (const { benutzer_id } of offen) await versendenFuer(benutzer_id);
      await erinnern();
      await sql`delete from benachrichtigungen where erstellt_am < now() - interval '60 days'`;
      await sql`delete from telegram_aktionen where erstellt_am < now() - interval '7 days'`;
    } catch (fehler) {
      console.error("Benachrichtigungen:", (fehler as Error).message);
    }
  }, 60_000).unref();
  if (telegramVerfuegbar()) void telegramLauschen();
}
