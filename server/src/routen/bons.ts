import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  abgleichen,
  actualEinstellung,
  actualZuruecknehmen,
  alleAbgleichen,
  aufBuchungVerteilen,
  buchungsBudgets,
  kandidatenSuchen,
  barBuchen,
  buchungsBons,
  neuAufteilen,
  sammelAufloesen,
  sammelKandidatenSuchen,
  sammelVorschlaege,
  sammelVorschlagBuchen,
  type AbgleichErgebnis,
} from "../actual.js";
import { httpFehler, zugriff } from "../auth.js";
import { config } from "../config.js";
import { bonsHochgeladen } from "../benachrichtigungen.js";
import { gegenpruefungAktualisieren } from "../gegenpruefung.js";
import { sql } from "../db.js";
import { t } from "../i18n.js";
import { ablageVon, absoluterPfad, bonAblegen, dateiartErkennen, dateiLesen, dateiSchreiben, fuerAblageAufbereiten, mimeVon, sha256, vorschauBild } from "../dateien.js";
import { bonKosten, kiEinstellung, kostenPruefen, waehrungMitKurs } from "../ki/index.js";
import { CLAUDE_MODELLE, kostenSchaetzen } from "../ki/kosten.js";
import { regelLernen } from "../regeln.js";
import { duplikatPruefen, einreihen, haendlerFinden, sorteSaeubern } from "../verarbeitung.js";

type Vorgabe = { zahlung?: "bar" | "karte"; konto?: string };

/** Eine hochgeladene Datei als Bon anlegen; Dubletten (gleicher Inhalt im selben Haushalt) werden erkannt. */
async function bonAnlegen(haushaltId: number, benutzerId: number, puffer: Buffer, dateiname: string | undefined, vorgabe: Vorgabe = {}): Promise<{ id: number; doppelt: boolean }> {
  const art = dateiartErkennen(puffer);
  if (!art) throw new Error(t("{datei}: Dateityp wird nicht unterstützt (Foto, Screenshot oder PDF)", { datei: dateiname ?? t("Datei") }));

  const hash = sha256(puffer);
  const [vorhanden] = await sql<{ id: number }[]>`select id from bons where haushalt_id = ${haushaltId} and datei_sha256 = ${hash}`;
  if (vorhanden) return { id: vorhanden.id, doppelt: true };

  const aufbereitet = await fuerAblageAufbereiten(puffer, art);
  // ist Verschlüsselung eingeschaltet, liegt die Datei schon im Eingang verschlüsselt
  const { verschluesseln } = await ablageVon(haushaltId);
  const relativ = `eingang/${crypto.randomUUID()}.${aufbereitet.art === "pdf" ? "pdf" : "jpg"}${verschluesseln ? ".enc" : ""}`;
  await dateiSchreiben(absoluterPfad(relativ, config.eingangVerzeichnis), aufbereitet.puffer, verschluesseln);

  const [bon] = await sql<{ id: number }[]>`
    insert into bons (haushalt_id, hochgeladen_von, verschluesselt, datei_pfad, datei_mime, datei_sha256, datei_name, zahlung, zahlung_quelle, actual_konto_id, konto_quelle)
    values (${haushaltId}, ${benutzerId}, ${verschluesseln}, ${relativ}, ${mimeVon[aufbereitet.art]}, ${hash}, ${(dateiname ?? "").slice(0, 200) || null},
            ${vorgabe.zahlung ?? "unbekannt"}, ${vorgabe.zahlung ? "hand" : "ki"},
            ${vorgabe.konto ?? null}, ${vorgabe.konto ? "hand" : null}) returning id`;
  einreihen(bon.id);
  return { id: bon.id, doppelt: false };
}

type PositionEingabe = {
  id?: number;
  text_roh: string;
  name: string;
  sorte?: string | null;
  menge: number | null;
  einheit: string | null;
  einzelpreis_cent: number | null;
  betrag_cent: number;
  gruppe_id: number | null;
  unsicher?: boolean;
};

/**
 * Bon des aktuellen Haushalts zum Ansehen: mit „Bons sehen“ alle, sonst nur selbst hochgeladene.
 * Liefert die Haushalts-ID oder wirft 404 (auch bei fremden Bons – verrät nicht, dass es sie gibt).
 */
