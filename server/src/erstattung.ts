import crypto from "node:crypto";
import { abgleichen, actualEinstellung, type AbgleichErgebnis } from "./actual.js";
import { config } from "./config.js";
import { ablageVon, absoluterPfad, bonAblegen, dateiLesen, dateiSchreiben } from "./dateien.js";
import { sql } from "./db.js";
import { t } from "./i18n.js";
import { duplikatPruefen } from "./verarbeitung.js";

/**
 * Erstattungen: Belege über zurückbekommenes Geld (Rücksendung, Gutschrift). Sie tragen negative Beträge,
 * hängen am ursprünglichen Bon und werden dem Geldeingang in Actual zugeordnet – auf dieselben Bereiche wie der Kauf.
 */

type Pos = {
  id: number; bon_id: number; betrag_cent: number; einzelpreis_cent: number | null;
  gruppe_id: number | null; gruppe_quelle: string; name: string; sorte: string | null; text_roh: string;
};

export type UrsprungKandidat = {
  id: number; datum: string | null; summe_cent: number; haendler: string | null;
  /** woran der Bon als Ursprung erkannt wurde; null = nur gleiches Geschäft */
  treffer: "bestellnummer" | "positionen" | "summe" | null;
};

/**
 * Erstattete Positionen den gekauften zuordnen: gleicher Betrag oder – bei einer Teilmenge – gleicher Einzelpreis.
 * Liefert null, sobald eine erstattete Position im Kauf nicht vorkommt.
 */
function positionenZuordnen(erstattet: Pos[], gekauft: Pos[]): Map<number, Pos> | null {
  const zurueck = erstattet.filter((p) => p.betrag_cent < 0).sort((a, b) => a.betrag_cent - b.betrag_cent);
  if (!zurueck.length) return null;
  const frei = new Set(gekauft.filter((p) => p.betrag_cent > 0));
  const paare = new Map<number, Pos>();
  for (const p of zurueck) {
    const betrag = -p.betrag_cent;
    const genau = [...frei].find((k) => k.betrag_cent === betrag);
    // drei Stück gekauft, eines zurück: der Einzelpreis passt, die Position bleibt für weitere Stücke frei
    const teil = genau ?? [...frei].find((k) => k.einzelpreis_cent === betrag && k.betrag_cent > betrag);
    if (!teil) return null;
    if (genau) frei.delete(genau);
    paare.set(p.id, teil);
  }
  return paare;
}

async function positionenLaden(bonIds: number[]): Promise<Pos[]> {
  if (!bonIds.length) return [];
  return sql<Pos[]>`
    select id, bon_id, betrag_cent, einzelpreis_cent, gruppe_id, gruppe_quelle, name, sorte, text_roh
      from positionen where bon_id in ${sql(bonIds)} order by bon_id, nr`;
}

/**
 * Mögliche Ursprungsbons einer Erstattung: gleiche Bestellnummer, sonst Käufe im selben Geschäft
 * aus dem Jahr davor. Die besten Treffer zuerst.
 */
export async function ursprungKandidaten(haushaltId: number, bonId: number): Promise<UrsprungKandidat[]> {
  const [e] = await sql<{ datum: string | null; summe_cent: number | null; haendler_id: number | null; bestellnummer: string | null }[]>`
    select to_char(datum, 'YYYY-MM-DD') as datum, summe_cent, haendler_id, bestellnummer
      from bons where id = ${bonId} and haushalt_id = ${haushaltId} and erstattung`;
  if (!e) return [];
  const bons = await sql<{ id: number; datum: string | null; summe_cent: number; haendler: string | null; bestellnummer: string | null }[]>`
    select b.id, to_char(b.datum, 'YYYY-MM-DD') as datum, b.summe_cent, h.name as haendler, b.bestellnummer
      from bons b left join haendler h on h.id = b.haendler_id
     where b.haushalt_id = ${haushaltId} and b.id <> ${bonId} and not b.erstattung and b.summe_cent > 0
       and b.status in ('erkannt','geprueft','wartet','gebucht') and b.dublette_von is null
       and ((${e.bestellnummer}::text is not null and b.bestellnummer = ${e.bestellnummer})
            or (b.haendler_id = ${e.haendler_id}
                and (${e.datum}::date is null or b.datum is null
                     or (b.datum <= ${e.datum}::date and b.datum >= ${e.datum}::date - 365))))
     order by b.datum desc nulls last, b.id desc limit 80`;
  if (!bons.length) return [];
  const positionen = await positionenLaden([bonId, ...bons.map((b) => b.id)]);
  const erstattet = positionen.filter((p) => p.bon_id === bonId);
  const rang = { bestellnummer: 0, positionen: 1, summe: 2 } as const;
  return bons
    .map((b): UrsprungKandidat => ({
      id: b.id,
      datum: b.datum,
      summe_cent: b.summe_cent,
      haendler: b.haendler,
      treffer:
        e.bestellnummer && b.bestellnummer === e.bestellnummer ? "bestellnummer"
        : positionenZuordnen(erstattet, positionen.filter((p) => p.bon_id === b.id)) ? "positionen"
        : e.summe_cent != null && b.summe_cent === -e.summe_cent ? "summe"
        : null,
    }))
    .sort((x, y) => (x.treffer ? rang[x.treffer] : 3) - (y.treffer ? rang[y.treffer] : 3))
    .slice(0, 12);
}

