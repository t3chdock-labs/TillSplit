import { actualEinstellung, kontoZurKarte } from "./actual.js";
import { config } from "./config.js";
import { bonsGelesen } from "./benachrichtigungen.js";
import { bekannteHaendler, bewerten, textFuerPruefung } from "./gegenpruefung.js";
import { sql } from "./db.js";
import { t } from "./i18n.js";
import { ablageVon, absoluterPfad, bonAblegen, dateiLesen, fuerKiZerlegen } from "./dateien.js";
import { erkennen, kiEinstellung, kostenPruefen, type KiAnbieter, type KiEingabe } from "./ki/index.js";
import { kostenSchaetzen, type KiVerbrauch } from "./ki/kosten.js";
import type { BonErgebnis } from "./ki/schema.js";
import { musterVon, regelnFinden, trefferZaehlen } from "./regeln.js";

const cent = (euro: number | null | undefined) => (euro == null ? null : Math.round(euro * 100));

export async function untergruppenLaden(haushaltId: number) {
  return sql<{ id: number; name: string; haupt: string }[]>`
    select u.id, u.name, h.name as haupt
      from gruppen u join gruppen h on h.id = u.eltern_id
     where u.haushalt_id = ${haushaltId}
     order by h.sortierung, u.sortierung, u.name`;
}

export async function haendlerFinden(name: string): Promise<number> {
  const sauber = name.trim().replace(/\s+/g, " ") || t("Unbekannt");
  const [vorhanden] = await sql<{ id: number }[]>`select id from haendler where lower(name) = lower(${sauber})`;
  if (vorhanden) return vorhanden.id;
  const [neu] = await sql<{ id: number }[]>`
    insert into haendler (name) values (${sauber})
    on conflict (name) do update set name = excluded.name returning id`;
  return neu.id;
}

/** Häufigste bisherige Sorten, damit die KI einheitliche Namen verwendet */
async function bekannteSorten(haushaltId: number): Promise<string[]> {
  const zeilen = await sql<{ sorte: string }[]>`
    select p.sorte from positionen p join bons b on b.id = p.bon_id
     where b.haushalt_id = ${haushaltId} and p.sorte is not null and p.sorte <> '' group by p.sorte order by count(*) desc limit 400`;
  return zeilen.map((z) => z.sorte);
}

/** Stimmt die Summe der Positionen mit der Bonsumme überein (±2 Cent Rundung)? */
function summePasst(ergebnis: { summe: number; positionen: { betrag: number }[] }): boolean {
  if (!ergebnis.positionen.length) return false;
  const positionen = Math.round(ergebnis.positionen.reduce((s, p) => s + p.betrag, 0) * 100);
  return Math.abs(positionen - Math.round(ergebnis.summe * 100)) <= 2;
}

/**
 * KI-Ergebnis auf plausible Werte begrenzen. Der Inhalt eines Belegs stammt vom Hochladenden und könnte
 * versuchen, das Modell zu manipulieren; die Antwort ist deshalb nur Datenvorschlag und wird hier gekürzt.
 */
function kiErgebnisBegrenzen<T extends BonErgebnis>(e: T): T {
  const text = (w: string | null, max: number) => (w == null ? null : w.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max));
  const betrag = (w: number) => (Number.isFinite(w) ? Math.max(-100_000, Math.min(100_000, w)) : 0);
  const heute = new Date();
  const datumOk = e.datum && /^\d{4}-\d{2}-\d{2}$/.test(e.datum) && e.datum >= "2000-01-01" && Date.parse(e.datum) <= heute.getTime() + 7 * 86_400_000;
  return {
    ...e,
    haendler: text(e.haendler, 100) || t("Unbekannt"),
    filiale: text(e.filiale, 200),
    datum: datumOk ? e.datum : null,
    uhrzeit: e.uhrzeit && /^\d{1,2}:\d{2}/.test(e.uhrzeit) ? e.uhrzeit.slice(0, 5) : null,
    summe: betrag(e.summe),
    zahlart: text(e.zahlart, 50),
    karte_endziffern: e.karte_endziffern?.replace(/\D/g, "").slice(-4) || null,
    positionen: e.positionen.slice(0, 300).map((p) => ({
      ...p,
      text: text(p.text, 200) ?? "",
      name: text(p.name, 120) || text(p.text, 120) || t("Position"),
      sorte: text(p.sorte, 60),
      einheit: text(p.einheit, 20),
      menge: p.menge != null && Number.isFinite(p.menge) ? Math.max(-10_000, Math.min(10_000, p.menge)) : null,
      einzelpreis: p.einzelpreis != null ? betrag(p.einzelpreis) : null,
      betrag: betrag(p.betrag),
    })),
  };
}

