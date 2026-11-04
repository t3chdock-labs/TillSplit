import fs from "node:fs/promises";
import path from "node:path";
import * as api from "@actual-app/api";
import { config } from "./config.js";
import { einstellungLesen, sql } from "./db.js";
import { t } from "./i18n.js";
import { entschluesseln } from "./sicherheit.js";

type Transaktion = Awaited<ReturnType<typeof api.getTransactions>>[number];

export type ActualEinstellung = {
  /** Konten, in denen nach Abbuchungen gesucht wird (leer = alle offenen Budget-Konten) */
  konten: string[];
  /** Kategorie für Hauptgruppen ohne eigene Zuordnung */
  standardKategorie: string | null;
  /**
   * Barzahlungen in Actual:
   * - umbuchen: Nullsummen-Buchung im bargeldKonto, Betrag von bargeldKategorie auf die Warengruppen-Kategorien
   *   (die Abhebung am Automaten ist in Actual mit bargeldKategorie kategorisiert)
   * - konto: echte Ausgabe im bargeldKonto (eigenes Bargeld-Konto in Actual)
   * - aus: nur in TillSplit
   */
  bargeld: "umbuchen" | "konto" | "aus";
  /** Konto für Barbons: bei "umbuchen" ein beliebiges Budget-Konto (z. B. Haushalt), bei "konto" das Bargeld-Konto */
  bargeldKonto: string | null;
  /** Kategorie, auf der Abhebungen am Geldautomaten landen (z. B. "Bargeld") */
  bargeldKategorie: string | null;
  /** Nach dem Prüfen automatisch buchen bzw. auf die Bankbuchung warten */
  autoBuchen: boolean;
  /**
   * Weitere Budgets desselben Actual-Servers, deren Konten nach Abbuchungen durchsucht werden (z. B. Haushaltskonto).
   * Aufgeteilt wird im Budget der Abbuchung, mit den Kategorien aus gruppen_kategorien.
   */
  weitereBudgets: string[];
  /** Standard-Kategorie je weiterem Budget (Sync-ID -> Kategorie) */
  standardKategorien: Record<string, string>;
};

const standardEinstellung: ActualEinstellung = {
  konten: [],
  standardKategorie: null,
  bargeld: "umbuchen",
  bargeldKonto: null,
  bargeldKategorie: null,
  autoBuchen: true,
  weitereBudgets: [],
  standardKategorien: {},
};

export const actualEinstellung = async (haushaltId: number) => ({
  ...standardEinstellung,
  ...(await einstellungLesen<Partial<ActualEinstellung>>("actual", {}, haushaltId)),
});

type Zugang = { url: string; passwort: string; syncId: string; e2e: string | null };

/** Actual-Zugang eines Haushalts; Haushalt 1 fällt auf die Umgebungsvariablen zurück */
export async function actualZugang(haushaltId: number): Promise<Zugang | null> {
  const [h] = await sql<{ actual_url: string | null; actual_sync_id: string | null; actual_passwort_enc: string | null; actual_e2e_enc: string | null }[]>`
    select actual_url, actual_sync_id, actual_passwort_enc, actual_e2e_enc from haushalte where id = ${haushaltId}`;
  if (h?.actual_url && h.actual_sync_id && h.actual_passwort_enc) {
    return { url: h.actual_url, syncId: h.actual_sync_id, passwort: entschluesseln(h.actual_passwort_enc)!, e2e: entschluesseln(h.actual_e2e_enc) };
  }
  const env = config.actual;
  if (haushaltId === 1 && env.serverUrl && env.passwort && env.syncId) {
    return { url: env.serverUrl, syncId: env.syncId, passwort: env.passwort, e2e: env.e2ePasswort ?? null };
  }
  return null;
}

export const actualEingerichtet = async (haushaltId: number) => Boolean(await actualZugang(haushaltId));

// Die Actual-API ist ein globaler Zustand -> alle Zugriffe nacheinander ausführen.
let kette: Promise<unknown> = Promise.resolve();
// Haushalt, für den die API gerade angemeldet ist, und das geladene Budget
let geoeffnetFuer: number | null = null;
let geladen: string | null = null;
const letzterFehler = new Map<number, string | null>();

/**
 * Zugriff auf ein Actual-Budget eines Haushalts, nacheinander ausgeführt. Standard ist dessen Buchungs-Budget;
 * für das Finanz-Dashboard können weitere Budgets desselben Servers geladen werden.
 */