/**
 * Ursprungsbon automatisch verknüpfen – nur wenn er eindeutig ist: genau ein Bon mit derselben Bestellnummer,
 * sonst genau ein Kauf im selben Geschäft, in dem die erstatteten Positionen (oder die ganze Summe) vorkommen.
 */
export async function ursprungSuchen(haushaltId: number, bonId: number): Promise<number | null> {
  const [bon] = await sql<{ erstattung_von: number | null; erstattung_fest: boolean }[]>`
    select erstattung_von, erstattung_fest from bons where id = ${bonId} and haushalt_id = ${haushaltId} and erstattung`;
  if (!bon || bon.erstattung_von || bon.erstattung_fest) return bon?.erstattung_von ?? null;
  const kandidaten = await ursprungKandidaten(haushaltId, bonId);
  const mitNummer = kandidaten.filter((k) => k.treffer === "bestellnummer");
  let wahl: UrsprungKandidat | undefined;
  if (mitNummer.length === 1) wahl = mitNummer[0];
  else if (mitNummer.length > 1) {
    // eine Bestellung, mehrere Rechnungen (Teillieferungen): die mit den erstatteten Positionen
    const positionen = await positionenLaden([bonId, ...mitNummer.map((k) => k.id)]);
    const erstattet = positionen.filter((p) => p.bon_id === bonId);
    const passend = mitNummer.filter((k) => positionenZuordnen(erstattet, positionen.filter((p) => p.bon_id === k.id)));
    if (passend.length === 1) wahl = passend[0];
  } else {
    const passend = kandidaten.filter((k) => k.treffer === "positionen" || k.treffer === "summe");
    if (passend.length === 1) wahl = passend[0];
  }
  if (!wahl) return null;
  await ursprungSetzen(haushaltId, bonId, wahl.id, false);
  return wahl.id;
}

/**
 * Erstattung mit ihrem Ursprungsbon verknüpfen (oder die Verknüpfung lösen). Solange die Erstattung noch nicht
 * gebucht ist, übernehmen ihre Positionen Gruppe und Sorte des Kaufs – so landet das Geld in denselben Bereichen.
 */
export async function ursprungSetzen(haushaltId: number, bonId: number, ursprungId: number | null, vonHand = true): Promise<void> {
  const [bon] = await sql<{ status: string }[]>`select status from bons where id = ${bonId} and haushalt_id = ${haushaltId} and erstattung`;
  if (!bon) throw new Error(t("Der Bon ist keine Erstattung"));
  if (ursprungId != null) {
    const [ursprung] = await sql`select 1 from bons where id = ${ursprungId} and haushalt_id = ${haushaltId} and not erstattung and id <> ${bonId}`;
    if (!ursprung) throw new Error(t("Ursprungsbon nicht gefunden"));
  }
  await sql`
    update bons set erstattung_von = ${ursprungId}, erstattung_fest = erstattung_fest or ${vonHand}, geaendert_am = now()
     where id = ${bonId} and haushalt_id = ${haushaltId}`;
  if (ursprungId != null && bon.status !== "gebucht") {
    const positionen = await positionenLaden([bonId, ursprungId]);
    const paare = positionenZuordnen(positionen.filter((p) => p.bon_id === bonId), positionen.filter((p) => p.bon_id === ursprungId));
    for (const p of positionen.filter((x) => x.bon_id === bonId)) {
      const kauf = paare?.get(p.id);
      // von Hand gewählte Gruppen bleiben
      if (!kauf?.gruppe_id || p.gruppe_quelle === "hand") continue;
      await sql`update positionen set gruppe_id = ${kauf.gruppe_id}, sorte = ${kauf.sorte ?? p.sorte}, gruppe_quelle = 'regel', unsicher = false where id = ${p.id}`;
    }
  }
  await duplikatPruefen(bonId);
}

