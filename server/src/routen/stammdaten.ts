import type { FastifyInstance } from "fastify";
import { actualEinstellung, actualKategorien, actualKonten, actualStatus, budgetNamen, buchungsBudgets, neuAufteilen, type ActualEinstellung } from "../actual.js";
import { regelLernen } from "../regeln.js";
import { sorteSaeubern } from "../verarbeitung.js";
import { httpFehler, nurAdmin, protokollieren, zugriff } from "../auth.js";
import { config } from "../config.js";
import { ablageCacheLeeren, ablageVon, BAUSTEINE, haushaltNeuAblegen, pfadAusVorlage, VORLAGE_STANDARD, vorlagePruefen } from "../dateien.js";
import { einstellungSchreiben, sql } from "../db.js";
import { SPRACH_NAMEN, SPRACHEN, standardSprache, standardSpracheSetzen, t, type Sprache } from "../i18n.js";
import { kiEinstellung, monatsKosten, waehrungMitKurs, type KiEinstellung } from "../ki/index.js";
import { gruppenVorschlagAnwenden, gruppenVorschlagen, type GruppenVorschlag } from "../ki/gruppen.js";
import { CLAUDE_MODELLE } from "../ki/kosten.js";
import { kursJeDollar, WAEHRUNGEN } from "../kurse.js";
import { ollamaModelle } from "../ki/ollama.js";

type GruppeEingabe = {
  name?: string;
  eltern_id?: number | null;
  farbe?: string;
  sortierung?: number;
  actual_kategorie_id?: string | null;
};

// Haushalte, deren Bons gerade neu abgelegt bzw. ver-/entschlüsselt werden
const neuAblegenLaeuft = new Set<number>();