export function mitActual<T>(haushaltId: number, fn: () => Promise<T>, syncId?: string): Promise<T> {
  const lauf = kette.then(async () => {
    const zugang = await actualZugang(haushaltId);
    if (!zugang) throw new Error("Actual ist für diesen Haushalt nicht eingerichtet (Admin-Bereich → Haushalte)");
    const ziel = syncId ?? zugang.syncId;
    try {
      if (geoeffnetFuer !== haushaltId) {
        if (geoeffnetFuer != null) await api.shutdown().catch(() => {});
        geoeffnetFuer = null;
        // eigener Zwischenspeicher je Haushalt
        const verzeichnis = path.join(config.actualCacheVerzeichnis, String(haushaltId));
        await fs.mkdir(verzeichnis, { recursive: true });
        await api.init({ dataDir: verzeichnis, serverURL: zugang.url, password: zugang.passwort });
        geoeffnetFuer = haushaltId;
        geladen = null;
      }
      if (geladen !== ziel) {
        await api.downloadBudget(ziel, zugang.e2e ? { password: zugang.e2e } : undefined);
        geladen = ziel;
      } else {
        await api.sync();
      }
      const ergebnis = await fn();
      letzterFehler.set(haushaltId, null);
      return ergebnis;
    } catch (fehler) {
      letzterFehler.set(haushaltId, fehler instanceof Error ? fehler.message : String(fehler));
      // beim nächsten Aufruf frisch verbinden
      if (geoeffnetFuer != null) await api.shutdown().catch(() => {});
      geoeffnetFuer = null;
      geladen = null;
      throw fehler;
    }
  });
  kette = lauf.catch(() => {});
  return lauf;
}

/** Nach Änderung der Zugangsdaten neu verbinden */
export function actualTrennen(): void {
  kette = kette.then(async () => {
    if (geoeffnetFuer != null) await api.shutdown().catch(() => {});
    geoeffnetFuer = null;
    geladen = null;
  });
}

export async function actualStatus(haushaltId: number) {
  if (!(await actualEingerichtet(haushaltId))) return { eingerichtet: false, verbunden: false, fehler: null as string | null };
  try {
    await mitActual(haushaltId, async () => api.getAccounts());
    return { eingerichtet: true, verbunden: true, fehler: null };
  } catch {
    return { eingerichtet: true, verbunden: false, fehler: letzterFehler.get(haushaltId) ?? null };
  }
}

/** Budgets, in denen gebucht wird: zuerst das Haupt-Budget des Haushalts, dann die gewählten weiteren */
export async function buchungsBudgets(haushaltId: number): Promise<string[]> {
  const haupt = (await actualZugang(haushaltId))?.syncId;
  if (!haupt) return [];
  const weitere = (await actualEinstellung(haushaltId)).weitereBudgets.filter((b) => b && b !== haupt);
  return [haupt, ...new Set(weitere)];
}

/** Alle Budgets des Actual-Servers (Sync-ID -> Name) */
export const budgetNamen = (haushaltId: number) =>
  mitActual(haushaltId, async () => {
    const namen = new Map<string, string>();
    for (const b of await api.getBudgets()) if (b.groupId && !namen.has(b.groupId)) namen.set(b.groupId, b.name);
    return namen;
  });

export type ActualKonto = { id: string; name: string; offbudget: boolean; budget: string; budget_name: string };
// Konto-ID -> Budget (IDs sind über alle Budgets eindeutig), je Haushalt
const kontoBudgets = new Map<number, Map<string, string>>();

/** Offene Konten aller Buchungs-Budgets; ein nicht erreichbares weiteres Budget wird übersprungen */
export async function actualKonten(haushaltId: number): Promise<ActualKonto[]> {
  const budgets = await buchungsBudgets(haushaltId);
  const namen = budgets.length > 1 ? await budgetNamen(haushaltId) : new Map<string, string>();
  const liste: ActualKonto[] = [];
  for (const [i, budget] of budgets.entries()) {
    try {
      const konten = await mitActual(haushaltId, async () => (await api.getAccounts()).filter((k) => !k.closed), budget);
      for (const k of konten) liste.push({ id: k.id, name: k.name, offbudget: Boolean(k.offbudget), budget, budget_name: namen.get(budget) ?? "" });
    } catch (fehler) {
      if (i === 0) throw fehler;
      console.warn(`Actual-Budget ${budget} nicht erreichbar:`, (fehler as Error).message);
    }
  }
  kontoBudgets.set(haushaltId, new Map(liste.map((k) => [k.id, k.budget])));
  return liste;
}