/**
 * Rückgabe am gekauften Bon erfassen (ohne eigenen Beleg): legt eine Erstattung mit den gewählten Positionen an,
 * die auf die Gutschrift in Actual wartet. Als Bild dient eine Kopie des Kaufbelegs.
 */
export async function rueckgabeAnlegen(
  haushaltId: number, benutzerId: number, ursprungId: number,
  eingabe: { datum?: string | null; positionen?: { id: number; betrag_cent: number }[] },
): Promise<{ id: number; abgleich: AbgleichErgebnis | { ergebnis: "fehler"; text: string } | null }> {
  const [u] = await sql<{
    status: string; erstattung: boolean; datum: string | null; summe_cent: number | null; haendler_id: number | null; filiale: string | null;
    zahlart: string | null; zahlung: string; zahlung_quelle: string; karte_endziffern: string | null; actual_konto_id: string | null;
    konto_quelle: string | null; bestellnummer: string | null; datei_pfad: string; datei_mime: string; datei_name: string | null;
  }[]>`
    select status, erstattung, to_char(datum, 'YYYY-MM-DD') as datum, summe_cent, haendler_id, filiale, zahlart, zahlung, zahlung_quelle,
           karte_endziffern, actual_konto_id, konto_quelle, bestellnummer, datei_pfad, datei_mime, datei_name
      from bons where id = ${ursprungId} and haushalt_id = ${haushaltId}`;
  if (!u) throw new Error(t("Bon nicht gefunden"));
  if (u.erstattung) throw new Error(t("Der Bon ist selbst eine Erstattung"));
  if (!["geprueft", "wartet", "gebucht"].includes(u.status)) throw new Error(t("Bitte den Bon zuerst prüfen und speichern"));
  if (!u.datum || u.summe_cent == null) throw new Error(t("Datum oder Summe des Bons fehlen"));

  const gekauft = new Map((await positionenLaden([ursprungId])).map((p) => [p.id, p]));
  const wahl = Array.isArray(eingabe.positionen) ? eingabe.positionen : [];
  if (!wahl.length || wahl.length > 500) throw new Error(t("Bitte mindestens eine Position auswählen"));
  if (new Set(wahl.map((w) => w.id)).size !== wahl.length) throw new Error(t("Position doppelt ausgewählt"));
  const zeilen = wahl.map((w, i) => {
    const kauf = gekauft.get(Number(w.id));
    const cent = Math.round(Number(w.betrag_cent));
    if (!kauf || kauf.betrag_cent <= 0) throw new Error(t("Position nicht gefunden"));
    if (!Number.isFinite(cent) || cent <= 0 || cent > kauf.betrag_cent) {
      throw new Error(t("„{name}“: Der erstattete Betrag muss größer als null sein und darf den Kaufpreis nicht übersteigen", { name: kauf.name }));
    }
    return {
      nr: i + 1, text_roh: kauf.text_roh, name: kauf.name, sorte: kauf.sorte, menge: null, einheit: null, einzelpreis_cent: null,
      betrag_cent: -cent, gruppe_id: kauf.gruppe_id, gruppe_quelle: kauf.gruppe_quelle, unsicher: false,
    };
  });
  const summe = zeilen.reduce((s, z) => s + z.betrag_cent, 0);
  const [{ bisher }] = await sql<{ bisher: number }[]>`
    select coalesce(sum(-summe_cent), 0)::int as bisher from bons
     where haushalt_id = ${haushaltId} and erstattung and erstattung_von = ${ursprungId} and dublette_von is null and status <> 'fehler'`;
  if (bisher - summe > u.summe_cent) throw new Error(t("Zusammen mit den bisherigen Erstattungen wäre das mehr als der Kaufbetrag"));

  const heute = new Date().toISOString().slice(0, 10);
  const datum = eingabe.datum && /^\d{4}-\d{2}-\d{2}$/.test(eingabe.datum) ? eingabe.datum : heute;
  if (datum < u.datum) throw new Error(t("Die Rückgabe kann nicht vor dem Kauf liegen"));
  if (Date.parse(datum) > Date.now() + 86_400_000) throw new Error(t("Das Datum der Rückgabe liegt in der Zukunft"));

  // eigener Beleg fehlt: Kopie des Kaufbelegs ablegen (jede Erstattung hat ihre eigene Datei)
  const ablage = await ablageVon(haushaltId);
  const relativ = `eingang/${crypto.randomUUID()}.${u.datei_mime === "application/pdf" ? "pdf" : "jpg"}${ablage.verschluesseln ? ".enc" : ""}`;
  await dateiSchreiben(absoluterPfad(relativ, config.eingangVerzeichnis), await dateiLesen(absoluterPfad(u.datei_pfad, ablage)), ablage.verschluesseln);
  // Kennung statt Prüfsumme des Inhalts: der Kaufbeleg selbst soll weiterhin als schon vorhanden erkannt werden
  const kennung = crypto.createHash("sha256").update(`erstattung:${crypto.randomUUID()}`).digest("hex");

  const id = await sql.begin(async (tx) => {
    const [neu] = await tx<{ id: number }[]>`
      insert into bons (haushalt_id, hochgeladen_von, verschluesselt, datei_pfad, datei_mime, datei_sha256, datei_name, status,
                        haendler_id, filiale, datum, summe_cent, zahlart, zahlung, zahlung_quelle, karte_endziffern,
                        actual_konto_id, konto_quelle, bestellnummer, erstattung, erstattung_von, erstattung_fest, notiz)
      values (${haushaltId}, ${benutzerId}, ${ablage.verschluesseln}, ${relativ}, ${u.datei_mime}, ${kennung}, ${u.datei_name}, 'geprueft',
              ${u.haendler_id}, ${u.filiale}, ${datum}, ${summe}, ${u.zahlart}, ${u.zahlung}, ${u.zahlung_quelle}, ${u.karte_endziffern},
              ${u.actual_konto_id}, ${u.konto_quelle}, ${u.bestellnummer}, true, ${ursprungId}, true,
              ${t("Rückgabe zu Bon {nr}", { nr: ursprungId })})
      returning id`;
    await tx`insert into positionen ${tx(zeilen.map((z) => ({ ...z, bon_id: neu.id })))}`;
    return neu.id;
  });
  await duplikatPruefen(id);
  await bonAblegen(id);

  let abgleich: AbgleichErgebnis | { ergebnis: "fehler"; text: string } | null = null;
  if ((await actualEinstellung(haushaltId)).autoBuchen) {
    abgleich = await abgleichen(haushaltId, id).catch((fehler) => ({ ergebnis: "fehler" as const, text: t((fehler as Error).message) }));
  }
  return { id, abgleich };
}

