import { DarstellungWahl } from "../komponenten/DarstellungWahl";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { datum, geld, inWaehrung, usCent, waehrungSetzen, zahl } from "../format";
import { api, type Gruppe, type Konto } from "../api";
import { Farbpunkt, Hinweis, KontoOptionen, Kopf, useDaten } from "../komponenten/Bausteine";
import { Symbol } from "../komponenten/Symbol";
import { useSitzung } from "../sitzung";
import { AblageVorlage } from "../komponenten/AblageVorlage";
import { sprache, t } from "../i18n";

type ActualKategorie = { id: string; name: string; gruppe: string };
type ActualBudget = { syncId: string; name: string; haupt: boolean; buchen: boolean };
type EinstellungenDaten = {
  ki: {
    anbieter: "claude" | "ollama" | "tesseract";
    ollamaModell: string;
    erkennungsModell: string;
    nachlesen: "manuell" | "automatisch" | "aus";
    nachleseModell: string;
    waehrung: string;
    monatslimit: number;
    bonLimit: number;
    gegenpruefung: boolean;
  };
  claudeModelle: { id: string; name: string }[];
  /** Kosten im laufenden Monat je Währung (jede Anfrage mit dem Kurs ihres Tages) */
  monatsKosten: Record<string, number>;
  waehrungen: string[];
  kurse: Record<string, { kurs: number; stand: string | null } | null>;
  actual: {
    konten: string[];
    standardKategorie: string | null;
    bargeld: "umbuchen" | "konto" | "aus";
    bargeldKonto: string | null;
    bargeldKategorie: string | null;
    autoBuchen: boolean;
    weitereBudgets: string[];
    standardKategorien: Record<string, string>;
  };
  claudeModell: string;
  claudeSchluessel: boolean;
  /** Sprache der Installation: Artikelnamen der KI, Startgruppen, Meldungen aus der Hintergrundarbeit */
  sprache: string;
  sprachen: { code: string; name: string }[];
  ollamaUrl: string;
  textModell: string;
};