/** Budget, zu dem ein Konto gehört (unbekannt -> Haupt-Budget) */
export async function kontoBudget(haushaltId: number, kontoId: string | null): Promise<string> {
  const haupt = (await actualZugang(haushaltId))?.syncId ?? "";
  if (!kontoId) return haupt;
  if (!kontoBudgets.get(haushaltId)?.has(kontoId)) await actualKonten(haushaltId).catch(() => []);
  return kontoBudgets.get(haushaltId)?.get(kontoId) ?? haupt;
}

/**
 * Fehlende Kategorien in Actual anlegen (Kategoriegruppe wird bei Bedarf mit angelegt).
 * Liefert für jede gewünschte Kategorie "Gruppe/Name" die ID – vorhandene werden wiederverwendet.
 */
export const actualKategorienAnlegen = (haushaltId: number, wunsch: { gruppe: string; name: string }[]) =>
  mitActual(haushaltId, async () => {
    const ids = new Map<string, string>();
    const gruppen = (await api.getCategoryGroups()).filter((g) => !g.is_income);
    const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    for (const w of wunsch) {
      // Namen stammen aus einem KI-Vorschlag: Steuerzeichen entfernen, Länge begrenzen
      const sauber = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60);
      const gruppenName = sauber(w.gruppe);
      const name = sauber(w.name);
      if (!gruppenName || !name) continue;
      let gruppe = gruppen.find((g) => gleich(g.name, gruppenName));
      if (!gruppe) {
        const id = await api.createCategoryGroup({ name: gruppenName, is_income: false, hidden: false });
        gruppe = { id, name: gruppenName, is_income: false, hidden: false, categories: [] };
        gruppen.push(gruppe);
      }
      let kategorie = gruppe.categories?.find((k) => gleich(k.name, name));
      if (!kategorie) {
        const id = await api.createCategory({ name, group_id: gruppe.id, is_income: false, hidden: false });
        kategorie = { id, name, group_id: gruppe.id, is_income: false, hidden: false };
        (gruppe.categories ??= []).push(kategorie);
      }
      ids.set(`${gruppenName}/${name}`.toLowerCase(), kategorie.id);
    }
    await api.sync();
    return ids;
  });

/** Ausgaben-Kategorien eines Budgets (Standard: Haupt-Budget) */
export const actualKategorien = (haushaltId: number, syncId?: string) =>
  mitActual(
    haushaltId,
    async () => {
      const gruppen = await api.getCategoryGroups();
      return gruppen
        .filter((g) => !g.is_income)
        .flatMap((g) => (g.categories ?? []).map((k) => ({ id: k.id, name: k.name, gruppe: g.name })));
    },
    syncId,
  );

const tagVerschieben = (datum: string, tage: number) => {
  const d = new Date(datum + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
};
const tageZwischen = (a: string, b: string) =>
  Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86_400_000);

/** Konten des gerade geladenen Budgets, in denen gesucht wird (Auswahl gilt über alle Budgets; leer = alle) */
async function suchKonten(haushaltId: number): Promise<{ id: string; name: string }[]> {
  const einstellung = await actualEinstellung(haushaltId);
  const alle = (await api.getAccounts()).filter((k) => !k.closed && !k.offbudget);
  return einstellung.konten.length ? alle.filter((k) => einstellung.konten.includes(k.id)) : alle;
}