/**
 * Hochgeladenen Beleg von Hand als Erstattung kennzeichnen (oder die Kennzeichnung zurücknehmen):
 * Summe und Positionen wechseln das Vorzeichen, danach wird der Ursprungsbon gesucht.
 */
export async function alsErstattungMarkieren(haushaltId: number, bonId: number, erstattung: boolean): Promise<void> {
  const [bon] = await sql<{ status: string; erstattung: boolean }[]>`
    select status, erstattung from bons where id = ${bonId} and haushalt_id = ${haushaltId}`;
  if (!bon) throw new Error(t("Bon nicht gefunden"));
  if (bon.status === "gebucht") throw new Error(t("Der Bon ist schon in Actual gebucht"));
  if (!["erkannt", "geprueft", "wartet"].includes(bon.status)) throw new Error(t("Der Bon wird noch gelesen"));
  if (bon.erstattung === erstattung) return;
  const vorzeichen = erstattung ? -1 : 1;
  await sql.begin(async (tx) => {
    const [{ positionen }] = await tx<{ positionen: number }[]>`select coalesce(sum(betrag_cent), 0)::int as positionen from positionen where bon_id = ${bonId}`;
    if (positionen * vorzeichen < 0) await tx`update positionen set betrag_cent = -betrag_cent where bon_id = ${bonId}`;
    await tx`
      update bons set erstattung = ${erstattung}, summe_cent = ${vorzeichen} * abs(summe_cent),
             erstattung_von = case when ${erstattung} then erstattung_von else null end,
             erstattung_fest = case when ${erstattung} then erstattung_fest else false end,
             status = case when status = 'wartet' then 'geprueft' else status end, abgleich_hinweis = null, geaendert_am = now()
       where id = ${bonId} and haushalt_id = ${haushaltId}`;
  });
  if (erstattung) await ursprungSuchen(haushaltId, bonId);
  await duplikatPruefen(bonId);
}