/** Namen, mit denen die KI unlesbare Zeilen füllt */
const PLATZHALTER = /unbekannt|unleserlich|unknown|unreadable|illegible/i;

export function sorteSaeubern(sorte: string | null | undefined): string | null {
  const s = sorte?.trim().replace(/\s+/g, " ");
  return s ? s[0].toLocaleUpperCase("de-DE") + s.slice(1) : null;
}

/**
 * Zweites Foto desselben Einkaufs erkennen: gleicher Händler, gleiches Datum, gleiche Summe
 * (und gleiche Uhrzeit, wenn beide eine haben). Markiert wird immer der neuere Bon.
 */
export async function duplikatPruefen(bonId: number): Promise<void> {
  await sql`
    update bons b set dublette_von = (
      select a.id from bons a
       where a.haushalt_id = b.haushalt_id and a.id <> b.id and a.id < b.id
         and a.haendler_id = b.haendler_id and a.datum = b.datum and a.summe_cent = b.summe_cent
         and (a.uhrzeit is null or b.uhrzeit is null or a.uhrzeit = b.uhrzeit)
         and a.status <> 'fehler'
       order by a.id limit 1)
     where b.id = ${bonId} and not b.dublette_ok and b.datum is not null and b.summe_cent is not null`;
}

/** Jede KI-Anfrage für die Kostenstatistik festhalten */
async function aufrufMerken(
  h: number, bonId: number, anlass: "erkennung" | "nachlesen" | "manuell",
  lauf: { anbieter: string; modell: string; verbrauch: KiVerbrauch; sekunden: number },
): Promise<void> {
  const v = lauf.verbrauch;
  await sql`
    insert into ki_aufrufe (haushalt_id, bon_id, anlass, anbieter, modell, eingabe_tokens, ausgabe_tokens, cache_tokens, kosten_usd, sekunden)
    values (${h}, ${bonId}, ${anlass}, ${lauf.anbieter}, ${lauf.modell}, ${v.eingabe + v.cacheGeschrieben}, ${v.ausgabe},
            ${v.cacheGelesen}, ${v.kostenUsd}, ${Math.round(lauf.sekunden * 10) / 10})`;
}