/** Passende Abbuchungen für einen Bon: gleicher Betrag, wenige Tage um das Kaufdatum. */
export async function kandidatenSuchen(haushaltId: number, bonId: number) {
  const [bon] = await sql<{ datum: string | null; summe_cent: number | null; haendler: string | null; konto: string | null }[]>`
    select to_char(b.datum, 'YYYY-MM-DD') as datum, b.summe_cent, h.name as haendler, b.actual_konto_id as konto
      from bons b left join haendler h on h.id = b.haendler_id where b.id = ${bonId} and b.haushalt_id = ${haushaltId}`;
  if (!bon?.datum || bon.summe_cent == null) return [];
  // Buchungen, die schon zu einem anderen Bon gehören, nicht noch einmal anbieten
  const vergeben = new Set(
    (await sql<{ actual_tx_id: string }[]>`
      select actual_tx_id from bons where haushalt_id = ${haushaltId} and actual_tx_id is not null and id <> ${bonId}`).map((z) => z.actual_tx_id),
  );

  const treffer: {
    id: string; konto_id: string; konto: string; budget: string; datum: string; betrag_cent: number;
    empfaenger: string; notiz: string | null; aufgeteilt: boolean; abstand_tage: number; name_passt: boolean; punkte: number;
  }[] = [];
  // Ist ein Konto festgelegt (von Hand oder über die Karte), nur in dessen Budget suchen, sonst in allen Buchungs-Budgets
  const budgets = bon.konto ? [await kontoBudget(haushaltId, bon.konto)] : await buchungsBudgets(haushaltId);
  for (const [nr, budget] of budgets.entries()) {
   await mitActual(haushaltId, async () => {
    const payees = new Map((await api.getPayees()).map((p) => [p.id, p.name]));
    const haendler = (bon.haendler ?? "").toLowerCase();
    const konten = await suchKonten(haushaltId);
    const durchsuchen = bon.konto ? (await api.getAccounts()).filter((k) => k.id === bon.konto) : konten;
    for (const konto of durchsuchen) {
      const liste: Transaktion[] = await api.getTransactions(konto.id, tagVerschieben(bon.datum!, -4), tagVerschieben(bon.datum!, 10));
      for (const t of liste) {
        if (t.is_child || t.amount !== -bon.summe_cent! || vergeben.has(t.id)) continue;
        const empfaenger = (t.payee && payees.get(t.payee)) || t.imported_payee || "";
        const abstand = tageZwischen(t.date, bon.datum!);
        const namePasst = haendler.length > 1 && empfaenger.toLowerCase().includes(haendler.split(" ")[0]);
        treffer.push({
          id: t.id,
          konto_id: konto.id,
          konto: konto.name,
          budget,
          datum: t.date,
          betrag_cent: t.amount,
          empfaenger,
          notiz: t.notes ?? null,
          aufgeteilt: Boolean(t.is_parent),
          abstand_tage: abstand,
          name_passt: namePasst,
          punkte: Math.abs(abstand) + (namePasst ? 0 : 5) + (t.is_parent ? 20 : 0),
        });
      }
    }
   }, budget).catch((fehler) => {
      // ein nicht erreichbares weiteres Budget soll die Suche im Haupt-Budget nicht verhindern
      if (nr === 0 || bon.konto) throw fehler;
      console.warn(`Actual-Budget ${budget} nicht durchsuchbar:`, (fehler as Error).message);
    });
  }
  return treffer.sort((a, b) => a.punkte - b.punkte).slice(0, 8);
}

type Teil = { kategorie: string; cent: number; notiz: string };

/**
 * Positionen nach Actual-Kategorie (über die Hauptgruppe) zusammenfassen – im Haupt-Budget über
 * gruppen.actual_kategorie_id, in weiteren Budgets über gruppen_kategorien.
 */
async function teileBerechnen(haushaltId: number, bonId: number, zielCent: number, syncId?: string): Promise<Teil[]> {
  const einstellung = await actualEinstellung(haushaltId);
  const haupt = (await actualZugang(haushaltId))?.syncId;
  const weiteres = syncId && syncId !== haupt ? syncId : null;
  const zeilen = weiteres
    ? await sql<{ kategorie: string | null; haupt: string | null; unter: string | null; cent: number }[]>`
        select coalesce(gu.kategorie_id, gh.kategorie_id, ${einstellung.standardKategorien[weiteres] ?? null}) as kategorie,
               h.name as haupt, u.name as unter, sum(p.betrag_cent)::int as cent
          from positionen p
          join bons b on b.id = p.bon_id and b.haushalt_id = ${haushaltId}
          left join gruppen u on u.id = p.gruppe_id
          left join gruppen h on h.id = u.eltern_id
          left join gruppen_kategorien gu on gu.gruppe_id = u.id and gu.sync_id = ${weiteres}
          left join gruppen_kategorien gh on gh.gruppe_id = h.id and gh.sync_id = ${weiteres}
         where p.bon_id = ${bonId}
         group by 1, 2, 3`
    : await sql<{ kategorie: string | null; haupt: string | null; unter: string | null; cent: number }[]>`
        -- eigene Kategorie der Untergruppe (z. B. Auto/Tanken -> Tanken), sonst die des Bereichs, sonst Standard
        select coalesce(u.actual_kategorie_id, h.actual_kategorie_id, ${einstellung.standardKategorie}) as kategorie,
               h.name as haupt, u.name as unter, sum(p.betrag_cent)::int as cent
          from positionen p
          join bons b on b.id = p.bon_id and b.haushalt_id = ${haushaltId}
          left join gruppen u on u.id = p.gruppe_id
          left join gruppen h on h.id = u.eltern_id
         where p.bon_id = ${bonId}
         group by 1, 2, 3`;

  const fehlend = [...new Set(zeilen.filter((z) => !z.kategorie).map((z) => z.haupt ?? t("Ohne Gruppe")))];
  if (fehlend.length) {
    throw new Error(t("Keine Actual-Kategorie für: {gruppen}. Bitte unter Einstellungen zuordnen.", { gruppen: fehlend.join(", ") }));
  }

  const teile = new Map<string, { cent: number; namen: Map<string, number> }>();
  for (const z of zeilen) {
    const teil = teile.get(z.kategorie!) ?? { cent: 0, namen: new Map() };
    teil.cent += z.cent;
    if (z.unter) teil.namen.set(z.unter, (teil.namen.get(z.unter) ?? 0) + z.cent);
    teile.set(z.kategorie!, teil);
  }

  const liste: Teil[] = [...teile.entries()]
    .map(([kategorie, teil]) => ({
      kategorie,
      cent: teil.cent,
      notiz: [...teil.namen.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).join(", "),
    }))
    .filter((teil) => teil.cent !== 0)
    .sort((a, b) => b.cent - a.cent);
  if (liste.length === 0) throw new Error(t("Der Bon hat keine Positionen"));

  // Rundungs- oder Erkennungsdifferenz dem größten Teil zuschlagen
  const differenz = zielCent - liste.reduce((s, teil) => s + teil.cent, 0);
  liste[0].cent += differenz;
  return liste;
}