async function bonSichtbar(req: FastifyRequest, id: number): Promise<number> {
  const h = zugriff(req);
  const alle = req.nutzer!.rechte!.bons_sehen;
  const [bon] = await sql`
    select 1 from bons where id = ${id} and haushalt_id = ${h} and (${alle} or hochgeladen_von = ${req.nutzer!.id})`;
  if (!bon) throw httpFehler(404, "Bon nicht gefunden");
  return h;
}

/** Bon bearbeiten: Recht „Bons bearbeiten“ und Bon im eigenen Haushalt */
async function bonBearbeitbar(req: FastifyRequest, id: number): Promise<number> {
  const h = zugriff(req, "bons_bearbeiten");
  const [bon] = await sql`select 1 from bons where id = ${id} and haushalt_id = ${h}`;
  if (!bon) throw httpFehler(404, "Bon nicht gefunden");
  return h;
}

const idVon = (wert: string) => {
  const id = Number(wert);
  if (!Number.isInteger(id) || id <= 0) throw httpFehler(400, "Ungültige ID");
  return id;
};

/** Vorschaubilder nach Datei-Prüfsumme, nur im Arbeitsspeicher (älteste fliegen zuerst raus) */
const vorschauSpeicher = new Map<string, Buffer>();

export async function bonRouten(app: FastifyInstance) {
  // Felder "zahlung" (bar|karte) und "konto" (Actual-Konto) müssen vor den Dateien kommen
  app.post("/api/bons", async (req, antwort) => {
    const h = zugriff(req);
    const ergebnisse: { id?: number; doppelt?: boolean; datei?: string; fehler?: string }[] = [];
    const vorgabe: Vorgabe = {};
    for await (const teil of req.parts()) {
      if (teil.type === "field") {
        const wert = String(teil.value ?? "");
        if (teil.fieldname === "zahlung" && (wert === "bar" || wert === "karte")) vorgabe.zahlung = wert;
        if (teil.fieldname === "konto" && wert && wert.length < 100) vorgabe.konto = wert;
        continue;
      }
      try {
        ergebnisse.push({ datei: teil.filename, ...(await bonAnlegen(h, req.nutzer!.id, await teil.toBuffer(), teil.filename, vorgabe)) });
      } catch (fehler) {
        ergebnisse.push({ datei: teil.filename, fehler: t((fehler as Error).message) });
      }
    }
    if (ergebnisse.length === 0) return antwort.code(400).send({ fehler: "Keine Datei erhalten" });
    // ein Upload mit mehreren Dateien = eine Benachrichtigung
    void bonsHochgeladen(h, req.nutzer!.id, ergebnisse.filter((e) => e.id && !e.doppelt).map((e) => e.id!));
    return ergebnisse;
  });

  // Ziel für "Teilen" aus anderen Apps (PWA share_target)
  app.post("/api/teilen", async (req, antwort) => {
    const h = zugriff(req);
    const ids: number[] = [];
    const neu: number[] = [];
    for await (const teil of req.files()) {
      try {
        const bon = await bonAnlegen(h, req.nutzer!.id, await teil.toBuffer(), teil.filename);
        ids.push(bon.id);
        if (!bon.doppelt) neu.push(bon.id);
      } catch {
        // nicht unterstützte Dateien still überspringen
      }
    }
    void bonsHochgeladen(h, req.nutzer!.id, neu);
    return antwort.redirect(ids.length === 1 ? `/bons/${ids[0]}` : "/bons", 303);
  });

  app.get<{ Querystring: { status?: string; suche?: string; seite?: string; von?: string; bis?: string } }>("/api/bons", async (req) => {
    const h = zugriff(req);
    const alle = req.nutzer!.rechte!.bons_sehen;
    const seite = Math.max(1, Math.min(10_000, Number(req.query.seite) || 1));
    const status = req.query.status || null;
    // Zeitraum nach Bon-Datum (Bons ohne Datum fallen bei gesetztem Zeitraum heraus)
    const datumOk = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
    const von = datumOk(req.query.von);
    const bis = datumOk(req.query.bis);
    const suche = req.query.suche ? `%${req.query.suche.slice(0, 100)}%` : null;
    const proSeite = 40;
    const zeilen = await sql`
      select b.id, b.status, b.fehler, to_char(b.datum, 'YYYY-MM-DD') as datum, b.uhrzeit, b.summe_cent,
             b.datei_mime, left(b.datei_sha256, 16) as datei_version, b.gegenpruefung, b.erstellt_am, h.name as haendler, b.zahlung, b.karte_endziffern, b.abgleich_hinweis,
             u.name as hochgeladen_von, b.dublette_von, b.sammel,
             count(p.id)::int as anzahl_positionen,
             count(p.id) filter (where p.gruppe_id is null)::int as ohne_gruppe,
             count(p.id) filter (where p.unsicher)::int as unsicher,
             coalesce(sum(p.betrag_cent), 0)::int as positionen_cent,
             count(*) over ()::int as gesamt
        from bons b
        left join haendler h on h.id = b.haendler_id
        left join benutzer u on u.id = b.hochgeladen_von
        left join positionen p on p.bon_id = b.id
       where b.haushalt_id = ${h}
         and (${alle} or b.hochgeladen_von = ${req.nutzer!.id})
         and (${status}::text is null or b.status = ${status})
         and (${von}::date is null or b.datum >= ${von}::date)
         and (${bis}::date is null or b.datum <= ${bis}::date)
         and (${suche}::text is null or h.name ilike ${suche} or exists (
               select 1 from positionen x where x.bon_id = b.id and (x.name ilike ${suche} or x.text_roh ilike ${suche})))
       group by b.id, h.name, u.name
       order by b.datum desc nulls first, b.id desc
       limit ${proSeite} offset ${(seite - 1) * proSeite}`;
    // gespeicherte feste Meldungen (Fehler, Abgleich) in der Sprache der Anfrage zeigen
    const uebersetzt = zeilen.map((b) => ({ ...b, fehler: b.fehler && t(b.fehler), abgleich_hinweis: b.abgleich_hinweis && t(b.abgleich_hinweis) }));
    return { bons: uebersetzt, gesamt: zeilen[0]?.gesamt ?? 0, proSeite };
  });

  app.get<{ Params: { id: string } }>("/api/bons/:id", async (req) => {
    const id = idVon(req.params.id);
    const h = await bonSichtbar(req, id);
    const [bon] = await sql`
      select b.id, b.status, b.fehler, to_char(b.datum, 'YYYY-MM-DD') as datum, b.uhrzeit, b.summe_cent, b.zahlart,
             b.filiale, b.notiz, b.datei_mime, left(b.datei_sha256, 16) as datei_version, b.gegenpruefung, b.pruef_text, b.datei_pfad, b.datei_name, b.ki_anbieter, b.ki_modell,
             b.actual_tx_id, b.gebucht_am, b.haendler_id, h.name as haendler,
             b.zahlung, b.zahlung_quelle, b.karte_endziffern, b.actual_konto_id, b.konto_quelle,
             b.abgleich_hinweis, b.abgleich_am, u.name as hochgeladen_von,
             b.ki_eingabe_tokens, b.ki_ausgabe_tokens, b.ki_cache_tokens, b.ki_kosten_usd::float as ki_kosten_usd, b.ki_sekunden::float as ki_sekunden,
             b.ki_summe_passt, b.dublette_von, b.sammel
        from bons b left join haendler h on h.id = b.haendler_id left join benutzer u on u.id = b.hochgeladen_von
       where b.id = ${id} and b.haushalt_id = ${h}`;
    // Sammelbuchung: die anderen Bons derselben Abbuchung
    const sammel_bons = bon?.sammel
      ? await sql`
          select b.id, to_char(b.datum, 'YYYY-MM-DD') as datum, b.summe_cent, h.name as haendler
            from bons b left join haendler h on h.id = b.haendler_id
           where b.haushalt_id = ${h} and b.sammel and b.actual_tx_id = ${bon.actual_tx_id} order by b.datum, b.id`
      : [];
    const positionen = await sql`
      select id, nr, text_roh, name, sorte, menge, einheit, einzelpreis_cent, betrag_cent, gruppe_id, gruppe_quelle, unsicher
        from positionen where bon_id = ${id} order by nr`;
    const [nachbarn] = await sql`
      select (select id from bons where haushalt_id = ${h} and status = 'erkannt' and id <> ${id}
                and (${req.nutzer!.rechte!.bons_bearbeiten} or hochgeladen_von = ${req.nutzer!.id})
               order by datum nulls last, id limit 1) as naechster_offen`;
    // Angebot zum Nachlesen mit größeren Modellen samt Kostenschätzung (aus den Tokens des letzten Laufs)
    const [letzter] = await sql<{ ein: number; aus: number; modell: string }[]>`
      select coalesce(eingabe_tokens, 0) + coalesce(cache_tokens, 0) as ein, coalesce(ausgabe_tokens, 0) as aus, modell
        from ki_aufrufe where bon_id = ${id} and anbieter = 'claude' order by zeit desc limit 1`;
    // Beträge in der Anzeigewährung: bisherige Kosten mit dem Kurs ihres Tages, Schätzungen mit dem heutigen
    const { waehrung, kurs } = await waehrungMitKurs();
    const nachlesen = letzter
      ? {
          modus: (await kiEinstellung()).nachlesen,
          modelle: CLAUDE_MODELLE.filter((m) => m.id !== "claude-haiku-5-5").map((m) => {
            const usd = kostenSchaetzen(m.id, letzter.ein, letzter.aus);
            return { id: m.id, name: m.name, schaetzung: usd == null ? null : usd * kurs, bisher: letzter.modell.startsWith(m.id) };
          }),
        }
      : null;
    return {
      ...bon,
      fehler: bon.fehler && t(bon.fehler),
      abgleich_hinweis: bon.abgleich_hinweis && t(bon.abgleich_hinweis),
      ki_kosten: await bonKosten(id, waehrung), positionen, sammel_bons, naechster_offen: nachbarn.naechster_offen, nachlesen };
  });

  app.get<{ Params: { id: string }; Querystring: { v?: string } }>("/api/bons/:id/datei", async (req, antwort) => {
    const id = idVon(req.params.id);
    const h = await bonSichtbar(req, id);
    const [bon] = await sql<{ datei_pfad: string; datei_mime: string; datei_sha256: string }[]>`
      select datei_pfad, datei_mime, datei_sha256 from bons where id = ${id}`;
    // Zwischenspeichern nur über den Inhalt, nie über die Bon-Nummer: Nummern können nach dem Zurücksetzen
    // oder Wiederherstellen erneut vergeben werden – der Browser zeigte sonst das Bild eines früheren Bons.
    const etag = `"${bon.datei_sha256}"`;
    antwort.header("etag", etag);
    antwort.header("cache-control", req.query.v && bon.datei_sha256.startsWith(req.query.v) ? "private, max-age=31536000, immutable" : "private, no-cache");
    if (req.headers["if-none-match"] === etag) return antwort.code(304).send();
    antwort.header("content-type", bon.datei_mime);
    antwort.header("x-content-type-options", "nosniff");
    // Datei nie als Seite mit Skripten ausführen (Bilder zusätzlich in einer Sandbox;
    // bei PDFs würde „sandbox“ den eingebauten PDF-Betrachter von Chrome blockieren)
    antwort.header(
      "content-security-policy",
      bon.datei_mime === "application/pdf" ? "default-src 'none'; script-src 'none'; object-src 'none'" : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    );
    antwort.header("content-disposition", `inline; filename="${path.basename(bon.datei_pfad).replace(/\.enc$/, "").replace(/[^\w.,-]/g, "_")}"`);
    return antwort.send(await dateiLesen(absoluterPfad(bon.datei_pfad, await ablageVon(h))));
  });

  // Vorschaubild für die Liste – zwischengespeichert über den Inhalt, damit nicht jedes Mal neu gerendert wird
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>("/api/bons/:id/vorschau", async (req, antwort) => {
    const id = idVon(req.params.id);
    const h = await bonSichtbar(req, id);
    const [bon] = await sql<{ datei_pfad: string; datei_mime: string; datei_sha256: string }[]>`
      select datei_pfad, datei_mime, datei_sha256 from bons where id = ${id}`;
    const etag = `"v-${bon.datei_sha256}"`;
    antwort.header("etag", etag);
    antwort.header("cache-control", req.query.v && bon.datei_sha256.startsWith(req.query.v) ? "private, max-age=31536000, immutable" : "private, no-cache");
    if (req.headers["if-none-match"] === etag) return antwort.code(304).send();
    let bild = vorschauSpeicher.get(bon.datei_sha256);
    if (!bild) {
      bild = await vorschauBild(await dateiLesen(absoluterPfad(bon.datei_pfad, await ablageVon(h))), bon.datei_mime);
      vorschauSpeicher.set(bon.datei_sha256, bild);
      if (vorschauSpeicher.size > 500) vorschauSpeicher.delete(vorschauSpeicher.keys().next().value!);
    }
    antwort.header("content-type", "image/jpeg");
    antwort.header("x-content-type-options", "nosniff");
    return antwort.send(bild);
  });

  // Prüfen & Speichern: Kopfdaten und Positionen übernehmen, Korrekturen lernen
  app.put<{
    Params: { id: string };
    Body: {
      haendler: string; datum: string | null; summe_cent: number | null; notiz: string | null; positionen: PositionEingabe[];
      zahlung?: "bar" | "karte" | "unbekannt"; actual_konto_id?: string | null;
    };
  }>("/api/bons/:id", async (req) => {
    const id = idVon(req.params.id);
    const h = await bonBearbeitbar(req, id);
    const { haendler, notiz, positionen } = req.body ?? ({} as never);
    if (!Array.isArray(positionen) || positionen.length > 500) throw httpFehler(400, "Positionen fehlen oder sind zu viele");
    const datum = req.body.datum && /^\d{4}-\d{2}-\d{2}$/.test(req.body.datum) ? req.body.datum : null;
    const summe_cent = Number.isFinite(req.body.summe_cent) ? Math.round(req.body.summe_cent!) : null;
    if (req.body.zahlung && !["bar", "karte", "unbekannt"].includes(req.body.zahlung)) throw httpFehler(400, "Ungültige Zahlart");

    // nur Gruppen des eigenen Haushalts zulassen
    const erlaubteGruppen = new Set((await sql<{ id: number }[]>`select id from gruppen where haushalt_id = ${h}`).map((g) => g.id));
    if (positionen.some((p) => p.gruppe_id != null && !erlaubteGruppen.has(p.gruppe_id))) throw httpFehler(400, "Unbekannte Gruppe");

    const [alt] = await sql<{ zahlung: string; zahlung_quelle: string; actual_konto_id: string | null; konto_quelle: string | null; karte_endziffern: string | null; status: string; summe_cent: number | null }[]>`
      select zahlung, zahlung_quelle, actual_konto_id, konto_quelle, karte_endziffern, status, summe_cent from bons where id = ${id}`;
    // Was die Aufteilung in Actual bestimmt: Gruppe und Betrag je Position, dazu die Summe
    const aufteilung = (liste: { gruppe_id: number | null; betrag_cent: number }[], summe: number | null) =>
      JSON.stringify([summe, liste.map((p) => `${p.gruppe_id}:${p.betrag_cent}`).sort()]);
    const aufteilungVorher = aufteilung(
      await sql<{ gruppe_id: number | null; betrag_cent: number }[]>`select gruppe_id, betrag_cent from positionen where bon_id = ${id}`,
      alt.summe_cent,
    );
    const zahlung = req.body.zahlung ?? alt.zahlung;
    const konto = req.body.actual_konto_id === undefined ? alt.actual_konto_id : req.body.actual_konto_id ? String(req.body.actual_konto_id).slice(0, 100) : null;
    const zahlungQuelle = zahlung !== alt.zahlung ? "hand" : alt.zahlung_quelle;
    const kontoQuelle = konto !== alt.actual_konto_id ? (konto ? "hand" : null) : alt.konto_quelle;
    const vorher = new Map(
      (await sql<{ id: number; gruppe_id: number | null; name: string; sorte: string | null; gruppe_quelle: string }[]>`
        select id, gruppe_id, name, sorte, gruppe_quelle from positionen where bon_id = ${id}`).map((p) => [p.id, p]),
    );
    const haendlerId = await haendlerFinden(String(haendler ?? "").slice(0, 100));
    const text = (wert: unknown, max = 200) => String(wert ?? "").slice(0, max);
    const zahl = (wert: unknown) => (wert == null || wert === "" || !Number.isFinite(Number(wert)) ? null : Number(wert));

    const neu = positionen.map((p, i) => {
      const alt = p.id ? vorher.get(p.id) : undefined;
      const sorte = sorteSaeubern(p.sorte == null ? null : text(p.sorte, 60));
      const name = text(p.name);
      const geaendert = !alt || alt.gruppe_id !== p.gruppe_id || alt.name !== name || (alt.sorte ?? null) !== sorte;
      return {
        bon_id: id,
        nr: i + 1,
        text_roh: text(p.text_roh) || name,
        name,
        sorte,
        menge: zahl(p.menge),
        einheit: p.einheit == null ? null : text(p.einheit, 20),
        einzelpreis_cent: zahl(p.einzelpreis_cent) == null ? null : Math.round(Number(p.einzelpreis_cent)),
        betrag_cent: Math.round(zahl(p.betrag_cent) ?? 0),
        gruppe_id: p.gruppe_id ?? null,
        gruppe_quelle: geaendert ? "hand" : (alt?.gruppe_quelle ?? "hand"),
        // bleibt markiert, bis der Benutzer die Position ändert oder bestätigt (die Oberfläche schickt dann false)
        unsicher: Boolean(p.unsicher),
        lernen: geaendert && p.gruppe_id != null,
      };
    });

    await sql.begin(async (tx) => {
      await tx`delete from positionen where bon_id = ${id}`;
      if (neu.length) await tx`insert into positionen ${tx(neu.map(({ lernen: _, ...p }) => p))}`;
      await tx`
        update bons set haendler_id = ${haendlerId}, datum = ${datum}, summe_cent = ${summe_cent}, notiz = ${notiz == null ? null : text(notiz, 1000)},
               zahlung = ${zahlung}, zahlung_quelle = ${zahlungQuelle},
               actual_konto_id = ${konto}, konto_quelle = ${kontoQuelle},
               status = case when status = 'gebucht' then 'gebucht' else 'geprueft' end, geaendert_am = now()
         where id = ${id} and haushalt_id = ${h}`;
    });
    for (const p of neu) if (p.lernen) await regelLernen(h, p.text_roh, p.gruppe_id!, p.name, p.sorte);

    // Konto von Hand zu einer Karte gewählt -> für künftige Bons merken
    if (kontoQuelle === "hand" && konto && zahlung === "karte" && alt.karte_endziffern) {
      await sql`insert into kartenzuordnung (haushalt_id, endziffern, actual_konto_id) values (${h}, ${alt.karte_endziffern}, ${konto})
                on conflict (haushalt_id, endziffern) do update set actual_konto_id = excluded.actual_konto_id`;
    }

    // korrigierte Angaben können ein Duplikat erst sichtbar machen (oder auflösen)
    await duplikatPruefen(id);
    // korrigiertes Geschäft / Summe gegen den gespeicherten Text der Gegenprüfung halten
    await gegenpruefungAktualisieren(id);
    // Ablagename an korrigiertes Datum/Händler/Summe anpassen
    const [bon] = await sql<{ datei_pfad: string }[]>`select datei_pfad from bons where id = ${id}`;
    if (!bon.datei_pfad.startsWith("eingang/")) await bonAblegen(id);

    // direkt buchen (bar) bzw. passende Abbuchung suchen (Karte)
    let abgleich: AbgleichErgebnis | { ergebnis: "fehler"; text: string } | null = null;
    if (alt.status === "gebucht") {
      // schon in Actual: geänderte Gruppen/Beträge dort nachziehen (alte Aufteilung zurücknehmen, neu aufteilen)
      if (aufteilung(neu, summe_cent) !== aufteilungVorher) {
        try {
          await neuAufteilen(h, id);
          abgleich = { ergebnis: "gebucht", text: t("Die Aufteilung in Actual wurde angepasst.") };
        } catch (fehler) {
          abgleich = { ergebnis: "fehler", text: t("Actual konnte nicht angepasst werden: {meldung}", { meldung: t((fehler as Error).message) }) };
        }
      }
    } else if ((await actualEinstellung(h)).autoBuchen) {
      try {
        abgleich = await abgleichen(h, id);
      } catch (fehler) {
        abgleich = { ergebnis: "fehler", text: (fehler as Error).message };
      }
    }
    return { ok: true, abgleich };
  });

  // nach einem Bankimport in Actual: alle offenen Bons zuordnen
  app.post("/api/abgleich", async (req) => alleAbgleichen(zugriff(req, "bons_bearbeiten")));
  app.post<{ Params: { id: string } }>("/api/bons/:id/abgleich", async (req) => {
    const id = idVon(req.params.id);
    return abgleichen(await bonBearbeitbar(req, id), id);
  });

  // „Kein Duplikat“: Markierung aufheben und nicht wieder setzen
  app.post<{ Params: { id: string } }>("/api/bons/:id/kein-duplikat", async (req) => {
    const id = idVon(req.params.id);
    const h = await bonBearbeitbar(req, id);
    await sql`update bons set dublette_von = null, dublette_ok = true, abgleich_hinweis = null where id = ${id} and haushalt_id = ${h}`;
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { anbieter?: string; modell?: string } }>("/api/bons/:id/neu-erkennen", async (req) => {
    const id = idVon(req.params.id);
    const h = await bonBearbeitbar(req, id);
    // bestimmtes Claude-Modell nur aus der festen Liste (Kosten!)
    const modell = req.body?.modell ? CLAUDE_MODELLE.find((m) => m.id === req.body.modell)?.id : undefined;
    if (req.body?.modell && !modell) throw httpFehler(400, "Unbekanntes Modell");
    if (modell && !process.env.ANTHROPIC_API_KEY) throw httpFehler(400, "Für Claude ist kein API-Schlüssel hinterlegt");
    if (modell) {
      // Kostenschutz schon hier prüfen, damit die Meldung direkt beim Klick erscheint
      const [letzter] = await sql<{ ein: number; aus: number }[]>`
        select coalesce(eingabe_tokens, 0) + coalesce(cache_tokens, 0) as ein, coalesce(ausgabe_tokens, 0) as aus
          from ki_aufrufe where bon_id = ${id} and anbieter = 'claude' order by zeit desc limit 1`;
      try {
        await kostenPruefen(id, letzter ? (kostenSchaetzen(modell, letzter.ein, letzter.aus) ?? 0) : 0);
      } catch (e) {
        throw httpFehler(400, (e as Error).message);
      }
    }
    await sql`update bons set status = 'neu', fehler = null where id = ${id} and haushalt_id = ${h}`;
    const anbieter = (["claude", "ollama", "tesseract"] as const).find((a) => a === req.body?.anbieter);
    einreihen(id, anbieter, modell);
    return { ok: true };
  });

  // Löschen: mit Bearbeitungsrecht alle, sonst eigene noch nicht gebuchte Bons.
  // ?actual=behalten lässt die Buchung in Actual unverändert, sonst wird sie zurückgenommen.
  app.delete<{ Params: { id: string }; Querystring: { actual?: string } }>("/api/bons/:id", async (req) => {
    const id = idVon(req.params.id);
    const h = zugriff(req);
    const darfAlle = req.nutzer!.rechte!.bons_bearbeiten;
    const [vorhanden] = await sql<{ actual_tx_id: string | null; sammel: boolean }[]>`
      select actual_tx_id, sammel from bons where id = ${id} and haushalt_id = ${h}
         and (${darfAlle} or (hochgeladen_von = ${req.nutzer!.id} and status <> 'gebucht'))`;
    if (!vorhanden) throw httpFehler(404, "Bon nicht gefunden");
    let actual: string | null = null;
    if (vorhanden.actual_tx_id && req.query.actual !== "behalten") {
      // erst Actual zurücknehmen; schlägt das fehl, bleibt der Bon erhalten
      const fehlschlag = (e: Error) => {
        throw httpFehler(502, t("Actual: {meldung} – Bon wurde nicht gelöscht", { meldung: e.message }));
      };
      if (vorhanden.sammel) {
        // Sammelbuchung: Aufteilung zurücknehmen, die übrigen Bons wieder zum Zuordnen öffnen
        await sammelAufloesen(h, id, t("Sammelbuchung aufgelöst, weil Bon {nr} gelöscht wurde – bitte neu zuordnen.", { nr: id })).catch(fehlschlag);
        actual = t("Sammelbuchung in Actual aufgelöst");
      } else {
        actual = await actualZuruecknehmen(h, id).catch(fehlschlag);
      }
    }
    const [bon] = await sql<{ datei_pfad: string }[]>`delete from bons where id = ${id} and haushalt_id = ${h} returning datei_pfad`;
    if (bon) await fsp.rm(absoluterPfad(bon.datei_pfad, await ablageVon(h)), { force: true });
    return { ok: true, actual };
  });

  app.get<{ Params: { id: string } }>("/api/bons/:id/kandidaten", async (req) => {
    const id = idVon(req.params.id);
    return kandidatenSuchen(await bonBearbeitbar(req, id), id);
  });

  app.post<{ Params: { id: string }; Body: { transaktionId?: string; budget?: string; neuKontoId?: string } }>(
    "/api/bons/:id/buchen",
    async (req, antwort) => {
      const id = idVon(req.params.id);
      const h = await bonBearbeitbar(req, id);
      if (req.body?.transaktionId) {
        // Abbuchung aus einem weiteren Buchungs-Budget (z. B. Haushaltskonto)? Nur erlaubte Budgets
        const budgets = await buchungsBudgets(h);
        const budget = req.body.budget && budgets.includes(String(req.body.budget)) ? String(req.body.budget) : budgets[0];
        await aufBuchungVerteilen(h, id, String(req.body.transaktionId), budget);
      }
      else if (req.body?.neuKontoId) await barBuchen(h, id, String(req.body.neuKontoId));
      else return antwort.code(400).send({ fehler: "transaktionId oder neuKontoId angeben" });
      return { ok: true };
    },
  );

  // Sammelbuchung: mehrere Bons, eine Abbuchung (z. B. mehrere Amazon-Rechnungen)
  const bonListe = (wert: unknown) => {
    const ids = (Array.isArray(wert) ? wert : String(wert ?? "").split(",")).map((x) => Number(x));
    if (!ids.length || ids.some((x) => !Number.isInteger(x) || x <= 0)) throw httpFehler(400, "Ungültige ID");
    return ids;
  };
  const sammelFehler = (e: Error) => {
    throw httpFehler(400, e.message);
  };
  app.get<{ Querystring: { bons?: string } }>("/api/sammelbuchung/kandidaten", async (req) => {
    const h = zugriff(req, "bons_bearbeiten");
    return sammelKandidatenSuchen(h, bonListe(req.query.bons)).catch(sammelFehler);
  });
  app.post<{ Body: { bonIds?: number[]; transaktionId?: string; budget?: string } }>("/api/sammelbuchung", async (req) => {
    const h = zugriff(req, "bons_bearbeiten");
    const ids = bonListe(req.body?.bonIds);
    if (!req.body?.transaktionId) throw httpFehler(400, "transaktionId angeben");
    // Kandidaten neu prüfen: nur eine Abbuchung, die genau der Summe entspricht und noch frei ist
    const { kandidaten } = await sammelKandidatenSuchen(h, ids).catch(sammelFehler);
    const wahl = kandidaten.find((k) => k.id === req.body.transaktionId && (!req.body.budget || k.budget === req.body.budget));
    if (!wahl) throw httpFehler(400, t("Die Abbuchung passt nicht (mehr) zur Summe der Bons"));
    if (wahl.aufgeteilt) throw httpFehler(400, t("Die Buchung ist in Actual bereits aufgeteilt – dort zuerst die Aufteilung aufheben"));
    await aufBuchungVerteilen(h, ids, wahl.id, wahl.budget);
    return { ok: true };
  });
  app.get("/api/sammelbuchung/vorschlaege", async (req) => sammelVorschlaege(zugriff(req, "bons_bearbeiten")));
  app.post<{ Params: { id: string } }>("/api/sammelbuchung/vorschlaege/:id/buchen", async (req) => {
    const h = zugriff(req, "bons_bearbeiten");
    await sammelVorschlagBuchen(h, idVon(req.params.id)).catch(sammelFehler);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/sammelbuchung/vorschlaege/:id/verwerfen", async (req) => {
    const h = zugriff(req, "bons_bearbeiten");
    await sql`update sammel_vorschlaege set verworfen = true where id = ${idVon(req.params.id)} and haushalt_id = ${h}`;
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/bons/:id/sammel-aufloesen", async (req) => {
    const id = idVon(req.params.id);
    const h = await bonBearbeitbar(req, id);
    if ((await buchungsBons(h, id)).length < 2) throw httpFehler(400, t("Der Bon gehört zu keiner Sammelbuchung"));
    await sammelAufloesen(h, id);
    return { ok: true };
  });
}