function KategorieWahl({ kategorien, wert, onWahl, leer = t("– keine –") }: { kategorien: ActualKategorie[]; wert: string | null; onWahl: (id: string | null) => void; leer?: string }) {
  const gruppen = [...new Set(kategorien.map((k) => k.gruppe))];
  return (
    <select className="eingabe py-1.5 text-[13px]" value={wert ?? ""} onChange={(e) => onWahl(e.target.value || null)}>
      <option value="">{leer}</option>
      {gruppen.map((g) => (
        <optgroup key={g} label={g}>
          {kategorien
            .filter((k) => k.gruppe === g)
            .map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

const waehrungNamen: Record<string, string> = {
  EUR: t("Euro"),
  USD: t("US-Dollar"),
  CHF: t("Schweizer Franken"),
  GBP: t("Britisches Pfund"),
  PLN: t("Polnischer Złoty"),
  CZK: t("Tschechische Krone"),
  DKK: t("Dänische Krone"),
  SEK: t("Schwedische Krone"),
  NOK: t("Norwegische Krone"),
  HUF: t("Forint"),
};

/** Kostenschutz: Anzeigewährung (EZB-Kurs), Monats- und Bon-Limit in dieser Währung */
function Kostenschutz({ entwurf, setEntwurf }: { entwurf: EinstellungenDaten; setEntwurf: (e: EinstellungenDaten) => void }) {
  const ki = entwurf.ki;
  const kurs = entwurf.kurse[ki.waehrung];
  const verbraucht = entwurf.monatsKosten[kurs ? ki.waehrung : "USD"] ?? 0;
  const w = kurs ? ki.waehrung : "USD";
  const neueWaehrung = (neu: string) => {
    // Limits mit umrechnen, damit sie beim Wechsel ungefähr gleich bleiben
    const alt = entwurf.kurse[ki.waehrung]?.kurs ?? 1;
    const ziel = entwurf.kurse[neu]?.kurs ?? 1;
    const um = (v: number) => Math.round(((v / alt) * ziel) * 100) / 100;
    setEntwurf({ ...entwurf, ki: { ...ki, waehrung: neu, monatslimit: Math.round(um(ki.monatslimit)), bonLimit: um(ki.bonLimit) } });
  };
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-rand p-3">
      <div className="font-medium text-text">{t("Kostenschutz")}</div>
      <label className="block text-xs">
        {t("Währung für Kosten und Limits")}
        <select className="eingabe mt-1" value={ki.waehrung} onChange={(e) => neueWaehrung(e.target.value)}>
          {entwurf.waehrungen.map((c) => (
            <option key={c} value={c} disabled={!entwurf.kurse[c]}>
              {c} – {waehrungNamen[c] ?? c}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs">
        {t("Anthropic rechnet in US-Dollar ab.")}{" "}
        {ki.waehrung !== "USD" &&
          (kurs
            ? kurs.stand
              ? t("Umgerechnet mit dem Referenzkurs der Europäischen Zentralbank: 1 $ = {kurs} {waehrung} (Stand {datum}).", { kurs: zahl(kurs.kurs, 4), waehrung: ki.waehrung, datum: datum(kurs.stand) })
              : t("Umgerechnet mit dem Referenzkurs der Europäischen Zentralbank: 1 $ = {kurs} {waehrung}.", { kurs: zahl(kurs.kurs, 4), waehrung: ki.waehrung })
            : t("Kein Kurs verfügbar (EZB nicht erreichbar) – bis dahin gilt US-Dollar."))}
      </p>
      <p className="text-xs">
        {t("Diesen Monat verbraucht:")} <b className="text-text">{inWaehrung(verbraucht, w)}</b>
        {ki.monatslimit > 0 && ` ${t("von {limit}", { limit: inWaehrung(ki.monatslimit, w) })}`}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs">
          {t("Monatslimit ({waehrung}, 0 = keins)", { waehrung: ki.waehrung })}
          <input
            className="eingabe mt-1"
            type="number"
            min={0}
            step={1}
            value={ki.monatslimit}
            onChange={(e) => setEntwurf({ ...entwurf, ki: { ...ki, monatslimit: Number(e.target.value) } })}
          />
        </label>
        <label className="block text-xs">
          {t("Limit je Bon ({waehrung}, 0 = keins)", { waehrung: ki.waehrung })}
          <input
            className="eingabe mt-1"
            type="number"
            min={0}
            step={0.05}
            value={ki.bonLimit}
            onChange={(e) => setEntwurf({ ...entwurf, ki: { ...ki, bonLimit: Number(e.target.value) } })}
          />
        </label>
      </div>
      <p className="text-xs">
        {t("Ist ein Limit erreicht, stellt TillSplit keine Claude-Anfragen mehr – der Bon bekommt einen Hinweis und kann von Hand erfasst werden. Zusätzliche Sicherheit: in der Anthropic-Console unter „Limits“ ein festes Ausgabenlimit für den API-Schlüssel setzen.")}
      </p>
    </div>
  );
}

// grobe Kosten je Bon aus den bisherigen Tests (Haiku 0,3–0,5 ct, Opus bis 16 ct)
// Richtwerte in US-Dollar je Bon (von–bis), angezeigt mit dem heutigen Kurs
const modellKosten: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.003, 0.006],
  "claude-sonnet-5-5": [0.05, 0.08],
  "claude-opus-5-5": [0.1, 0.16],
};
const modellHinweis = (id: string) => (modellKosten[id] ? t("≈ {von} – {bis} je Bon", { von: usCent(modellKosten[id][0]), bis: usCent(modellKosten[id][1]) }) : "");
const modellText: Record<string, string> = {
  "claude-haiku-5-5": t("Günstig und für die meisten Bons genau genug – empfohlen."),
  "claude-sonnet-5-5": t("Genauer bei langen oder schlecht lesbaren Bons, etwa 15× so teuer wie Haiku."),
  "claude-opus-5-5": t("Am genauesten, etwa 30× so teuer wie Haiku – eher zum Nachlesen einzelner Bons."),
};

type GruppenVorschlag = {
  erklaerung: string;
  hauptgruppen: { name: string; position?: number; farbe: string; actual: string | null; untergruppen: { name: string; bisher_ids: number[]; actual: string | null }[] }[];
  artikel: { name: string; ziel_haupt: string; ziel_unter: string }[];
  neue_actual_kategorien: { gruppe: string; name: string }[];
};

/** Anzahl aller abwählbaren Teile eines Vorschlags (alles abgewählt -> nichts zu übernehmen) */
const anzahlTeile = (v: GruppenVorschlag) =>
  v.hauptgruppen.length + v.hauptgruppen.reduce((s, hg) => s + hg.untergruppen.length, 0) + v.artikel.length + v.neue_actual_kategorien.length;

/** Warengruppen mit Opus neu ordnen: Wünsche eingeben, Vorschlag ansehen, erst dann übernehmen */
function KiNeuordnen({ onFertig }: { onFertig: () => void }) {
  const { status } = useSitzung();
  const [offen, setOffen] = useState(false);
  const [wunsch, setWunsch] = useState("");
  const [arbeitet, setArbeitet] = useState<"" | "denkt" | "wendet an">("");
  const [ergebnis, setErgebnis] = useState<{ vorschlag: GruppenVorschlag; kosten: number | null } | null>(null);
  // abgewählte Teile des Vorschlags: "h:Bereich", "u:Bereich/Gruppe", "a:Artikel", "k:Gruppe/Kategorie"
  const [aus, setAus] = useState<Set<string>>(new Set());
  const [meldung, setMeldung] = useState<{ art: "gut" | "fehler"; text: string } | null>(null);
  const an = (schluessel: string) => !aus.has(schluessel);
  const umschalten = (schluessel: string) =>
    setAus((alt) => {
      const neu = new Set(alt);
      if (neu.has(schluessel)) neu.delete(schluessel);
      else neu.add(schluessel);
      return neu;
    });
  const alleArtikel = (anschalten: boolean) =>
    setAus((alt) => {
      const neu = new Set([...alt].filter((s) => !s.startsWith("a:")));
      if (!anschalten) for (const a of ergebnis?.vorschlag.artikel ?? []) neu.add(`a:${a.name}`);
      return neu;
    });

  /** Nur die angehakten Teile übernehmen */
  const auswahl = (v: GruppenVorschlag): GruppenVorschlag => {
    const hauptAn = (h: string) => an(`h:${h}`);
    return {
      ...v,
      hauptgruppen: v.hauptgruppen
        // Position aus dem vollständigen Vorschlag mitgeben, damit die Reihenfolge stimmt
        .map((hg, i) => ({ ...hg, position: i + 1 }))
        .filter((hg) => hauptAn(hg.name))
        .map((hg) => ({ ...hg, untergruppen: hg.untergruppen.filter((u) => an(`u:${hg.name}/${u.name}`)) })),
      artikel: v.artikel.filter((a) => an(`a:${a.name}`)),
      neue_actual_kategorien: v.neue_actual_kategorien.filter((k) => an(`k:${k.gruppe}/${k.name}`)),
    };
  };

  const vorschlagHolen = async () => {
    if (!confirm(t("Claude Opus erstellt einen Vorschlag für neue Warengruppen.\n\nDas kostet einmalig etwa 5–30 US-Cent (je nach Anzahl Artikel). Übernommen wird erst nach deiner Prüfung."))) return;
    setArbeitet("denkt");
    setMeldung(null);
    try {
      setErgebnis(await api.post("/api/gruppen/ki-vorschlag", { wunsch }));
      setAus(new Set());
    } catch (e) {
      setMeldung({ art: "fehler", text: (e as Error).message });
    } finally {
      setArbeitet("");
    }
  };
  const anwenden = async () => {
    if (!ergebnis) return;
    setArbeitet("wendet an");
    try {
      const z = await api.post<{ bereicheNeu: number; gruppenNeu: number; zusammengelegt: number; artikelUmgezogen: number; geloescht: number }>(
        "/api/gruppen/ki-anwenden",
        { vorschlag: auswahl(ergebnis.vorschlag), actualAnlegen: true },
      );
      setMeldung({
        art: "gut",
        text: t("Übernommen: {bereiche} neue Bereiche, {gruppen} neue Gruppen, {zusammen} zusammengelegt, {positionen} Positionen umgezogen.", {
          bereiche: z.bereicheNeu,
          gruppen: z.gruppenNeu,
          zusammen: z.zusammengelegt,
          positionen: z.artikelUmgezogen,
        }),
      });
      setErgebnis(null);
      onFertig();
    } catch (e) {
      setMeldung({ art: "fehler", text: (e as Error).message });
    } finally {
      setArbeitet("");
    }
  };

  if (!offen) {
    return (
      <button className="knopf-zweit" onClick={() => setOffen(true)}>
        <Symbol name="funke" className="size-4" /> {t("Mit KI neu ordnen")}
      </button>
    );
  }
  const v = ergebnis?.vorschlag;
  return (
    <section className="karte space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("Warengruppen mit KI neu ordnen")}</h2>
        <button className="knopf-leise text-xs" onClick={() => (setOffen(false), setErgebnis(null))}>
          {t("Schließen")}
        </button>
      </div>
      {!v && (
        <>
          <p className="text-sm text-text-2">
            {t("Claude Opus sieht sich deine Gruppen, die gekauften Artikel und die Actual-Kategorien an und schlägt eine saubere Ordnung vor. Schreib dazu, was dir wichtig ist:")}
          </p>
          <textarea
            className="eingabe min-h-24"
            placeholder={t("z. B. Diesel gehört zu Auto/Tanken, in Actual aber auf „Tanken“. Öl = Auto/Betriebsmittel, Werkstatt = Auto/Werkstatt – in Actual jeweils gleich.")}
            value={wunsch}
            onChange={(e) => setWunsch(e.target.value)}
          />
          {!status.nutzer?.admin && <p className="text-xs text-text-3">{t("Hinweis: Die Kosten trägt der Claude-Zugang des Servers.")}</p>}
          <button className="knopf-haupt" disabled={arbeitet !== ""} onClick={() => void vorschlagHolen()}>
            <Symbol name="funke" className="size-4" /> {arbeitet === "denkt" ? t("Claude denkt nach … (bis zu 2 Minuten)") : t("Vorschlag erstellen")}
          </button>
        </>
      )}

      {v && (
        <div className="space-y-3">
          <Hinweis art="info">
            {v.erklaerung}
            {ergebnis.kosten != null && <span className="block text-xs opacity-80">{t("Kosten des Vorschlags: {betrag}", { betrag: geld(ergebnis.kosten) })}</span>}
          </Hinweis>
          <p className="text-xs text-text-2">{t("Häkchen entfernen, um einzelne Bereiche, Gruppen, Artikel oder Actual-Kategorien nicht zu übernehmen.")}</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {v.hauptgruppen.map((hg) => {
              const hauptAn = an(`h:${hg.name}`);
              return (
                <div key={hg.name} className={`rounded-xl border p-3 text-sm ${hauptAn ? "border-rand" : "border-dashed border-rand opacity-60"}`}>
                  <label className="flex cursor-pointer items-center gap-2 font-semibold">
                    <input type="checkbox" className="size-4" checked={hauptAn} onChange={() => umschalten(`h:${hg.name}`)} />
                    <Farbpunkt farbe={hg.farbe} /> {hg.name}
                  </label>
                  <div className="mb-1.5 pl-6 text-xs text-text-3">{t("Actual:")} {hg.actual ?? "–"}</div>
                  <ul className="space-y-0.5 pl-6">
                    {hg.untergruppen.map((u) => (
                      <li key={u.name}>
                        <label className="flex cursor-pointer flex-wrap items-center gap-x-2">
                          <input
                            type="checkbox"
                            className="size-3.5"
                            disabled={!hauptAn}
                            checked={hauptAn && an(`u:${hg.name}/${u.name}`)}
                            onChange={() => umschalten(`u:${hg.name}/${u.name}`)}
                          />
                          <span>{u.name}</span>
                          {!u.bisher_ids.length && <span className="text-xs text-gut">{t("neu")}</span>}
                          {u.bisher_ids.length > 1 && <span className="text-xs text-warnung">{t("{n} zusammengelegt", { n: u.bisher_ids.length })}</span>}
                          {u.actual && <span className="text-xs text-akzent">→ {u.actual}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          {v.artikel.length > 0 && (
            <details className="rounded-xl border border-rand p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {t("{an} von {n} Artikeln ziehen um", { an: v.artikel.filter((a) => an(`a:${a.name}`)).length, n: v.artikel.length })}
              </summary>
              <div className="mt-2 flex gap-2 text-xs">
                <button className="knopf-leise px-2 py-0.5" onClick={() => alleArtikel(true)}>
                  {t("Alle")}
                </button>
                <button className="knopf-leise px-2 py-0.5" onClick={() => alleArtikel(false)}>
                  {t("Keine")}
                </button>
              </div>
              <ul className="mt-1 max-h-64 space-y-0.5 overflow-y-auto text-xs">
                {v.artikel.map((a) => (
                  <li key={a.name}>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="size-3.5" checked={an(`a:${a.name}`)} onChange={() => umschalten(`a:${a.name}`)} />
                      <span>
                        {a.name} → <span className="text-text-2">{a.ziel_haupt} / {a.ziel_unter}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {v.neue_actual_kategorien.length > 0 && (
            <div className="space-y-1 rounded-xl border border-rand p-3 text-sm">
              <div className="font-medium">{t("Neue Kategorien in Actual anlegen")}</div>
              {v.neue_actual_kategorien.map((k) => (
                <label key={`${k.gruppe}/${k.name}`} className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" className="size-3.5" checked={an(`k:${k.gruppe}/${k.name}`)} onChange={() => umschalten(`k:${k.gruppe}/${k.name}`)} />
                  {k.gruppe} / {k.name}
                </label>
              ))}
              <p className="text-xs text-text-3">{t("Abgewählte Kategorien werden nicht angelegt; Gruppen, die darauf zeigen sollten, behalten ihre bisherige Zuordnung.")}</p>
            </div>
          )}
          <p className="text-xs text-text-3">
            {t("Bisherige Gruppen werden umbenannt oder zusammengelegt, nicht gelöscht – die Auswertung der alten Bons bleibt erhalten. Bereits in Actual gebuchte Bons ändern sich dadurch nicht; dafür im Reiter Artikel „In Actual neu aufteilen“ nutzen.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="knopf-haupt" disabled={arbeitet !== "" || aus.size === anzahlTeile(v)} onClick={() => void anwenden()}>
              <Symbol name="haken" className="size-4" /> {arbeitet === "wendet an" ? t("Wird übernommen …") : aus.size ? t("Auswahl übernehmen") : t("Vorschlag übernehmen")}
            </button>
            <button className="knopf-zweit" onClick={() => setErgebnis(null)} disabled={arbeitet !== ""}>
              {t("Verwerfen")}
            </button>
          </div>
        </div>
      )}
      {meldung && <Hinweis art={meldung.art}>{meldung.text}</Hinweis>}
    </section>
  );
}

function Warengruppen() {
  const { daten: gruppen, neuLaden } = useDaten<Gruppe[]>("/api/gruppen");
  const { daten: kategorien, fehler: actualFehler } = useDaten<ActualKategorie[]>("/api/actual/kategorien");
  const [neueHaupt, setNeueHaupt] = useState("");
  const [neueUnter, setNeueUnter] = useState<Record<number, string>>({});
  const [fehler, setFehler] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // weitere Buchungs-Budgets (z. B. Haushaltskonto): eigene Kategorie je Gruppe
  const { daten: budgets } = useDaten<ActualBudget[]>(kategorien ? "/api/actual/budgets" : null);
  const weitere = (budgets ?? []).filter((b) => b.buchen && !b.haupt);
  const hauptName = budgets?.find((b) => b.haupt)?.name;
  const [weitereKategorien, setWeitereKategorien] = useState<Record<string, ActualKategorie[]>>({});
  const { daten: einstellungen, neuLaden: einstellungenNeu } = useDaten<EinstellungenDaten>(weitere.length ? "/api/einstellungen" : null);
  useEffect(() => {
    for (const b of budgets ?? []) {
      if (!b.buchen || b.haupt) continue;
      api
        .get<ActualKategorie[]>(`/api/actual/kategorien?budget=${encodeURIComponent(b.syncId)}`)
        .then((k) => setWeitereKategorien((alt) => ({ ...alt, [b.syncId]: k })))
        .catch(() => {});
    }
  }, [budgets]);

  const ausfuehren = async (fn: () => Promise<unknown>) => {
    setFehler(null);
    try {
      await fn();
      neuLaden();
    } catch (e) {
      setFehler((e as Error).message);
    }
  };
  const aendern = (id: number, teil: Partial<Gruppe>) => ausfuehren(() => api.put(`/api/gruppen/${id}`, teil));
  const zuordnen = (id: number, budget: string, kategorie: string | null) => ausfuehren(() => api.put(`/api/gruppen/${id}/kategorie`, { budget, kategorie }));
  const standardSetzen = (budget: string, kategorie: string | null) =>
    ausfuehren(async () => {
      if (!einstellungen) return;
      const neu = { ...einstellungen.actual.standardKategorien };
      if (kategorie) neu[budget] = kategorie;
      else delete neu[budget];
      await api.put("/api/einstellungen", { actual: { ...einstellungen.actual, standardKategorien: neu } });
      einstellungenNeu();
    });

  if (!gruppen) return null;
  const haupt = gruppen.filter((g) => g.eltern_id == null).sort((a, b) => a.sortierung - b.sortierung);

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-2">
        {t("Die KI ordnet jede Position einer Untergruppe zu – neue Gruppen nutzt sie sofort für alle weiteren Bons. In Actual wird auf die Kategorie des Bereichs gebucht; eine Untergruppe kann eine eigene Kategorie bekommen (z. B. Auto/Tanken → „Tanken“).")}
      </p>
      <KiNeuordnen onFertig={neuLaden} />
      {actualFehler && <Hinweis art="warnung">{t("Actual nicht erreichbar – Kategorien können erst zugeordnet werden, wenn die Verbindung steht. ({fehler})", { fehler: actualFehler })}</Hinweis>}
      {fehler && <Hinweis art="fehler">{fehler}</Hinweis>}
      {info && <Hinweis art="gut">{info}</Hinweis>}

      {weitere.map((b) => (
        <section key={b.syncId} className="karte flex flex-wrap items-end gap-3 p-4 text-sm">
          <div className="min-w-56 flex-1">
            <div className="font-medium">{t("Kategorien im Budget „{name}“", { name: b.name })}</div>
            <div className="text-xs text-text-2">
              {t("Jede Gruppe hat dafür eine zweite Auswahl. Ohne eigene Zuordnung gilt die des Bereichs, sonst die Standard-Kategorie.")}
            </div>
          </div>
          <label className="block w-full text-xs text-text-2 sm:w-56">
            {t("Standard-Kategorie")}
            <div className="mt-1">
              <KategorieWahl
                kategorien={weitereKategorien[b.syncId] ?? []}
                wert={einstellungen?.actual.standardKategorien?.[b.syncId] ?? null}
                onWahl={(id) => void standardSetzen(b.syncId, id)}
              />
            </div>
          </label>
          <button
            className="knopf-zweit"
            onClick={() =>
              void ausfuehren(async () => {
                const r = await api.post<{ gesetzt: number }>("/api/gruppen/kategorien-vorschlagen", { budget: b.syncId });
                setInfo(t("{n} Zuordnung nach Namen vorgeschlagen – bitte prüfen.|{n} Zuordnungen nach Namen vorgeschlagen – bitte prüfen.", { n: r.gesetzt }));
              })
            }
          >
            <Symbol name="funke" className="size-4" /> {t("Nach Namen vorschlagen")}
          </button>
        </section>
      ))}

      <div className="grid gap-4 xl:grid-cols-2">
        {haupt.map((h) => {
          const unter = gruppen.filter((u) => u.eltern_id === h.id);
          return (
            <section key={h.id} className="karte p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  className="size-8 cursor-pointer rounded-lg border border-rand bg-transparent"
                  value={h.farbe}
                  onChange={(e) => aendern(h.id, { farbe: e.target.value })}
                />
                <input
                  className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none"
                  defaultValue={h.name}
                  onBlur={(e) => e.target.value !== h.name && aendern(h.id, { name: e.target.value })}
                />
                <div className="w-full sm:w-56">
                  {weitere.length > 0 && <div className="text-[10px] text-text-3">{hauptName}</div>}
                  {kategorien ? (
                    <KategorieWahl
                      kategorien={kategorien}
                      wert={h.actual_kategorie_id}
                      leer={t("– Actual-Kategorie –")}
                      onWahl={(id) => aendern(h.id, { actual_kategorie_id: id })}
                    />
                  ) : (
                    <span className="text-xs text-text-3">{t("Actual-Kategorie: –")}</span>
                  )}
                </div>
                {weitere.map(
                  (b) =>
                    weitereKategorien[b.syncId] && (
                      <div key={b.syncId} className="w-full sm:w-56">
                        <div className="text-[10px] text-text-3">{b.name}</div>
                        <KategorieWahl
                          kategorien={weitereKategorien[b.syncId]}
                          wert={h.weitere_kategorien?.[b.syncId] ?? null}
                          leer={t("– Standard-Kategorie –")}
                          onWahl={(id) => void zuordnen(h.id, b.syncId, id)}
                        />
                      </div>
                    ),
                )}
              </div>
              <div className="mt-3 divide-y divide-rand rounded-xl border border-rand">
                {unter.map((u) => (
                  <div key={u.id} className="group flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-sm">
                    <label className="relative cursor-pointer">
                      <Farbpunkt farbe={u.farbe} className="size-3.5" />
                      <input type="color" className="absolute inset-0 opacity-0" value={u.farbe} onChange={(e) => aendern(u.id, { farbe: e.target.value })} />
                    </label>
                    <input
                      className="min-w-0 flex-1 bg-transparent outline-none"
                      defaultValue={u.name}
                      onBlur={(e) => e.target.value !== u.name && aendern(u.id, { name: e.target.value })}
                    />
                    <span className="text-xs text-text-3">{u.anzahl_positionen || ""}</span>
                    {kategorien && (
                      // eigene Actual-Kategorie nur, wenn sie vom Bereich abweichen soll (z. B. Auto/Tanken -> Tanken)
                      <div className="w-full sm:w-48">
                        <KategorieWahl
                          kategorien={kategorien}
                          wert={u.actual_kategorie_id}
                          leer={t("wie {name}", { name: h.name })}
                          onWahl={(id) => aendern(u.id, { actual_kategorie_id: id })}
                        />
                      </div>
                    )}
                    {weitere.map(
                      (b) =>
                        weitereKategorien[b.syncId] && (
                          <div key={b.syncId} className="w-full sm:w-48" title={b.name}>
                            <KategorieWahl
                              kategorien={weitereKategorien[b.syncId]}
                              wert={u.weitere_kategorien?.[b.syncId] ?? null}
                              leer={t("wie {name}", { name: h.name })}
                              onWahl={(id) => void zuordnen(u.id, b.syncId, id)}
                            />
                          </div>
                        ),
                    )}
                    {u.anzahl_positionen === 0 && (
                      <button className="text-text-3 opacity-0 transition hover:text-fehler group-hover:opacity-100" aria-label={t("Untergruppe löschen")} onClick={() => ausfuehren(() => api.delete(`/api/gruppen/${u.id}`))}>
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <form
                  className="inline-flex"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = neueUnter[h.id]?.trim();
                    if (name) void ausfuehren(() => api.post("/api/gruppen", { name, eltern_id: h.id, farbe: h.farbe })).then(() => setNeueUnter({ ...neueUnter, [h.id]: "" }));
                  }}
                >
                  <input
                    className="w-32 rounded-full border border-dashed border-rand bg-transparent px-3 py-1 text-xs outline-none focus:border-akzent"
                    placeholder={t("+ Untergruppe")}
                    value={neueUnter[h.id] ?? ""}
                    onChange={(e) => setNeueUnter({ ...neueUnter, [h.id]: e.target.value })}
                  />
                </form>
              </div>
            </section>
          );
        })}
      </div>

      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (neueHaupt.trim()) void ausfuehren(() => api.post("/api/gruppen", { name: neueHaupt, sortierung: haupt.length + 1 })).then(() => setNeueHaupt(""));
        }}
      >
        <input className="eingabe" placeholder={t("Neue Hauptgruppe, z. B. Elektronik")} value={neueHaupt} onChange={(e) => setNeueHaupt(e.target.value)} />
        <button className="knopf-zweit shrink-0">
          <Symbol name="plus" className="size-4" /> {t("Anlegen")}
        </button>
      </form>
    </div>
  );
}

function Verbindungen() {
  const { daten, neuLaden } = useDaten<EinstellungenDaten>("/api/einstellungen");
  const { daten: status } = useDaten<{ eingerichtet: boolean; verbunden: boolean; fehler: string | null }>("/api/actual/status");
  const { daten: konten, neuLaden: kontenNeu } = useDaten<Konto[]>(status?.verbunden ? "/api/actual/konten" : null);
  const { daten: budgets } = useDaten<ActualBudget[]>(status?.verbunden ? "/api/actual/budgets" : null);
  const { daten: kategorien } = useDaten<ActualKategorie[]>(status?.verbunden ? "/api/actual/kategorien" : null);
  const [ollamaModelle, setOllamaModelle] = useState<string[] | null>(null);
  const [ollamaFehler, setOllamaFehler] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<EinstellungenDaten | null>(null);
  const [gespeichert, setGespeichert] = useState(false);
  // KI-Einstellungen gelten für alle Haushalte und sind nur für Administratoren änderbar
  const admin = Boolean(useSitzung().status.nutzer?.admin);

  useEffect(() => {
    setEntwurf(daten);
  }, [daten]);
  useEffect(() => {
    if (!admin || entwurf?.ki.anbieter !== "ollama" || ollamaModelle) return;
    api.get<string[]>("/api/ki/ollama-modelle").then(setOllamaModelle).catch((e: Error) => setOllamaFehler(e.message));
  }, [admin, entwurf?.ki.anbieter, ollamaModelle]);

  if (!entwurf) return null;

  const speichern = async () => {
    await api.put("/api/einstellungen", admin ? { ki: entwurf.ki, actual: entwurf.actual, sprache: entwurf.sprache } : { actual: entwurf.actual });
    // neue Anzeigewährung gleich überall verwenden
    const kurs = entwurf.kurse[entwurf.ki.waehrung];
    if (admin && kurs) waehrungSetzen(entwurf.ki.waehrung, kurs.kurs);
    setGespeichert(true);
    setTimeout(() => setGespeichert(false), 2500);
    neuLaden();
    // geänderte Buchungs-Budgets bringen andere Konten mit
    kontenNeu();
  };
  const mehrereBudgets = new Set(konten?.map((k) => k.budget)).size > 1;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {admin && <section className="karte space-y-4 p-5">
        <h2 className="font-semibold">{t("Texterkennung")}</h2>
        <label className="block text-xs text-text-2">
          {t("Sprache für Artikelnamen und Sorten")}
          <select className="eingabe mt-1" value={entwurf.sprache} onChange={(e) => setEntwurf({ ...entwurf, sprache: e.target.value })}>
            {entwurf.sprachen.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-text-3">
            {t("Gilt für alle Haushalte: In dieser Sprache benennt die KI Artikel und Sorten, und in ihr stehen Hinweise, die im Hintergrund entstehen. Der Text vom Bon bleibt unverändert. Die Oberfläche stellt jeder unter „Mein Konto“ selbst ein.")}
          </span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(["claude", "ollama", "tesseract"] as const).map((a) => (
            <button
              key={a}
              className={`rounded-xl border p-3 text-left transition ${entwurf.ki.anbieter === a ? "border-akzent bg-akzent-hell/50" : "border-rand hover:bg-flaeche-2"}`}
              onClick={() => setEntwurf({ ...entwurf, ki: { ...entwurf.ki, anbieter: a } })}
            >
              <div className="font-medium">{a === "claude" ? "Claude" : a === "ollama" ? "Ollama" : "Tesseract"}</div>
              <div className="text-xs text-text-2">{a === "claude" ? t("Cloud, sehr genau") : a === "ollama" ? t("Lokal, Bildmodell") : t("Lokal, sparsam")}</div>
            </button>
          ))}
        </div>
        {entwurf.ki.anbieter === "tesseract" ? (
          <div className="text-sm text-text-2">
            {t("Tesseract liest den Text des Bons, das Sprachmodell {modell} gliedert ihn in Positionen (über TEXTMODELL_ANBIETER und OLLAMA_TEXT_MODEL änderbar). Braucht deutlich weniger Rechenleistung als ein Bildmodell, ist bei zerknitterten oder blassen Bons aber ungenauer.", { modell: entwurf.textModell })}
          </div>
        ) : entwurf.ki.anbieter === "claude" ? (
          <div className="text-sm text-text-2">
            <label className="block text-xs">
              {t("Modell für die Erkennung")}
              <select
                className="eingabe mt-1"
                value={entwurf.ki.erkennungsModell}
                onChange={(e) => setEntwurf({ ...entwurf, ki: { ...entwurf.ki, erkennungsModell: e.target.value } })}
              >
                {entwurf.claudeModelle.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {modellHinweis(m.id) ? ` – ${modellHinweis(m.id)}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {modellText[entwurf.ki.erkennungsModell] && <p className="mt-1 text-xs text-text">{modellText[entwurf.ki.erkennungsModell]}</p>}
            <p className="mt-1 text-xs">
              {t("Kosten je Bon sind Richtwerte aus bisherigen Bons (lange Bons kosten mehr). Anthropic rechnet in US-Dollar ab. Vorgabe beim ersten Start kommt aus CLAUDE_MODEL; die Auswahl hier hat Vorrang.")}
            </p>
            {!entwurf.claudeSchluessel && <div className="mt-2"><Hinweis art="warnung">{t("ANTHROPIC_API_KEY ist nicht gesetzt.")}</Hinweis></div>}
            <div className="mt-3 space-y-2 rounded-xl border border-rand p-3">
              <div className="font-medium text-text">{t("Wenn die Positionen nicht zur Bonsumme passen")}</div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["manuell", t("Nachfragen")],
                    ["automatisch", t("Automatisch nachlesen")],
                    ["aus", t("Nichts tun")],
                  ] as const
                ).map(([wert, text]) => (
                  <button
                    key={wert}
                    className={`chip ${entwurf.ki.nachlesen === wert ? "chip-aktiv" : ""}`}
                    onClick={() => setEntwurf({ ...entwurf, ki: { ...entwurf.ki, nachlesen: wert } })}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className="text-xs">
                {entwurf.ki.nachlesen === "manuell"
                  ? t("Der Bon bekommt einen Hinweis. Ein größeres Modell liest erst, wenn du es am Bon freigibst – mit Angabe der voraussichtlichen Kosten.")
                  : entwurf.ki.nachlesen === "automatisch"
                    ? t("Das gewählte Modell liest sofort nach. Bequem, kann bei langen Bons aber über 10 Cent kosten.")
                    : t("Keine zweite Erkennung; Fehler korrigierst du von Hand.")}
              </p>
              {entwurf.ki.nachlesen === "automatisch" && (
                <label className="block text-xs">
                  {t("Modell zum Nachlesen")}
                  <select className="eingabe mt-1" value={entwurf.ki.nachleseModell} onChange={(e) => setEntwurf({ ...entwurf, ki: { ...entwurf.ki, nachleseModell: e.target.value } })}>
                    {entwurf.claudeModelle
                      .filter((m) => m.id !== "claude-haiku-5-5")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {modellHinweis(m.id) ? ` – ${modellHinweis(m.id)}` : ""}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            <Kostenschutz entwurf={entwurf} setEntwurf={setEntwurf} />
            <label className="mt-3 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={entwurf.ki.gegenpruefung}
                onChange={(e) => setEntwurf({ ...entwurf, ki: { ...entwurf.ki, gegenpruefung: e.target.checked } })}
              />
              <span>
                <span className="font-medium text-text">{t("Gegenprüfung mit Tesseract")}</span>
                <span className="block">
                  {t("Liest jedes Bild zusätzlich lokal und warnt, wenn darauf ein anderes bekanntes Geschäft steht als erkannt. Kostenlos, braucht aber je Bon 10–30 Sekunden Rechenzeit auf dem Server und ist ungenauer als Claude.")}
                </span>
              </span>
            </label>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="text-text-2">{t("Server: {url}", { url: entwurf.ollamaUrl })}</div>
            {ollamaFehler && <Hinweis art="warnung">{ollamaFehler}</Hinweis>}
            <label className="block text-xs text-text-2">
              {t("Modell (muss Bilder verstehen, z. B. qwen2.5vl, gemma3, llama3.2-vision)")}
              {ollamaModelle ? (
                <select className="eingabe mt-1" value={entwurf.ki.ollamaModell} onChange={(e) => setEntwurf({ ...entwurf, ki: { ...entwurf.ki, ollamaModell: e.target.value } })}>
                  {!ollamaModelle.includes(entwurf.ki.ollamaModell) && <option value={entwurf.ki.ollamaModell}>{entwurf.ki.ollamaModell}</option>}
                  {ollamaModelle.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input className="eingabe mt-1" value={entwurf.ki.ollamaModell} onChange={(e) => setEntwurf({ ...entwurf, ki: { ...entwurf.ki, ollamaModell: e.target.value } })} />
              )}
            </label>
            <p className="text-xs text-text-3">{t("Tipp: Einzelne Bons lassen sich auf der Bon-Seite über „Neu lesen“ gezielt mit dem anderen Anbieter vergleichen.")}</p>
          </div>
        )}
      </section>}

      <section className="karte space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("Actual Budget")}</h2>
          {status && (
            <span className={`flex items-center gap-1.5 text-xs font-medium ${status.verbunden ? "text-gut" : "text-warnung"}`}>
              <span className="size-2 rounded-full bg-current" />
              {status.verbunden ? t("Verbunden") : status.eingerichtet ? t("Keine Verbindung") : t("Nicht eingerichtet")}
            </span>
          )}
        </div>
        {status && !status.eingerichtet && (
          <Hinweis>{t("Zugangsdaten werden über ACTUAL_SERVER_URL, ACTUAL_PASSWORD und ACTUAL_SYNC_ID im Container gesetzt.")}</Hinweis>
        )}
        {status?.fehler && <Hinweis art="fehler">{status.fehler}</Hinweis>}
        {budgets && budgets.length > 1 && (
          <div>
            <div className="ueberschrift mb-1">{t("Budgets zum Buchen")}</div>
            <p className="mb-2 text-xs text-text-2">
              {t("Abbuchungen werden in allen gewählten Budgets gesucht und dort aufgeteilt, wo sie liegen. Die Kategorien je Budget ordnest du unter Warengruppen zu.")}
            </p>
            <div className="space-y-1">
              {budgets.map((b) => (
                <label key={b.syncId} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-[var(--akzent)]"
                    disabled={b.haupt}
                    checked={b.haupt || entwurf.actual.weitereBudgets.includes(b.syncId)}
                    onChange={(e) =>
                      setEntwurf({
                        ...entwurf,
                        actual: {
                          ...entwurf.actual,
                          weitereBudgets: e.target.checked
                            ? [...entwurf.actual.weitereBudgets, b.syncId]
                            : entwurf.actual.weitereBudgets.filter((x) => x !== b.syncId),
                        },
                      })
                    }
                  />
                  {b.name}
                  {b.haupt && <span className="text-xs text-text-3">{t("(Haupt-Budget)")}</span>}
                </label>
              ))}
            </div>
            {JSON.stringify([...entwurf.actual.weitereBudgets].sort()) !== JSON.stringify([...(daten?.actual.weitereBudgets ?? [])].sort()) && (
              <p className="mt-1 text-xs text-warnung">{t("Nach dem Speichern erscheinen die Konten der gewählten Budgets.")}</p>
            )}
          </div>
        )}
        {konten && (
          <div>
            <div className="ueberschrift mb-2">{t("In diesen Konten nach Abbuchungen suchen")}</div>
            <div className="space-y-1">
              {konten
                .filter((k) => !k.offbudget)
                .map((k) => (
                  <label key={k.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-[var(--akzent)]"
                      checked={entwurf.actual.konten.length === 0 || entwurf.actual.konten.includes(k.id)}
                      onChange={(e) => {
                        const alle = konten.filter((x) => !x.offbudget).map((x) => x.id);
                        const aktuell = entwurf.actual.konten.length ? entwurf.actual.konten : alle;
                        const neu = e.target.checked ? [...aktuell, k.id] : aktuell.filter((x) => x !== k.id);
                        setEntwurf({ ...entwurf, actual: { ...entwurf.actual, konten: neu.length === alle.length ? [] : neu } });
                      }}
                    />
                    {k.name}
                    {mehrereBudgets && <span className="text-xs text-text-3">· {k.budget_name}</span>}
                  </label>
                ))}
            </div>
          </div>
        )}
        {konten && (
          <div className="space-y-3 rounded-xl border border-rand p-3">
            <div className="ueberschrift">{t("Barzahlungen")}</div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["umbuchen", t("Aus Kategorie umbuchen")],
                  ["konto", t("Eigenes Bargeld-Konto")],
                  ["aus", t("Nur in TillSplit")],
                ] as const
              ).map(([wert, text]) => (
                <button
                  key={wert}
                  className={`chip ${entwurf.actual.bargeld === wert ? "chip-aktiv" : ""}`}
                  onClick={() => setEntwurf({ ...entwurf, actual: { ...entwurf.actual, bargeld: wert } })}
                >
                  {text}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-2">
              {entwurf.actual.bargeld === "umbuchen"
                ? t("Abhebungen am Geldautomaten landen in Actual auf einer Kategorie wie „Bargeld“. Für jeden Barbon legt TillSplit eine Buchung über 0 € an, die den Betrag von dort auf die Bereiche verteilt. Der Kontostand bleibt gleich, nur die Kategorien stimmen.")
                : entwurf.actual.bargeld === "konto"
                  ? t("Barbons werden als Ausgabe im Bargeld-Konto gebucht. Abhebungen sind dann Überweisungen vom Bankkonto auf dieses Konto.")
                  : t("Barbons zählen nur in der TillSplit-Auswertung, Actual bleibt unverändert.")}
            </p>
            {entwurf.actual.bargeld !== "aus" && (
              <label className="block text-xs text-text-2">
                {entwurf.actual.bargeld === "umbuchen" ? t("Konto für die Umbuchung") : t("Bargeld-Konto")}
                <select
                  className="eingabe mt-1"
                  value={entwurf.actual.bargeldKonto ?? ""}
                  onChange={(e) => setEntwurf({ ...entwurf, actual: { ...entwurf.actual, bargeldKonto: e.target.value || null } })}
                >
                  <option value="">{t("– bitte wählen –")}</option>
                  <KontoOptionen konten={konten} />
                </select>
              </label>
            )}
            {entwurf.actual.bargeld === "umbuchen" && kategorien && (
              <label className="block text-xs text-text-2">
                {t("Kategorie der Abhebungen")}
                <div className="mt-1">
                  <KategorieWahl
                    kategorien={kategorien}
                    wert={entwurf.actual.bargeldKategorie}
                    onWahl={(id) => setEntwurf({ ...entwurf, actual: { ...entwurf.actual, bargeldKategorie: id } })}
                  />
                </div>
              </label>
            )}
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--akzent)]"
            checked={entwurf.actual.autoBuchen}
            onChange={(e) => setEntwurf({ ...entwurf, actual: { ...entwurf.actual, autoBuchen: e.target.checked } })}
          />
          <span>
            {t("Nach dem Prüfen automatisch buchen")}
            <span className="block text-xs text-text-2">
              {t("Barzahlungen werden sofort übernommen. Kartenzahlungen warten auf den Bankimport und werden alle paar Stunden automatisch zugeordnet, sobald genau eine passende Abbuchung in Actual auftaucht.")}
            </span>
          </span>
        </label>
        {kategorien && (
          <label className="block text-xs text-text-2">
            {t("Kategorie für Hauptgruppen ohne eigene Zuordnung")}
            <div className="mt-1">
              <KategorieWahl
                kategorien={kategorien}
                wert={entwurf.actual.standardKategorie}
                onWahl={(id) => setEntwurf({ ...entwurf, actual: { ...entwurf.actual, standardKategorie: id } })}
              />
            </div>
          </label>
        )}
      </section>

      <div className="flex items-center gap-3 lg:col-span-2">
        <button className="knopf-haupt" onClick={speichern}>
          {t("Speichern")}
        </button>
        {gespeichert && <span className="text-sm text-gut">{t("Gespeichert")}</span>}
      </div>

      {konten && <Karten konten={konten.filter((k) => !k.offbudget)} />}
    </div>
  );
}

type Karte = { endziffern: string; actual_konto_id: string | null; bezeichnung: string | null; anzahl_bons: number };

/** Karte (letzte 4 Ziffern auf dem Bon) -> Actual-Konto, z. B. •••• 1234 -> DKB */
function Karten({ konten }: { konten: Konto[] }) {
  const { daten: karten, neuLaden } = useDaten<Karte[]>("/api/karten");
  const [neu, setNeu] = useState({ endziffern: "", konto: "" });
  const [fehler, setFehler] = useState<string | null>(null);

  const speichern = async (endziffern: string, konto: string | null, bezeichnung?: string | null) => {
    setFehler(null);
    try {
      await api.put(`/api/karten/${endziffern}`, { actual_konto_id: konto, bezeichnung });
      neuLaden();
    } catch (e) {
      setFehler((e as Error).message);
    }
  };

  return (
    <section className="karte space-y-3 p-5 lg:col-span-2">
      <div>
        <h2 className="font-semibold">{t("Karten → Konten")}</h2>
        <p className="mt-1 text-sm text-text-2">
          {t("Bei Kartenzahlung steht die Karte meist auf dem Bon („•••• 1234“). Darüber erkennt TillSplit, von welchem Actual-Konto abgebucht wird. Wird ein Bon einmal von Hand einem Konto zugeordnet, merkt sich TillSplit die Karte automatisch.")}
        </p>
      </div>
      {fehler && <Hinweis art="fehler">{fehler}</Hinweis>}
      <div className="divide-y divide-rand rounded-xl border border-rand">
        {karten?.length === 0 && <div className="p-4 text-center text-sm text-text-2">{t("Noch keine Karten erkannt.")}</div>}
        {karten?.map((k) => (
          <div key={k.endziffern} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <span className="w-24 font-mono font-medium">•••• {k.endziffern}</span>
            <input
              className="eingabe w-40 py-1.5 text-[13px]"
              placeholder={t("Bezeichnung")}
              defaultValue={k.bezeichnung ?? ""}
              onBlur={(e) => k.actual_konto_id && e.target.value !== (k.bezeichnung ?? "") && speichern(k.endziffern, k.actual_konto_id, e.target.value)}
            />
            <select
              className={`eingabe w-56 py-1.5 text-[13px] ${k.actual_konto_id ? "" : "border-warnung"}`}
              value={k.actual_konto_id ?? ""}
              onChange={(e) => speichern(k.endziffern, e.target.value || null)}
            >
              <option value="">{t("– Konto zuordnen –")}</option>
              <KontoOptionen konten={konten} />
            </select>
            <span className="ml-auto text-xs text-text-3">{t("{n} Bon|{n} Bons", { n: k.anzahl_bons })}</span>
          </div>
        ))}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (neu.endziffern && neu.konto) void speichern(neu.endziffern, neu.konto).then(() => setNeu({ endziffern: "", konto: "" }));
        }}
      >
        <input
          className="eingabe w-32"
          inputMode="numeric"
          maxLength={4}
          placeholder="1234"
          value={neu.endziffern}
          onChange={(e) => setNeu({ ...neu, endziffern: e.target.value.replace(/\D/g, "") })}
        />
        <select className="eingabe w-56" value={neu.konto} onChange={(e) => setNeu({ ...neu, konto: e.target.value })}>
          <option value="">{t("Konto wählen")}</option>
          <KontoOptionen konten={konten} />
        </select>
        <button className="knopf-zweit" disabled={neu.endziffern.length !== 4 || !neu.konto}>
          <Symbol name="plus" className="size-4" /> {t("Karte hinzufügen")}
        </button>
      </form>
    </section>
  );
}

type Regel = { id: number; muster: string; name: string | null; treffer: number; gruppe_id: number; gruppe: string; haendler: string | null };

function Regeln() {
  const { daten: regeln, neuLaden } = useDaten<Regel[]>("/api/regeln");
  const { daten: gruppen } = useDaten<Gruppe[]>("/api/gruppen");
  const [filter, setFilter] = useState("");
  if (!regeln || !gruppen) return null;
  const unter = gruppen.filter((g) => g.eltern_id != null);
  const sichtbar = regeln.filter((r) => !filter || r.muster.includes(filter.toLowerCase()) || r.name?.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-2">
        {t("Jede Korrektur beim Prüfen wird gemerkt: Taucht derselbe Bontext wieder auf, wird er automatisch richtig zugeordnet – unabhängig von der KI.")}
      </p>
      <input className="eingabe max-w-sm" placeholder={t("Filtern")} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="karte divide-y divide-rand overflow-hidden">
        {sichtbar.length === 0 && <div className="p-6 text-center text-sm text-text-2">{t("Noch keine gelernten Zuordnungen.")}</div>}
        {sichtbar.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[13px]">{r.muster}</div>
              {r.name && <div className="text-xs text-text-3">→ {r.name}</div>}
            </div>
            <select
              className="eingabe w-56 py-1.5 text-[13px]"
              value={r.gruppe_id}
              onChange={(e) => void api.put(`/api/regeln/${r.id}`, { gruppe_id: Number(e.target.value) }).then(neuLaden)}
            >
              {unter.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <span className="w-16 text-right text-xs text-text-3">{t("{n}× genutzt", { n: r.treffer })}</span>
            <button className="knopf-leise px-2 text-text-3 hover:text-fehler" aria-label={t("Regel löschen")} onClick={() => void api.delete(`/api/regeln/${r.id}`).then(neuLaden)}>
              <Symbol name="muell" className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

type FinanzEinstellungDaten = {
  einstellung: { budgets: string[]; vermoegen: string[] | null; ausblenden: string[] };
  gewaehlt: string[];
  server: { syncId: string; name: string; buchung: boolean }[];
  konten: { budget: string; id: string; name: string; offbudget: boolean; geschlossen: boolean; budget_name: string }[];
  kategorien: { id: string; name: string; gruppe: string | null }[];
};

/** Welche Budgets, Vermögenskonten und Kategorien das Finanz-Dashboard nutzt */
function FinanzEinstellungen() {
  const { daten, fehler, neuLaden } = useDaten<FinanzEinstellungDaten>("/api/finanzen/einstellungen");
  const [entwurf, setEntwurf] = useState<FinanzEinstellungDaten["einstellung"] | null>(null);
  const [status, setStatus] = useState<{ text: string; art: "gut" | "fehler" } | null>(null);
  const [arbeitet, setArbeitet] = useState(false);

  useEffect(() => {
    if (daten) setEntwurf({ ...daten.einstellung, budgets: daten.gewaehlt });
  }, [daten]);
  if (fehler) return <Hinweis art="fehler">{fehler}</Hinweis>;
  if (!daten || !entwurf) return null;

  const umschalten = (liste: string[], wert: string) => (liste.includes(wert) ? liste.filter((w) => w !== wert) : [...liste, wert]);
  const automatisch = entwurf.vermoegen == null;
  const vermoegenGewaehlt = (k: (typeof daten.konten)[number]) =>
    automatisch ? k.offbudget && !k.geschlossen : entwurf.vermoegen!.includes(`${k.budget}:${k.id}`);
  const kategorieGruppen = [...new Set(daten.kategorien.map((k) => k.gruppe ?? t("Ohne Gruppe")))].sort();

  const speichern = async () => {
    setArbeitet(true);
    setStatus(null);
    try {
      await api.put("/api/finanzen/einstellungen", entwurf);
      const erg = await api.post<{ budget: string; buchungen?: number; fehler?: string }[]>("/api/finanzen/einlesen", {});
      const fehlerhaft = erg.filter((e) => e.fehler);
      setStatus({
        text: erg.map((e) => (e.fehler ? `${e.budget}: ${e.fehler}` : `${e.budget}: ${t("{n} Buchungen eingelesen", { n: e.buchungen })}`)).join(" · "),
        art: fehlerhaft.length ? "fehler" : "gut",
      });
      neuLaden();
    } catch (e) {
      setStatus({ text: (e as Error).message, art: "fehler" });
    } finally {
      setArbeitet(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="karte space-y-3 p-5">
        <div>
          <h2 className="font-semibold">{t("Budgets")}</h2>
          <p className="mt-1 text-sm text-text-2">{t("Welche Actual-Budgets im Dashboard „Finanzen“ erscheinen. Gebucht werden Bons weiterhin nur im Budget aus der Konfiguration.")}</p>
        </div>
        {daten.server.length === 0 && <Hinweis art="warnung">{t("Keine Budgets gefunden – ist Actual erreichbar?")}</Hinweis>}
        <div className="space-y-1.5">
          {daten.server.map((b) => (
            <label key={b.syncId} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-flaeche-2">
              <input type="checkbox" className="size-4 accent-[var(--color-akzent)]" checked={entwurf.budgets.includes(b.syncId)} onChange={() => setEntwurf({ ...entwurf, budgets: umschalten(entwurf.budgets, b.syncId) })} />
              <span className="flex-1">{b.name}</span>
              {b.buchung && <span className="text-xs text-text-3">{t("Buchungs-Budget")}</span>}
            </label>
          ))}
        </div>

        <div className="border-t border-rand pt-3">
          <h2 className="font-semibold">{t("Vermögensverlauf")}</h2>
          <p className="mt-1 text-sm text-text-2">{t("Konten, deren Stand als Vermögen gezeigt wird – typischerweise Depots außerhalb des Budgets.")}</p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-akzent)]"
              checked={automatisch}
              onChange={(e) =>
                setEntwurf({
                  ...entwurf,
                  vermoegen: e.target.checked ? null : daten.konten.filter((k) => k.offbudget && !k.geschlossen).map((k) => `${k.budget}:${k.id}`),
                })
              }
            />
            {t("Automatisch: alle offenen Konten außerhalb des Budgets")}
          </label>
          <div className="mt-2 space-y-1">
            {daten.konten.length === 0 && <p className="text-sm text-text-3">{t("Konten erscheinen nach dem ersten Einlesen.")}</p>}
            {daten.konten.map((k) => (
              <label key={`${k.budget}:${k.id}`} className={`flex items-center gap-2 rounded-lg px-1 py-1 text-sm ${automatisch ? "opacity-60" : "hover:bg-flaeche-2"}`}>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-akzent)]"
                  disabled={automatisch}
                  checked={vermoegenGewaehlt(k)}
                  onChange={() => setEntwurf({ ...entwurf, vermoegen: umschalten(entwurf.vermoegen ?? [], `${k.budget}:${k.id}`) })}
                />
                <span className="flex-1">
                  {k.name}
                  {k.geschlossen && <span className="text-text-3"> {t("(geschlossen)")}</span>}
                </span>
                <span className="text-xs text-text-3">
                  {k.budget_name} · {k.offbudget ? t("außerhalb") : t("im Budget")}
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="karte space-y-3 p-5">
        <div>
          <h2 className="font-semibold">{t("Nicht mitzählen")}</h2>
          <p className="mt-1 text-sm text-text-2">
            {t("Kategorien, die weder Einnahme noch Ausgabe sind – etwa der Beitrag vom eigenen Budget ans Haushaltsbudget. Sonst zählt das Geld bei „Alle Budgets“ doppelt. Umbuchungen zwischen Konten desselben Budgets werden ohnehin herausgerechnet.")}
          </p>
        </div>
        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
          {kategorieGruppen.map((g) => (
            <div key={g}>
              <div className="ueberschrift mb-1">{g}</div>
              {daten.kategorien
                .filter((k) => (k.gruppe ?? t("Ohne Gruppe")) === g)
                .sort((a, b) => a.name.localeCompare(b.name, sprache()))
                .map((k) => (
                  <label key={k.id} className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-sm hover:bg-flaeche-2">
                    <input type="checkbox" className="size-4 accent-[var(--color-akzent)]" checked={entwurf.ausblenden.includes(k.id)} onChange={() => setEntwurf({ ...entwurf, ausblenden: umschalten(entwurf.ausblenden, k.id) })} />
                    {k.name}
                  </label>
                ))}
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <button className="knopf-haupt" onClick={speichern} disabled={arbeitet}>
          <Symbol name="haken" className="size-4" /> {arbeitet ? t("Speichert und liest ein …") : t("Speichern und neu einlesen")}
        </button>
        {status && <span className={`text-sm ${status.art === "fehler" ? "text-fehler" : "text-gut"}`}>{status.text}</span>}
      </div>
    </div>
  );
}

const reiter = [
  { schluessel: "gruppen", text: t("Warengruppen") },
  { schluessel: "verbindungen", text: "Actual" },
  { schluessel: "ablage", text: t("Ablage") },
  { schluessel: "finanzen", text: t("Finanzen") },
  { schluessel: "regeln", text: t("Gelernte Zuordnungen") },
  { schluessel: "darstellung", text: t("Darstellung") },
] as const;

export function Einstellungen() {
  const [suche] = useSearchParams();
  const [aktiv, setAktiv] = useState<(typeof reiter)[number]["schluessel"]>(
    reiter.find((r) => r.schluessel === suche.get("reiter"))?.schluessel ?? "gruppen",
  );
  return (
    <>
      <Kopf
        titel={t("Einstellungen")}
        rechts={
          <div className="flex flex-wrap gap-2">
            <Link to="/statistik" className="knopf-zweit md:hidden">
              <Symbol name="statistik" className="size-4" /> {t("Statistik")}
            </Link>
            <Link to="/einrichtung" className="knopf-zweit">
              <Symbol name="kompass" className="size-4" /> {t("Einrichtungstour")}
            </Link>
          </div>
        }
      />
      <div className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-rand">
        {reiter.map((r) => (
          <button
            key={r.schluessel}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              aktiv === r.schluessel ? "border-akzent text-akzent" : "border-transparent text-text-2 hover:text-text"
            }`}
            onClick={() => setAktiv(r.schluessel)}
          >
            {r.text}
          </button>
        ))}
      </div>
      {aktiv === "gruppen" && <Warengruppen />}
      {aktiv === "verbindungen" && <Verbindungen />}
      {aktiv === "ablage" && <AblageVorlage />}
      {aktiv === "finanzen" && <FinanzEinstellungen />}
      {aktiv === "regeln" && <Regeln />}
      {aktiv === "darstellung" && (
        <div className="max-w-2xl">
          <DarstellungWahl />
        </div>
      )}
    </>
  );
}