/** Eine vorhandene Abbuchung in Actual nach Warengruppen aufteilen (im Budget der Abbuchung). */
export async function aufBuchungVerteilen(haushaltId: number, bonId: number, transaktionId: string, syncId?: string): Promise<void> {
  // Kategorien vorab berechnen: teileBerechnen fragt selbst nichts bei Actual an, braucht aber das Budget
  const budget = syncId ?? (await actualZugang(haushaltId))?.syncId;
  await mitActual(haushaltId, async () => {
    const [bon] = await sql<{ datum: string }[]>`
      select to_char(datum, 'YYYY-MM-DD') as datum from bons where id = ${bonId} and haushalt_id = ${haushaltId}`;
    if (!bon?.datum) throw new Error(t("Bon nicht gefunden oder ohne Datum"));
    let gefunden: Transaktion | undefined;
    let kontoId = "";
    for (const konto of (await api.getAccounts()).filter((k) => !k.closed)) {
      const liste = await api.getTransactions(konto.id, tagVerschieben(bon.datum, -30), tagVerschieben(bon.datum, 30));
      gefunden = liste.find((x) => x.id === transaktionId);
      if (gefunden) { kontoId = konto.id; break; }
    }
    if (!gefunden) throw new Error(t("Buchung in Actual nicht gefunden"));
    if (gefunden.is_parent) throw new Error(t("Die Buchung ist in Actual bereits aufgeteilt – dort zuerst die Aufteilung aufheben"));

    const teile = await teileBerechnen(haushaltId, bonId, -gefunden.amount, budget);
    const notiz = [gefunden.notes, `#tillsplit Bon ${bonId}`].filter(Boolean).join(" ");
    if (teile.length === 1) {
      await api.updateTransaction(gefunden.id, { category: teile[0].kategorie, notes: notiz });
    } else {
      await api.updateTransaction(gefunden.id, {
        notes: notiz,
        subtransactions: teile.map((teil) => ({ amount: -teil.cent, category: teil.kategorie, notes: teil.notiz })),
      } as Partial<Transaktion>);
    }
    await api.sync();
    const [bon2] = await sql<{ karte_endziffern: string | null }[]>`
      update bons set status = 'gebucht', actual_tx_id = ${gefunden.id}, actual_konto_id = ${kontoId}, actual_tx_angelegt = false,
             abgleich_hinweis = null, gebucht_am = now(), geaendert_am = now()
       where id = ${bonId} and haushalt_id = ${haushaltId} returning karte_endziffern`;
    // Karte lernen: auf welchem Konto tauchen Zahlungen mit dieser Karte auf?
    if (bon2?.karte_endziffern) {
      await sql`insert into kartenzuordnung (haushalt_id, endziffern, actual_konto_id) values (${haushaltId}, ${bon2.karte_endziffern}, ${kontoId})
                on conflict (haushalt_id, endziffern) do nothing`;
    }
  }, budget);
}

/** Konto zu einer Karte (letzte 4 Ziffern), falls bekannt */
export async function kontoZurKarte(haushaltId: number, endziffern: string | null): Promise<string | null> {
  if (!endziffern) return null;
  const [z] = await sql<{ actual_konto_id: string }[]>`
    select actual_konto_id from kartenzuordnung where haushalt_id = ${haushaltId} and endziffern = ${endziffern}`;
  return z?.actual_konto_id ?? null;
}