/** Bon lesen; true = erkannt, false = Fehler, null = Bon gibt es nicht mehr */
async function bonVerarbeiten(bonId: number, anbieter?: KiAnbieter, zwischenspeichern = false, modellWahl?: string): Promise<boolean | null> {
  const [bon] = await sql<{
    haushalt_id: number; datei_pfad: string; datei_mime: string; status: string;
    zahlung: string; zahlung_quelle: string; actual_konto_id: string | null; konto_quelle: string | null;
  }[]>`
    update bons set status = 'in_arbeit', fehler = null, geaendert_am = now()
     where id = ${bonId} returning haushalt_id, datei_pfad, datei_mime, status, zahlung, zahlung_quelle, actual_konto_id, konto_quelle`;
  if (!bon) return null;

  const h = bon.haushalt_id;
  try {
    const ablage = await ablageVon(h);
    const puffer = await dateiLesen(absoluterPfad(bon.datei_pfad, ablage));
    const eingabe: KiEingabe =
      bon.datei_mime === "application/pdf"
        ? { art: "pdf", pdf: puffer }
        : { art: "bilder", bilder: await fuerKiZerlegen(puffer), original: puffer };

    const untergruppen = await untergruppenLaden(h);
    const sorten = await bekannteSorten(h);
    // Kostenschutz: Monats- und Bon-Limit vor jeder Claude-Anfrage
    const ki = await kiEinstellung();
    const nutztClaude = modellWahl || (anbieter ?? ki.anbieter) === "claude" || ((anbieter ?? ki.anbieter) === "tesseract" && ki.textModellAnbieter === "claude");
    if (nutztClaude) await kostenPruefen(bonId);
    const erster = await erkennen(eingabe, untergruppen, modellWahl ? "claude" : anbieter, sorten, { zwischenspeichern, modell: modellWahl });
    let { ergebnis, modell, verbrauch, sekunden } = erster;
    const genutzt = erster.anbieter;
    await aufrufMerken(h, bonId, modellWahl ? "manuell" : "erkennung", erster);
    // Günstiges Modell vertan (Positionen ≠ Summe)? Je nach Einstellung gleich mit dem stärkeren Modell nachlesen –
    // sonst nur markieren, der Benutzer gibt das teurere Modell am Bon frei.
    const nachpruefen = ki.nachleseModell;
    if (!modellWahl && genutzt === "claude" && ki.nachlesen === "automatisch" && !modell.startsWith(nachpruefen) && !summePasst(ergebnis)) {
      console.log(`Bon ${bonId}: Positionen passen nicht zur Summe – lese mit ${nachpruefen} nach`);
      await kostenPruefen(bonId, kostenSchaetzen(nachpruefen, verbrauch.eingabe + verbrauch.cacheGeschrieben + verbrauch.cacheGelesen, verbrauch.ausgabe) ?? 0);
      const zweiter = await erkennen(eingabe, untergruppen, "claude", sorten, { modell: nachpruefen, zwischenspeichern });
      await aufrufMerken(h, bonId, "nachlesen", zweiter);
      if (summePasst(zweiter.ergebnis) || !summePasst(ergebnis)) {
        ergebnis = zweiter.ergebnis;
        modell = zweiter.modell;
      }
      verbrauch = {
        eingabe: verbrauch.eingabe + zweiter.verbrauch.eingabe,
        ausgabe: verbrauch.ausgabe + zweiter.verbrauch.ausgabe,
        cacheGeschrieben: verbrauch.cacheGeschrieben + zweiter.verbrauch.cacheGeschrieben,
        cacheGelesen: verbrauch.cacheGelesen + zweiter.verbrauch.cacheGelesen,
        kostenUsd: (verbrauch.kostenUsd ?? 0) + (zweiter.verbrauch.kostenUsd ?? 0),
      };
      sekunden += zweiter.sekunden;
    }
    console.log(
      `Bon ${bonId}: ${modell}, ${verbrauch.eingabe + verbrauch.cacheGeschrieben} Ein- (${verbrauch.cacheGelesen} aus Cache) / ` +
        `${verbrauch.ausgabe} Ausgabe-Tokens, ${verbrauch.kostenUsd?.toFixed(4) ?? "?"} $, ${sekunden.toFixed(1)} s`,
    );
    if (!ergebnis.ist_bon) throw new Error(t("Das Dokument sieht nicht wie ein Kassenbon aus"));
    // Antwort der KI nie ungeprüft übernehmen: Längen, Anzahl und Beträge begrenzen
    ergebnis = kiErgebnisBegrenzen(ergebnis);

    const haendlerId = await haendlerFinden(ergebnis.haendler);
    const gruppeVonName = new Map(untergruppen.map((g) => [g.name, g.id]));
    const muster = ergebnis.positionen.map((p) => musterVon(p.text));
    const regeln = await regelnFinden(h, muster, haendlerId);

    const positionen = ergebnis.positionen.map((p, i) => {
      const regel = regeln.get(muster[i]);
      return {
        bon_id: bonId,
        nr: i + 1,
        text_roh: p.text,
        name: regel?.name ?? p.name,
        sorte: regel?.sorte ?? sorteSaeubern(p.sorte),
        menge: p.menge,
        einheit: p.einheit,
        einzelpreis_cent: cent(p.einzelpreis),
        betrag_cent: cent(p.betrag) ?? 0,
        gruppe_id: regel?.gruppe_id ?? gruppeVonName.get(p.gruppe) ?? null,
        gruppe_quelle: regel ? "regel" : "ki",
        // gelernte Zuordnung ist sicher; sonst Hinweis der KI oder Platzhalter-Name („Unbekannter Artikel“)
        unsicher: !regel && (Boolean(p.unsicher) || PLATZHALTER.test(p.name)),
      };
    });
    await trefferZaehlen(h, [...new Set(muster.filter((m) => regeln.has(m)))]);

    const datum = ergebnis.datum && /^\d{4}-\d{2}-\d{2}$/.test(ergebnis.datum) ? ergebnis.datum : null;
    const summeCent = cent(ergebnis.summe);

    // Zahlart und Konto: Vorgaben vom Hochladen haben Vorrang, sonst Karte auf dem Bon
    const endziffern = ergebnis.karte_endziffern?.replace(/\D/g, "").match(/\d{4}$/)?.[0] ?? null;
    const zahlung = bon.zahlung_quelle === "hand" ? bon.zahlung : ergebnis.zahlung;
    let konto = bon.actual_konto_id;
    let kontoQuelle = bon.konto_quelle;
    if (kontoQuelle !== "hand") {
      const kartenKonto = await kontoZurKarte(h, endziffern);
      const bargeld = zahlung === "bar" ? (await actualEinstellung(h)).bargeldKonto : null;
      konto = kartenKonto ?? bargeld;
      kontoQuelle = kartenKonto ? "karte" : bargeld ? "bargeld" : null;
    }


    await sql.begin(async (tx) => {
      await tx`delete from positionen where bon_id = ${bonId}`;
      if (positionen.length) await tx`insert into positionen ${tx(positionen)}`;
      await tx`
        update bons set
          status = 'erkannt', haendler_id = ${haendlerId}, filiale = ${ergebnis.filiale}, datum = ${datum},
          uhrzeit = ${ergebnis.uhrzeit}, summe_cent = ${summeCent}, zahlart = ${ergebnis.zahlart},
          zahlung = ${zahlung}, karte_endziffern = ${endziffern}, actual_konto_id = ${konto}, konto_quelle = ${kontoQuelle},
          ki_anbieter = ${genutzt}, ki_modell = ${modell}, ki_rohdaten = ${tx.json(ergebnis as never)},
          ki_eingabe_tokens = ${verbrauch.eingabe + verbrauch.cacheGeschrieben}, ki_ausgabe_tokens = ${verbrauch.ausgabe},
          ki_cache_tokens = ${verbrauch.cacheGelesen}, ki_sekunden = ${sekunden}, ki_summe_passt = ${summePasst(ergebnis)},
          -- Kosten aller Lesevorgänge dieses Bons zusammen (auch früheres Nachlesen)
          ki_kosten_usd = (select sum(kosten_usd) from ki_aufrufe where bon_id = ${bonId}),
          geaendert_am = now()
         where id = ${bonId}`;
    });
    // Gegenprüfung: Tesseract liest das Bild unabhängig von der KI – passen Geschäft oder Summe dazu?
    if (ki.gegenpruefung) {
      const pruefText = await textFuerPruefung(eingabe);
      await sql`update bons set pruef_text = ${pruefText}, gegenpruefung = ${bewerten(pruefText, ergebnis.haendler, summeCent, await bekannteHaendler())} where id = ${bonId}`;
    }
    await duplikatPruefen(bonId);
    // nach der Vorlage des Haushalts ablegen (aus dem Eingang in die Bon-Ablage)
    await bonAblegen(bonId);
    return true;
  } catch (fehler) {
    // feste Meldungen (ohne t() geworfen) hier übersetzen
    const text = t(fehler instanceof Error ? fehler.message : String(fehler));
    console.error(`Bon ${bonId}: ${text}`);
    await sql`update bons set status = 'fehler', fehler = ${text}, geaendert_am = now() where id = ${bonId}`;
    return false;
  }
}