const farbeOk =(f: unknown) => (typeof f === "string" && /^#[0-9a-fA-F]{6}$/.test(f) ? f : null);
const idVon = (wert: string) => {
  const id = Number(wert);
  if (!Number.isInteger(id) || id <= 0) throw httpFehler(400, "Ungültige ID");
  return id;
};

export async function stammdatenRouten(app: FastifyInstance) {
  app.get("/api/gruppen", async (req) => {
    const h = zugriff(req);
    return sql`
      select g.id, g.name, g.eltern_id, g.farbe, g.sortierung, g.actual_kategorie_id,
             -- Kategorien in weiteren Buchungs-Budgets (Sync-ID -> Kategorie)
             coalesce((select jsonb_object_agg(k.sync_id, k.kategorie_id) from gruppen_kategorien k where k.gruppe_id = g.id), '{}'::jsonb) as weitere_kategorien,
             (select count(*) from positionen p where p.gruppe_id = g.id)::int as anzahl_positionen
        from gruppen g
       where g.haushalt_id = ${h}
       order by coalesce((select sortierung from gruppen e where e.id = g.eltern_id), g.sortierung),
                g.eltern_id nulls first, g.sortierung, g.name`;
  });

  app.post<{ Body: GruppeEingabe }>("/api/gruppen", async (req, antwort) => {
    const h = zugriff(req, "verwalten");
    const { eltern_id = null, sortierung = 99 } = req.body ?? {};
    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    const farbe = farbeOk(req.body?.farbe) ?? "#64748b";
    if (!name) return antwort.code(400).send({ fehler: "Name fehlt" });
    if (eltern_id != null) {
      const [eltern] = await sql`select 1 from gruppen where id = ${eltern_id} and haushalt_id = ${h} and eltern_id is null`;
      if (!eltern) return antwort.code(400).send({ fehler: "Hauptgruppe nicht gefunden" });
      const [doppelt] = await sql`select 1 from gruppen where haushalt_id = ${h} and eltern_id is not null and lower(name) = lower(${name})`;
      if (doppelt) return antwort.code(409).send({ fehler: "Eine Untergruppe mit diesem Namen gibt es schon" });
    }
    const [neu] = await sql`
      insert into gruppen (haushalt_id, name, eltern_id, farbe, sortierung) values (${h}, ${name}, ${eltern_id}, ${farbe}, ${Number(sortierung) || 99})
      returning *`;
    return neu;
  });

  app.put<{ Params: { id: string }; Body: GruppeEingabe }>("/api/gruppen/:id", async (req, antwort) => {
    const h = zugriff(req, "verwalten");
    const id = idVon(req.params.id);
    const b = req.body ?? {};
    if (b.eltern_id != null) {
      const [eltern] = await sql`select 1 from gruppen where id = ${b.eltern_id} and haushalt_id = ${h} and eltern_id is null and id <> ${id}`;
      if (!eltern) return antwort.code(400).send({ fehler: "Hauptgruppe nicht gefunden" });
    }
    const name = b.name == null ? null : String(b.name).trim().slice(0, 60) || null;
    await sql`
      update gruppen set
        name = coalesce(${name}, name),
        farbe = coalesce(${farbeOk(b.farbe)}, farbe),
        sortierung = coalesce(${b.sortierung == null ? null : Number(b.sortierung) || 0}, sortierung),
        eltern_id = case when ${b.eltern_id !== undefined} then ${b.eltern_id ?? null}::int else eltern_id end,
        actual_kategorie_id = case when ${b.actual_kategorie_id !== undefined} then ${b.actual_kategorie_id ? String(b.actual_kategorie_id).slice(0, 100) : null} else actual_kategorie_id end
      where id = ${id} and haushalt_id = ${h}`;
    return { ok: true };
  });

  /** Kategorie einer Gruppe in einem weiteren Buchungs-Budget setzen (null = keine eigene) */
  app.put<{ Params: { id: string }; Body: { budget: string; kategorie: string | null } }>("/api/gruppen/:id/kategorie", async (req) => {
    const h = zugriff(req, "verwalten");
    const id = idVon(req.params.id);
    const budget = String(req.body?.budget ?? "");
    if (!(await buchungsBudgets(h)).slice(1).includes(budget)) throw httpFehler(400, "Unbekanntes Budget");
    const [eigene] = await sql`select 1 from gruppen where id = ${id} and haushalt_id = ${h}`;
    if (!eigene) throw httpFehler(404, "Gruppe nicht gefunden");
    const kategorie = req.body?.kategorie ? String(req.body.kategorie).slice(0, 100) : null;
    if (kategorie) {
      await sql`insert into gruppen_kategorien (gruppe_id, sync_id, kategorie_id) values (${id}, ${budget}, ${kategorie})
                on conflict (gruppe_id, sync_id) do update set kategorie_id = excluded.kategorie_id`;
    } else {
      await sql`delete from gruppen_kategorien where gruppe_id = ${id} and sync_id = ${budget}`;
    }
    return { ok: true };
  });

  /**
   * Leere Zuordnungen eines weiteren Budgets nach Namen vorschlagen: gleiche Kategorie (Name) wie im Haupt-Budget,
   * sonst eine Kategorie mit dem Namen der Gruppe. Vorhandene Zuordnungen bleiben unverändert.
   */
  app.post<{ Body: { budget: string } }>("/api/gruppen/kategorien-vorschlagen", async (req) => {
    const h = zugriff(req, "verwalten");
    const budget = String(req.body?.budget ?? "");
    if (!(await buchungsBudgets(h)).slice(1).includes(budget)) throw httpFehler(400, "Unbekanntes Budget");
    const haupt = await actualKategorien(h);
    const ziel = await actualKategorien(h, budget);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
    const finde = (name: string | undefined) => {
      if (!name) return null;
      const n = norm(name);
      // exakt gleicher Name, sonst enthält der eine den anderen (z. B. „Drogerie“ / „Drogerie & Apotheke“)
      return ziel.find((k) => norm(k.name) === n) ?? ziel.find((k) => n.length > 3 && (norm(k.name).includes(n) || n.includes(norm(k.name)))) ?? null;
    };
    const gruppen = await sql<{ id: number; name: string; eltern_id: number | null; actual_kategorie_id: string | null; vorhanden: boolean }[]>`
      select g.id, g.name, g.eltern_id, g.actual_kategorie_id,
             exists (select 1 from gruppen_kategorien k where k.gruppe_id = g.id and k.sync_id = ${budget}) as vorhanden
        from gruppen g where g.haushalt_id = ${h}`;
    let gesetzt = 0;
    for (const g of gruppen) {
      if (g.vorhanden) continue;
      // Untergruppen ohne eigene Kategorie im Haupt-Budget erben die des Bereichs – dann auch hier nichts setzen
      if (g.eltern_id != null && !g.actual_kategorie_id) continue;
      const treffer = finde(haupt.find((k) => k.id === g.actual_kategorie_id)?.name) ?? (g.eltern_id == null ? finde(g.name) : null);
      if (!treffer) continue;
      await sql`insert into gruppen_kategorien (gruppe_id, sync_id, kategorie_id) values (${g.id}, ${budget}, ${treffer.id}) on conflict do nothing`;
      gesetzt++;
    }
    return { gesetzt };
  });

  app.delete<{ Params: { id: string } }>("/api/gruppen/:id", async (req, antwort) => {
    const h = zugriff(req, "verwalten");
    const id = idVon(req.params.id);
    const [eigene] = await sql`select 1 from gruppen where id = ${id} and haushalt_id = ${h}`;
    if (!eigene) return antwort.code(404).send({ fehler: "Gruppe nicht gefunden" });
    const [{ anzahl }] = await sql<{ anzahl: number }[]>`
      select count(*)::int as anzahl from positionen
       where gruppe_id = ${id} or gruppe_id in (select id from gruppen where eltern_id = ${id})`;
    if (anzahl > 0) return antwort.code(409).send({ fehler: t("Gruppe wird noch von {n} Positionen verwendet", { n: anzahl }) });
    await sql`delete from gruppen where id = ${id} and haushalt_id = ${h}`;
    return { ok: true };
  });

  // Warengruppen mit Opus neu ordnen: erst Vorschlag (kostet), dann nach Prüfung anwenden
  app.post<{ Body: { wunsch?: string } }>("/api/gruppen/ki-vorschlag", async (req) => {
    const h = zugriff(req, "verwalten");
    const ergebnis = await gruppenVorschlagen(h, String(req.body?.wunsch ?? ""));
    const { kurs } = await waehrungMitKurs();
    return { ...ergebnis, kosten: ergebnis.verbrauch.kostenUsd == null ? null : ergebnis.verbrauch.kostenUsd * kurs };
  });
  app.post<{ Body: { vorschlag: GruppenVorschlag; actualAnlegen?: boolean } }>("/api/gruppen/ki-anwenden", async (req) => {
    const h = zugriff(req, "verwalten");
    const ergebnis = await gruppenVorschlagAnwenden(h, req.body?.vorschlag, Boolean(req.body?.actualAnlegen));
    await protokollieren(req, "gruppen_ki", ergebnis);
    return ergebnis;
  });

  // Stapelverarbeitung: alle Positionen der gewählten Artikel in eine andere Gruppe, künftig ebenso (Regeln);
  // auf Wunsch bereits gebuchte Bons in Actual neu aufteilen
  app.post<{ Body: { artikel?: string[]; gruppe_id?: number; actualNeu?: boolean } }>("/api/artikel/umgruppieren", async (req) => {
    const h = zugriff(req, "bons_bearbeiten");
    const artikel = (Array.isArray(req.body?.artikel) ? req.body.artikel : []).filter((a) => typeof a === "string").slice(0, 500);
    if (!artikel.length) throw httpFehler(400, "Keine Artikel gewählt");
    const [ziel] = await sql<{ id: number }[]>`
      select id from gruppen where id = ${Number(req.body?.gruppe_id) || 0} and haushalt_id = ${h} and eltern_id is not null`;
    if (!ziel) throw httpFehler(400, "Bitte eine Untergruppe wählen");

    const betroffen = await sql<{ id: number; text_roh: string; name: string; bon_id: number; status: string }[]>`
      select p.id, p.text_roh, p.name, b.id as bon_id, b.status
        from positionen p join bons b on b.id = p.bon_id
       where b.haushalt_id = ${h} and p.name = any(${artikel})`;
    await sql`update positionen set gruppe_id = ${ziel.id}, gruppe_quelle = 'hand' where id = any(${betroffen.map((p) => p.id)})`;
    // künftig gleich richtig: aus jedem Bontext eine Regel lernen
    const gelernt = new Set<string>();
    for (const p of betroffen) {
      if (gelernt.has(p.text_roh)) continue;
      gelernt.add(p.text_roh);
      await regelLernen(h, p.text_roh, ziel.id, p.name);
    }

    const gebucht = [...new Set(betroffen.filter((p) => p.status === "gebucht").map((p) => p.bon_id))];
    let neuAufgeteilt = 0;
    const fehler: string[] = [];
    if (req.body?.actualNeu) {
      for (const bonId of gebucht) {
        try {
          await neuAufteilen(h, bonId);
          neuAufgeteilt++;
        } catch (e) {
          fehler.push(`${t("Bon {nr}", { nr: bonId })}: ${t((e as Error).message)}`);
        }
      }
    }
    return { positionen: betroffen.length, bons: new Set(betroffen.map((p) => p.bon_id)).size, gebucht: gebucht.length, neuAufgeteilt, fehler };
  });

  app.get("/api/haendler", async (req) => {
    const h = zugriff(req, "bons_sehen");
    return sql`
      select hd.id, hd.name, count(b.id)::int as anzahl_bons, coalesce(sum(b.summe_cent), 0)::int as summe_cent
        from haendler hd join bons b on b.haendler_id = hd.id and b.haushalt_id = ${h}
       group by hd.id order by hd.name`;
  });

  // Bekannte Sorten für die Auswahl beim Prüfen (häufigste zuerst) – neue Sorten entstehen einfach durch Speichern am Bon
  app.get("/api/sorten", async (req) => {
    const h = zugriff(req);
    return sql<{ name: string; anzahl: number }[]>`
      select p.sorte as name, count(*)::int as anzahl from positionen p join bons b on b.id = p.bon_id
       where b.haushalt_id = ${h} and p.sorte is not null and p.sorte <> ''
       group by p.sorte order by count(*) desc, p.sorte limit 2000`;
  });

  /** Sorte umbenennen oder mit einer anderen zusammenführen – in allen Bons und gelernten Regeln des Haushalts */
  app.put<{ Body: { alt: string; neu: string } }>("/api/sorten", async (req) => {
    const h = zugriff(req, "bons_bearbeiten");
    const alt = String(req.body?.alt ?? "");
    const neu = sorteSaeubern(String(req.body?.neu ?? "").slice(0, 60));
    if (!alt || !neu) throw httpFehler(400, "Name fehlt");
    const positionen = await sql`
      update positionen p set sorte = ${neu} from bons b where b.id = p.bon_id and b.haushalt_id = ${h} and p.sorte = ${alt} returning p.id`;
    await sql`update regeln set sorte = ${neu} where haushalt_id = ${h} and sorte = ${alt}`;
    return { positionen: positionen.length };
  });

  app.get("/api/regeln", async (req) => {
    const h = zugriff(req, "verwalten");
    return sql`
      select r.id, r.muster, r.name, r.sorte, r.treffer, r.gruppe_id, g.name as gruppe, hd.name as haendler
        from regeln r join gruppen g on g.id = r.gruppe_id left join haendler hd on hd.id = r.haendler_id
       where r.haushalt_id = ${h}
       order by r.treffer desc, r.muster`;
  });
  app.put<{ Params: { id: string }; Body: { gruppe_id: number } }>("/api/regeln/:id", async (req, antwort) => {
    const h = zugriff(req, "verwalten");
    const [g] = await sql`select 1 from gruppen where id = ${Number(req.body?.gruppe_id) || 0} and haushalt_id = ${h}`;
    if (!g) return antwort.code(400).send({ fehler: "Unbekannte Gruppe" });
    await sql`update regeln set gruppe_id = ${req.body.gruppe_id} where id = ${idVon(req.params.id)} and haushalt_id = ${h}`;
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/regeln/:id", async (req) => {
    const h = zugriff(req, "verwalten");
    await sql`delete from regeln where id = ${idVon(req.params.id)} and haushalt_id = ${h}`;
    return { ok: true };
  });

  app.get("/api/einstellungen", async (req) => {
    const h = zugriff(req, "verwalten");
    return {
      ki: await kiEinstellung(),
      actual: await actualEinstellung(h),
      claudeModell: config.claudeModell,
      claudeModelle: CLAUDE_MODELLE,
      // je Währung, jede Anfrage mit dem Kurs ihres Tages
      monatsKosten: Object.fromEntries(await Promise.all(WAEHRUNGEN.map(async (w) => [w, await monatsKosten(w)] as const))),
      waehrungen: WAEHRUNGEN,
      // Vorschau der Kurse, damit beim Umstellen der Währung gleich umgerechnet angezeigt werden kann
      kurse: Object.fromEntries(await Promise.all(WAEHRUNGEN.map(async (w) => [w, await kursJeDollar(w)] as const))),
      claudeSchluessel: Boolean(process.env.ANTHROPIC_API_KEY),
      // Sprache der Installation: Artikelnamen und neue Sorten der KI, Meldungen aus der Hintergrundarbeit
      sprache: standardSprache(),
      sprachen: SPRACHEN.map((code) => ({ code, name: SPRACH_NAMEN[code] })),
    };
  });
  app.put<{ Body: { ki?: KiEinstellung; actual?: ActualEinstellung; sprache?: string } }>("/api/einstellungen", async (req) => {
    if (req.body?.sprache !== undefined) {
      nurAdmin(req);
      if (!SPRACHEN.includes(req.body.sprache as Sprache)) throw httpFehler(400, "Unbekannte Sprache");
      await einstellungSchreiben("sprache", req.body.sprache);
      standardSpracheSetzen(req.body.sprache);
    }
    if (req.body?.ki) {
      // KI-Einstellungen gelten für alle Haushalte
      nurAdmin(req);
      const ki = req.body.ki;
      if (!["claude", "ollama", "tesseract"].includes(ki.anbieter)) throw httpFehler(400, "Unbekannter KI-Anbieter");
      // nur http(s)-Adressen: der Server ruft den Ollama-Server selbst auf
      let ollamaUrl: string;
      try {
        const u = new URL(String(ki.ollamaUrl ?? config.ollamaUrl).trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        ollamaUrl = u.toString().replace(/\/$/, "");
      } catch {
        throw httpFehler(400, "Ungültige Ollama-Adresse (http:// oder https://)");
      }
      await einstellungSchreiben("ki", {
        anbieter: ki.anbieter,
        ollamaModell: String(ki.ollamaModell ?? "").slice(0, 100),
        erkennungsModell: CLAUDE_MODELLE.find((m) => m.id === ki.erkennungsModell)?.id ?? config.claudeModell,
        nachlesen: (["manuell", "automatisch", "aus"] as const).find((n) => n === ki.nachlesen) ?? "manuell",
        nachleseModell: CLAUDE_MODELLE.find((m) => m.id === ki.nachleseModell)?.id ?? "claude-sonnet-5-5",
        waehrung: (WAEHRUNGEN as readonly string[]).includes(ki.waehrung) ? ki.waehrung : "EUR",
        monatslimit: Math.max(0, Math.min(1_000_000, Number(ki.monatslimit) || 0)),
        bonLimit: Math.max(0, Math.min(10_000, Number(ki.bonLimit) || 0)),
        gegenpruefung: Boolean(ki.gegenpruefung),
        aufwand: (["low", "medium", "high"] as const).find((a) => a === ki.aufwand) ?? config.claudeAufwand,
        ollamaUrl,
        textModellAnbieter: ki.textModellAnbieter === "claude" ? "claude" : "ollama",
        ollamaTextModell: String(ki.ollamaTextModell ?? "").slice(0, 100) || config.ollamaTextModell,
      } satisfies KiEinstellung);
    }
    if (req.body?.actual) {
      const h = zugriff(req, "verwalten");
      const a = req.body.actual;
      const text = (w: unknown) => (typeof w === "string" && w ? w.slice(0, 100) : null);
      await einstellungSchreiben(
        "actual",
        {
          konten: Array.isArray(a.konten) ? a.konten.filter((k) => typeof k === "string").slice(0, 50) : [],
          standardKategorie: text(a.standardKategorie),
          bargeld: ["umbuchen", "konto", "aus"].includes(a.bargeld) ? a.bargeld : "umbuchen",
          bargeldKonto: text(a.bargeldKonto),
          bargeldKategorie: text(a.bargeldKategorie),
          autoBuchen: Boolean(a.autoBuchen),
          weitereBudgets: Array.isArray(a.weitereBudgets) ? a.weitereBudgets.filter((b) => typeof b === "string" && b.length < 100).slice(0, 10) : [],
          standardKategorien: Object.fromEntries(
            Object.entries(a.standardKategorien ?? {})
              .filter(([b, k]) => b.length < 100 && typeof k === "string" && k && k.length < 100)
              .slice(0, 10),
          ) as Record<string, string>,
        } satisfies ActualEinstellung,
        h,
      );
    }
    return { ok: true };
  });

  // Karten (letzte 4 Ziffern) -> Actual-Konto; auch Karten, die auf Bons gesehen, aber noch nicht zugeordnet wurden
  app.get("/api/karten", async (req) => {
    const h = zugriff(req, "verwalten");
    return sql`
      select coalesce(k.endziffern, b.karte_endziffern) as endziffern, k.actual_konto_id, k.bezeichnung,
             count(b.id)::int as anzahl_bons
        from (select * from kartenzuordnung where haushalt_id = ${h}) k
        full join (select * from bons where haushalt_id = ${h}) b on b.karte_endziffern = k.endziffern
       where coalesce(k.endziffern, b.karte_endziffern) is not null
       group by 1, 2, 3
       order by 4 desc, 1`;
  });
  app.put<{ Params: { endziffern: string }; Body: { actual_konto_id: string | null; bezeichnung?: string | null } }>(
    "/api/karten/:endziffern",
    async (req, antwort) => {
      const h = zugriff(req, "verwalten");
      const endziffern = req.params.endziffern;
      if (!/^\d{4}$/.test(endziffern)) return antwort.code(400).send({ fehler: "Bitte genau 4 Ziffern angeben" });
      const konto = req.body?.actual_konto_id ? String(req.body.actual_konto_id).slice(0, 100) : null;
      const bezeichnung = req.body?.bezeichnung ? String(req.body.bezeichnung).slice(0, 60) : null;
      if (!konto) {
        await sql`delete from kartenzuordnung where haushalt_id = ${h} and endziffern = ${endziffern}`;
      } else {
        await sql`
          insert into kartenzuordnung (haushalt_id, endziffern, actual_konto_id, bezeichnung)
          values (${h}, ${endziffern}, ${konto}, ${bezeichnung})
          on conflict (haushalt_id, endziffern) do update set actual_konto_id = excluded.actual_konto_id,
            bezeichnung = coalesce(excluded.bezeichnung, kartenzuordnung.bezeichnung)`;
        // offene Bons mit dieser Karte bekommen das Konto, sofern nicht von Hand gewählt
        await sql`
          update bons set actual_konto_id = ${konto}, konto_quelle = 'karte'
           where haushalt_id = ${h} and karte_endziffern = ${endziffern} and status <> 'gebucht' and coalesce(konto_quelle, '') <> 'hand'`;
      }
      return { ok: true };
    },
  );

  app.get("/api/ki/ollama-modelle", async (req, antwort) => {
    nurAdmin(req);
    try {
      return await ollamaModelle((await kiEinstellung()).ollamaUrl);
    } catch (fehler) {
      return antwort.code(502).send({ fehler: (fehler as Error).message });
    }
  });

  // ---------- Bon-Ablage: Vorlage für Ordner/Dateinamen und Verschlüsselung ----------
  const beispiel = (vorlage: string) =>
    pfadAusVorlage(vorlage, { datum: "2026-11-02", haendler: "REWE", summeCent: 4780, zahlung: "karte", hochgeladen: "Max", haushalt: t("Familie"), bonId: 123 }) + ".jpg";

  app.get("/api/ablage", async (req) => {
    const h = zugriff(req, "verwalten");
    const ablage = await ablageVon(h);
    return {
      vorlage: ablage.vorlage,
      verschluesseln: ablage.verschluesseln,
      standard: VORLAGE_STANDARD,
      bausteine: BAUSTEINE,
      beispiel: beispiel(ablage.vorlage),
      laeuft: neuAblegenLaeuft.has(h),
    };
  });

  app.post<{ Body: { vorlage: string } }>("/api/ablage/vorschau", async (req, antwort) => {
    zugriff(req, "verwalten");
    try {
      return { beispiel: beispiel(vorlagePruefen(String(req.body?.vorlage ?? ""))) };
    } catch (e) {
      return antwort.code(400).send({ fehler: (e as Error).message });
    }
  });

  app.put<{ Body: { vorlage: string; verschluesseln: boolean; neuAblegen?: boolean } }>("/api/ablage", async (req, antwort) => {
    const h = zugriff(req, "verwalten");
    if (neuAblegenLaeuft.has(h)) return antwort.code(409).send({ fehler: "Die Bons werden gerade neu abgelegt – bitte warten" });
    let vorlage: string;
    try {
      vorlage = vorlagePruefen(String(req.body?.vorlage ?? ""));
    } catch (e) {
      return antwort.code(400).send({ fehler: (e as Error).message });
    }
    const alt = await ablageVon(h);
    const verschluesseln = Boolean(req.body?.verschluesseln);
    await sql`update haushalte set ablage_vorlage = ${vorlage}, verschluesseln = ${verschluesseln} where id = ${h}`;
    ablageCacheLeeren();
    await protokollieren(req, "ablage_geaendert", { vorlage, verschluesseln });
    // vorhandene Bons im Hintergrund umbenennen bzw. ver-/entschlüsseln
    if (verschluesseln !== alt.verschluesseln || req.body.neuAblegen) {
      neuAblegenLaeuft.add(h);
      void haushaltNeuAblegen(h, verschluesseln)
        .then((e) => console.log(`Haushalt ${h}: ${e.bons} Bons neu abgelegt, ${e.fehler} Fehler`))
        .finally(() => neuAblegenLaeuft.delete(h));
      return { ok: true, laeuft: true };
    }
    return { ok: true, laeuft: false };
  });

  app.get("/api/actual/status", async (req) => actualStatus(zugriff(req)));
  // Konten braucht auch der Hochladen-Dialog – aber nur, wer Bons auch bearbeiten darf
  app.get("/api/actual/konten", async (req) => actualKonten(zugriff(req, "bons_bearbeiten")));
  app.get<{ Querystring: { budget?: string } }>("/api/actual/kategorien", async (req) => {
    const h = zugriff(req, "verwalten");
    const budget = req.query.budget;
    if (budget && !(await buchungsBudgets(h)).includes(budget)) throw httpFehler(400, "Unbekanntes Budget");
    return actualKategorien(h, budget || undefined);
  });
  /** Budgets des Actual-Servers – Haupt-Budget und zum Buchen gewählte weitere */
  app.get("/api/actual/budgets", async (req) => {
    const h = zugriff(req, "verwalten");
    const haupt = (await buchungsBudgets(h))[0];
    const { weitereBudgets } = await actualEinstellung(h);
    return [...(await budgetNamen(h)).entries()].map(([syncId, name]) => ({ syncId, name, haupt: syncId === haupt, buchen: syncId === haupt || weitereBudgets.includes(syncId) }));
  });
}