export type AbgleichErgebnis = { ergebnis: "gebucht" | "wartet" | "auswahl" | "kein_konto" | "nur_tillsplit" | "aus" | "duplikat"; text: string };

/**
 * Bon automatisch mit Actual abgleichen:
 * - bar: neue Buchung im Bargeld-Konto anlegen (ohne Bargeld-Konto: nur in TillSplit)
 * - Karte: genau eine passende Abbuchung -> aufteilen; keine -> auf den nächsten Bankimport warten
 */
export async function abgleichen(haushaltId: number, bonId: number): Promise<AbgleichErgebnis> {
  const [bon] = await sql<{ status: string; zahlung: string; actual_konto_id: string | null; dublette_von: number | null }[]>`
    select status, zahlung, actual_konto_id, dublette_von from bons where id = ${bonId} and haushalt_id = ${haushaltId}`;
  if (!bon || bon.status === "gebucht") return { ergebnis: "gebucht", text: t("Bereits gebucht") };
  // mögliches Duplikat nie buchen, sonst landet der Einkauf doppelt in Actual
  if (bon.dublette_von) {
    const text = t("Mögliches Duplikat von Bon {nr} – bitte erst löschen oder als „kein Duplikat“ bestätigen.", { nr: bon.dublette_von });
    await sql`update bons set abgleich_hinweis = ${text}, abgleich_am = now() where id = ${bonId} and haushalt_id = ${haushaltId}`;
    return { ergebnis: "duplikat", text };
  }
  if (!(await actualEingerichtet(haushaltId))) return { ergebnis: "aus", text: t("Actual ist nicht eingerichtet") };
  const einstellung = await actualEinstellung(haushaltId);

  const hinweis = async (status: string, text: string) => {
    await sql`update bons set status = ${status}, abgleich_hinweis = ${text}, abgleich_am = now() where id = ${bonId} and haushalt_id = ${haushaltId}`;
  };

  if (bon.zahlung === "bar") {
    if (einstellung.bargeld === "aus") {
      const text = t("Bar bezahlt – nur in TillSplit erfasst, keine Buchung in Actual.");
      await hinweis("geprueft", text);
      return { ergebnis: "nur_tillsplit", text };
    }
    const konto = bon.actual_konto_id ?? einstellung.bargeldKonto;
    if (!konto || (einstellung.bargeld === "umbuchen" && !einstellung.bargeldKategorie)) {
      const text = t("Barzahlung: Bitte unter Einstellungen → Actual festlegen, wie Barbons gebucht werden (Konto und Bargeld-Kategorie).");
      await hinweis("geprueft", text);
      return { ergebnis: "kein_konto", text };
    }
    await barBuchen(haushaltId, bonId, konto);
    return {
      ergebnis: "gebucht",
      text: einstellung.bargeld === "umbuchen" ? t("Von der Bargeld-Kategorie auf die Bereiche umgebucht") : t("Als Barausgabe in Actual gebucht"),
    };
  }

  const kandidaten = (await kandidatenSuchen(haushaltId, bonId)).filter((k) => !k.aufgeteilt && Math.abs(k.abstand_tage) <= 7);
  let wahl = kandidaten.length === 1 ? kandidaten[0] : undefined;
  // mehrere gleich hohe Abbuchungen: eindeutig nur, wenn genau eine zum Geschäft passt
  if (!wahl && kandidaten.length > 1) {
    const mitName = kandidaten.filter((k) => k.name_passt);
    if (mitName.length === 1) wahl = mitName[0];
  }

  if (wahl) {
    await aufBuchungVerteilen(haushaltId, bonId, wahl.id, wahl.budget);
    return { ergebnis: "gebucht", text: t("Abbuchung vom {datum} ({konto}) aufgeteilt", { datum: wahl.datum, konto: wahl.konto }) };
  }
  if (kandidaten.length > 1) {
    const text = t("{n} mögliche Abbuchungen gefunden – bitte die richtige auswählen.", { n: kandidaten.length });
    await hinweis("geprueft", text);
    return { ergebnis: "auswahl", text };
  }
  const text = t("Noch keine passende Abbuchung in Actual – wird nach dem nächsten Bankimport automatisch zugeordnet.");
  await hinweis("wartet", text);
  return { ergebnis: "wartet", text };
}