// Einfache Warteschlange: ein Bon nach dem anderen (schont API-Limits und den Ollama-Laptop)
const warteschlange: { bonId: number; anbieter?: KiAnbieter; modell?: string }[] = [];
let laeuft = false;
// Zwischenspeicher der Claude-Anweisung lebt 5 Minuten ab Beginn der letzten Anfrage, die ihn nutzte
let cacheBis = 0;

/** Bon in die Warteschlange; `modell` erzwingt ein bestimmtes Claude-Modell (manuelles Nachlesen) */
export function einreihen(bonId: number, anbieter?: KiAnbieter, modell?: string): void {
  if (!warteschlange.some((e) => e.bonId === bonId)) warteschlange.push({ bonId, anbieter, modell });
  // kurz warten, damit bei mehreren Dateien auf einmal alle in der Schlange stehen (für den Zwischenspeicher)
  setTimeout(() => void abarbeiten(), 2000);
}

async function abarbeiten(): Promise<void> {
  if (laeuft) return;
  laeuft = true;
  // ein Lesedurchgang (bis die Schlange leer ist) ergibt eine einzige Benachrichtigung
  const ergebnisse: { bonId: number; ok: boolean }[] = [];
  try {
    while (warteschlange.length) {
      const { bonId, anbieter, modell } = warteschlange.shift()!;
      // Nur zwischenspeichern, wenn weitere Bons warten oder der Speicher noch warm ist –
      // bei einem einzelnen Bon wäre das Schreiben 25 % teurer und würde nie gelesen
      const zwischenspeichern = warteschlange.length > 0 || Date.now() < cacheBis;
      if (zwischenspeichern) cacheBis = Date.now() + 4.5 * 60_000;
      const ok = await bonVerarbeiten(bonId, anbieter, zwischenspeichern, modell);
      if (ok != null) ergebnisse.push({ bonId, ok });
    }
  } finally {
    laeuft = false;
    void bonsGelesen(ergebnisse);
  }
}

/** Nach einem Neustart liegengebliebene Bons wieder aufnehmen. */
export async function offeneWiederaufnehmen(): Promise<void> {
  const offen = await sql<{ id: number }[]>`select id from bons where status in ('neu','in_arbeit') order by id`;
  for (const { id } of offen) einreihen(id);
}