/** Alle offenen Bons eines Haushalts abgleichen (nach Bankimporten). */
export async function alleAbgleichen(haushaltId: number): Promise<Record<AbgleichErgebnis["ergebnis"] | "fehler", number>> {
  const zaehler = { gebucht: 0, wartet: 0, auswahl: 0, kein_konto: 0, nur_tillsplit: 0, aus: 0, duplikat: 0, fehler: 0 };
  if (!(await actualEingerichtet(haushaltId))) return zaehler;
  const offen = await sql<{ id: number }[]>`
    select id from bons where haushalt_id = ${haushaltId} and status in ('geprueft','wartet') order by datum, id`;
  for (const { id } of offen) {
    try {
      zaehler[(await abgleichen(haushaltId, id)).ergebnis]++;
    } catch (fehler) {
      zaehler.fehler++;
      await sql`update bons set abgleich_hinweis = ${t("Abgleich fehlgeschlagen: {meldung}", { meldung: t((fehler as Error).message) })}, abgleich_am = now() where id = ${id}`;
    }
  }
  return zaehler;
}

/** Regelmäßiger Abgleich aller Haushalte im Hintergrund */
export function abgleichPlanen(stunden: number): void {
  const lauf = async () => {
    for (const { id } of await sql<{ id: number }[]>`select id from haushalte order by id`) {
      if (!(await actualEinstellung(id)).autoBuchen) continue;
      const ergebnis = await alleAbgleichen(id).catch((e) => (console.error(`Abgleich Haushalt ${id}:`, e), null));
      if (ergebnis?.gebucht) console.log(`Abgleich Haushalt ${id}: ${ergebnis.gebucht} Bons in Actual gebucht`);
    }
  };
  setTimeout(lauf, 60_000);
  setInterval(lauf, stunden * 3_600_000);
}

/** Barbon in Actual übernehmen – als Umbuchung aus der Bargeld-Kategorie oder als Ausgabe im Bargeld-Konto. */
export async function barBuchen(haushaltId: number, bonId: number, kontoId: string): Promise<void> {
  const einstellung = await actualEinstellung(haushaltId);
  // Konto eines weiteren Budgets (z. B. Haushaltskonto): dort als normale Ausgabe buchen
  const budget = await kontoBudget(haushaltId, kontoId);
  if (budget !== (await actualZugang(haushaltId))?.syncId) return neueBuchungAnlegen(haushaltId, bonId, kontoId, null, budget);
  if (einstellung.bargeld === "konto") return neueBuchungAnlegen(haushaltId, bonId, kontoId);
  if (!einstellung.bargeldKategorie) throw new Error(t("Bitte unter Einstellungen die Bargeld-Kategorie festlegen"));
  return neueBuchungAnlegen(haushaltId, bonId, kontoId, einstellung.bargeldKategorie);
}

/**
 * Neue (aufgeteilte) Buchung in Actual anlegen.
 * Mit umbuchVon entsteht eine Nullsummen-Buchung: +Summe auf diese Kategorie, −Teile auf die Bereiche.
 * Der Kontostand ändert sich dabei nicht, nur die Kategorien.
 */
export async function neueBuchungAnlegen(haushaltId: number, bonId: number, kontoId: string, umbuchVon: string | null = null, syncId?: string): Promise<void> {
  await mitActual(haushaltId, async () => {
    const [bon] = await sql<{ datum: string; summe_cent: number; haendler: string | null }[]>`
      select to_char(b.datum, 'YYYY-MM-DD') as datum, b.summe_cent, h.name as haendler
        from bons b left join haendler h on h.id = b.haendler_id where b.id = ${bonId} and b.haushalt_id = ${haushaltId}`;
    if (!bon?.datum || bon.summe_cent == null) throw new Error(t("Datum oder Summe des Bons fehlen"));

    const teile = await teileBerechnen(haushaltId, bonId, bon.summe_cent, syncId);
    const kennung = `#tillsplit Bon ${bonId}`;
    const aufteilung = teile.map((teil) => ({ amount: -teil.cent, category: teil.kategorie, notes: teil.notiz }));
    await api.addTransactions(kontoId, [
      umbuchVon
        ? {
            date: bon.datum,
            amount: 0,
            payee_name: bon.haendler ?? t("Unbekannt"),
            notes: `${kennung} (${t("bar bezahlt")})`,
            cleared: true,
            subtransactions: [{ amount: bon.summe_cent, category: umbuchVon, notes: t("Bar bezahlt") }, ...aufteilung],
          }
        : {
            date: bon.datum,
            amount: -bon.summe_cent,
            payee_name: bon.haendler ?? t("Unbekannt"),
            notes: kennung,
            ...(teile.length === 1 ? { category: teile[0].kategorie } : { subtransactions: aufteilung }),
          },
    ]);
    await api.sync();
    const neu = (await api.getTransactions(kontoId, bon.datum, bon.datum)).find((x) => !x.is_child && x.notes?.startsWith(kennung));
    await sql`update bons set status = 'gebucht', actual_tx_id = ${neu?.id ?? null}, actual_konto_id = ${kontoId}, actual_tx_angelegt = true,
                abgleich_hinweis = null, gebucht_am = now(), geaendert_am = now() where id = ${bonId} and haushalt_id = ${haushaltId}`;
  }, syncId);
}

/**
 * Buchung eines Bons in Actual zurücknehmen (beim Löschen):
 * - von TillSplit angelegt (Barbon) -> Buchung löschen
 * - vorhandene Bankbuchung -> Aufteilung entfernen, Kategorie leeren, TillSplit-Vermerk aus der Notiz
 */
export async function actualZuruecknehmen(haushaltId: number, bonId: number): Promise<string> {
  const [bon] = await sql<{ actual_tx_id: string | null; actual_konto_id: string | null; actual_tx_angelegt: boolean; datum: string | null }[]>`
    select actual_tx_id, actual_konto_id, actual_tx_angelegt, to_char(datum, 'YYYY-MM-DD') as datum
      from bons where id = ${bonId} and haushalt_id = ${haushaltId}`;
  if (!bon?.actual_tx_id) return t("Keine Buchung in Actual");
  // im Budget des gebuchten Kontos (Haupt-Budget oder z. B. Haushaltskonto)
  const budget = await kontoBudget(haushaltId, bon.actual_konto_id);
  return mitActual(haushaltId, async () => {
    const konten = bon.actual_konto_id ? [{ id: bon.actual_konto_id }] : (await api.getAccounts()).filter((k) => !k.closed);
    const datum = bon.datum ?? new Date().toISOString().slice(0, 10);
    let gefunden: Transaktion | undefined;
    for (const konto of konten) {
      gefunden = (await api.getTransactions(konto.id, tagVerschieben(datum, -60), tagVerschieben(datum, 60))).find((x) => x.id === bon.actual_tx_id);
      if (gefunden) break;
    }
    if (!gefunden) return t("Buchung in Actual nicht mehr vorhanden");
    if (bon.actual_tx_angelegt) {
      await api.deleteTransaction(gefunden.id);
      await api.sync();
      return t("Buchung in Actual gelöscht");
    }
    // Teile einzeln löschen, dann die Hauptbuchung wieder unkategorisiert lassen
    for (const teil of gefunden.subtransactions ?? []) await api.deleteTransaction(teil.id);
    const notiz = (gefunden.notes ?? "").replace(new RegExp(`\\s*#tillsplit Bon ${bonId}\\b`), "").trim();
    // is_parent bleibt nach dem Löschen der Teile sonst gesetzt
    await api.updateTransaction(gefunden.id, { category: null, notes: notiz || null, is_parent: false } as unknown as Partial<Transaktion>);
    await api.sync();
    return t("Aufteilung in Actual zurückgenommen");
  }, budget);
}

/**
 * Bereits gebuchten Bon in Actual neu aufteilen, z. B. nachdem Positionen eine andere Gruppe bekommen haben:
 * alte Aufteilung zurücknehmen und mit den aktuellen Kategorien neu buchen.
 */
export async function neuAufteilen(haushaltId: number, bonId: number): Promise<void> {
  const [bon] = await sql<{ actual_tx_id: string | null; actual_tx_angelegt: boolean; actual_konto_id: string | null }[]>`
    select actual_tx_id, actual_tx_angelegt, actual_konto_id from bons where id = ${bonId} and haushalt_id = ${haushaltId} and status = 'gebucht'`;
  if (!bon?.actual_tx_id) return;
  await actualZuruecknehmen(haushaltId, bonId);
  try {
    if (bon.actual_tx_angelegt) {
      const konto = bon.actual_konto_id ?? (await actualEinstellung(haushaltId)).bargeldKonto;
      if (!konto) throw new Error(t("Kein Bargeld-Konto festgelegt"));
      await barBuchen(haushaltId, bonId, konto);
    } else {
      await aufBuchungVerteilen(haushaltId, bonId, bon.actual_tx_id, await kontoBudget(haushaltId, bon.actual_konto_id));
    }
  } catch (fehler) {
    // Abbuchung bleibt ungeteilt in Actual stehen -> Bon wieder zum Abgleich vormerken
    await sql`
      update bons set status = 'geprueft', actual_tx_id = null, abgleich_am = now(),
             abgleich_hinweis = ${t("Neu aufteilen fehlgeschlagen: {meldung}", { meldung: t((fehler as Error).message) })}
       where id = ${bonId} and haushalt_id = ${haushaltId}`;
    throw fehler;
  }
}
