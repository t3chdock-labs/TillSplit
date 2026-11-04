import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api, type Gruppe } from "../api";
import { Farbpunkt, Hinweis, Kopf, Leer, useDaten } from "../komponenten/Bausteine";
import { useSitzung } from "../sitzung";
import { Diagramm, themaFarben } from "../komponenten/Diagramm";
import { GruppenWahl } from "../komponenten/GruppenWahl";
import { PostenListe } from "../komponenten/PostenListe";
import { Symbol } from "../komponenten/Symbol";
import { datum, euro } from "../format";
import { t } from "../i18n";

type ArtikelZeile = {
  name: string;
  untergruppe: string;
  farbe: string;
  kaeufe: number;
  summe_cent: number;
  min_cent: number;
  max_cent: number;
  letzter_cent: number;
  zuletzt: string;
  haendler: string[];
};
type Punkt = { datum: string; haendler: string; bon_id: number; menge: number | null; einheit: string | null; preis_cent: number; betrag_cent: number };

function Preisverlauf({ name }: { name: string }) {
  const { daten } = useDaten<Punkt[]>(`/api/artikel/verlauf?name=${encodeURIComponent(name)}`);
  const f = themaFarben();
  const optionen = useMemo(() => {
    if (!daten) return null;
    const akzent = getComputedStyle(document.documentElement).getPropertyValue("--akzent").trim();
    return {
      grid: { left: 8, right: 12, top: 12, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "item",
        formatter: (p: { dataIndex: number }) => {
          const d = daten[p.dataIndex];
          return `${datum(d.datum)} · ${d.haendler}<br/><b>${euro(d.preis_cent)}</b>`;
        },
      },
      xAxis: { type: "time", axisLine: { lineStyle: { color: f.rand } }, axisLabel: { color: f.leise }, splitLine: { show: false } },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: f.leise, formatter: (v: number) => euro(v) },
        splitLine: { lineStyle: { color: f.rand } },
      },
      series: [
        {
          type: "line",
          step: "end",
          symbolSize: 8,
          lineStyle: { color: akzent, width: 2 },
          itemStyle: { color: akzent },
          areaStyle: { color: akzent, opacity: 0.08 },
          data: daten.map((d) => [d.datum, d.preis_cent]),
        },
      ],
    };
  }, [daten, f.rand, f.leise]);

  if (!daten || !optionen) return null;
  return (
    <div className="border-t border-rand bg-flaeche-2 px-4 py-4">
      <div className="ueberschrift mb-2">{t("Preisverlauf")}</div>
      <Diagramm optionen={optionen} hoehe={200} />
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {daten.slice(-8).reverse().map((d) => (
          <Link key={d.bon_id + d.datum} to={`/bons/${d.bon_id}`} className="chip">
            {datum(d.datum)} · {d.haendler} · {euro(d.preis_cent)}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Leiste für die Stapelverarbeitung: gewählte Artikel in eine andere Untergruppe verschieben */
function Umgruppieren({ artikel, onFertig, onAbbrechen }: { artikel: string[]; onFertig: (text: string) => void; onAbbrechen: () => void }) {
  const { daten: gruppen } = useDaten<Gruppe[]>("/api/gruppen");
  const [ziel, setZiel] = useState("");
  const [actualNeu, setActualNeu] = useState(true);
  const [arbeitet, setArbeitet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const verschieben = async () => {
    setArbeitet(true);
    setFehler(null);
    try {
      const e = await api.post<{ positionen: number; bons: number; gebucht: number; neuAufgeteilt: number; fehler: string[] }>("/api/artikel/umgruppieren", {
        artikel,
        gruppe_id: Number(ziel),
        actualNeu,
      });
      const actual = e.gebucht
        ? actualNeu
          ? " " + t("{neu} von {gebucht} gebuchten Bons in Actual neu aufgeteilt.", { neu: e.neuAufgeteilt, gebucht: e.gebucht })
          : " " + t("{n} bereits gebuchte Bons in Actual unverändert.", { n: e.gebucht })
        : "";
      onFertig(
        t("{positionen} Positionen auf {bons} Bons verschoben – künftige Bons werden ebenso eingeordnet.", { positionen: e.positionen, bons: e.bons }) +
          actual +
          (e.fehler.length ? " " + t("Fehler: {fehler}", { fehler: e.fehler.join("; ") }) : ""),
      );
    } catch (e) {
      setFehler((e as Error).message);
    } finally {
      setArbeitet(false);
    }
  };

  return (
    <div className="karte sticky top-0 z-10 mb-4 space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t("{n} Artikel", { n: artikel.length })}</span>
        <span className="text-text-3">{t("verschieben nach")}</span>
        <div className="w-64 max-w-full">
          <GruppenWahl gruppen={gruppen ?? []} wert={ziel ? Number(ziel) : null} onWahl={(id) => setZiel(id == null ? "" : String(id))} leer={t("– Untergruppe wählen –")} />
        </div>
        <button className="knopf-haupt py-1.5" disabled={!ziel || !artikel.length || arbeitet} onClick={() => void verschieben()}>
          {arbeitet ? t("Verschiebt …") : t("Verschieben")}
        </button>
        <button className="knopf-leise py-1.5" onClick={onAbbrechen}>
          {t("Abbrechen")}
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-text-2">
        <input type="checkbox" checked={actualNeu} onChange={(e) => setActualNeu(e.target.checked)} />
        {t("Bereits gebuchte Bons in Actual neu aufteilen (alte Aufteilung wird zurückgenommen und neu gebucht)")}
      </label>
      {fehler && <p className="text-sm text-fehler">{fehler}</p>}
    </div>
  );
}

type SortenZeile = { name: string; kaeufe: number; summe_cent: number; artikel: number; zuletzt: string; untergruppe: string; farbe: string };

/** Alle Sorten des Haushalts: durchsuchen, Einkäufe ansehen, umbenennen oder zusammenführen */
function Sorten() {
  const { darf } = useSitzung();
  const [suche, setSuche] = useState("");
  const [verzoegert, setVerzoegert] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ art: "gut" | "fehler"; text: string } | null>(null);
  useEffect(() => {
    const zeit = setTimeout(() => setVerzoegert(suche.trim()), 250);
    return () => clearTimeout(zeit);
  }, [suche]);
  const { daten, neuLaden } = useDaten<SortenZeile[]>(`/api/sorten/uebersicht${verzoegert ? `?suche=${encodeURIComponent(verzoegert)}` : ""}`);
  const { daten: alle } = useDaten<{ name: string }[]>("/api/sorten");

  const umbenennen = async (alt: string) => {
    const neu = prompt(t("Neuer Name für die Sorte „{name}“ (gleicher Name wie eine andere Sorte = zusammenführen):", { name: alt }), alt)?.trim();
    if (!neu || neu === alt) return;
    const ziel = alle?.find((s) => s.name.toLowerCase() === neu.toLowerCase() && s.name !== alt);
    if (ziel && !confirm(t("„{alt}“ mit der vorhandenen Sorte „{neu}“ zusammenführen?", { alt, neu: ziel.name }))) return;
    try {
      const e = await api.put<{ positionen: number }>("/api/sorten", { alt, neu: ziel?.name ?? neu });
      setMeldung({ art: "gut", text: t("{n} Positionen geändert – gelernte Regeln wurden mit angepasst.", { n: e.positionen }) });
      neuLaden();
    } catch (e) {
      setMeldung({ art: "fehler", text: (e as Error).message });
    }
  };

  return (
    <>
      {meldung && (
        <div className="mb-4">
          <Hinweis art={meldung.art}>{meldung.text}</Hinweis>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-0 max-w-md flex-1">
          <Symbol name="suche" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
          <input className="eingabe pl-9" placeholder={t("Sorte suchen, z. B. Tomate")} value={suche} onChange={(e) => setSuche(e.target.value)} />
        </div>
      </div>
      {daten && daten.length === 0 ? (
        <Leer titel={t("Keine Sorten gefunden")} text={t("Sorten entstehen beim Lesen der Bons oder wenn du beim Prüfen eine Sorte einträgst.")} />
      ) : (
        <div className="karte overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_2.5rem] gap-3 border-b border-rand px-4 py-2.5 text-xs font-semibold text-text-3 md:grid">
            <span>{t("Sorte")}</span>
            <span className="text-right">{t("Käufe")}</span>
            <span className="text-right">{t("Artikel")}</span>
            <span className="text-right">{t("Gesamt")}</span>
            <span />
          </div>
          <div className="divide-y divide-rand">
            {daten?.map((s) => (
              <div key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_2.5rem]">
                <button className="min-w-0 text-left hover:text-akzent" onClick={() => setDetail(s.name)}>
                  <div className="flex items-center gap-2">
                    <Farbpunkt farbe={s.farbe} />
                    <span className="truncate font-medium">{s.name}</span>
                  </div>
                  <div className="mt-0.5 truncate pl-[18px] text-xs text-text-3">
                    {s.untergruppe} · {t("zuletzt {datum}", { datum: datum(s.zuletzt) })}
                  </div>
                </button>
                <span className="text-right text-text-2 max-md:hidden">{s.kaeufe}×</span>
                <span className="text-right text-text-2 max-md:hidden">{s.artikel}</span>
                <span className="text-right font-semibold">
                  {euro(s.summe_cent)}
                  <span className="block text-xs font-normal text-text-3 md:hidden">{s.kaeufe}×</span>
                </span>
                {darf("bons_bearbeiten") ? (
                  <button className="knopf-leise justify-self-end px-2 text-text-3" title={t("Umbenennen oder zusammenführen")} aria-label={t("Umbenennen oder zusammenführen")} onClick={() => void umbenennen(s.name)}>
                    <Symbol name="stift" className="size-4" />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {detail && <PostenListe titel={detail} unter={t("Alle Einkäufe dieser Sorte")} filter={{ sorte: detail }} onSchliessen={() => setDetail(null)} />}
    </>
  );
}

export function Artikel() {
  const { darf } = useSitzung();
  const [ansicht, setAnsicht] = useState<"artikel" | "sorten">("artikel");
  const [suche, setSuche] = useState("");
  const [verzoegert, setVerzoegert] = useState("");
  const [offen, setOffen] = useState<string | null>(null);
  const [gruppe, setGruppe] = useState("");
  const [auswahl, setAuswahl] = useState<Set<string> | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  useEffect(() => {
    const zeit = setTimeout(() => setVerzoegert(suche.trim()), 250);
    return () => clearTimeout(zeit);
  }, [suche]);

  const pfad = useMemo(() => {
    const p = new URLSearchParams();
    if (verzoegert) p.set("suche", verzoegert);
    if (gruppe) p.set("unter", gruppe);
    return `/api/artikel${p.size ? `?${p}` : ""}`;
  }, [verzoegert, gruppe]);
  const { daten, neuLaden } = useDaten<ArtikelZeile[]>(pfad);
  const untergruppen = useMemo(() => [...new Set((daten ?? []).map((a) => a.untergruppe))].sort(), [daten]);
  const [alleGruppen, setAlleGruppen] = useState<string[]>([]);
  // Gruppenliste für den Filter nur aus der ungefilterten Ansicht merken
  useEffect(() => {
    if (!gruppe && !verzoegert && untergruppen.length) setAlleGruppen(untergruppen);
  }, [gruppe, verzoegert, untergruppen]);

  const umschalten = (name: string) =>
    setAuswahl((alt) => {
      const neu = new Set(alt ?? []);
      if (neu.has(name)) neu.delete(name);
      else neu.add(name);
      return neu;
    });

  return (
    <>
      <Kopf
        titel={t("Artikel")}
        unter={t("Was wird wie oft gekauft – und wie entwickeln sich die Preise?")}
        rechts={
          ansicht === "artikel" &&
          darf("bons_bearbeiten") &&
          (auswahl ? (
            <button className="knopf-zweit" onClick={() => setAuswahl(new Set(daten?.map((a) => a.name)))}>
              {t("Alle angezeigten wählen")}
            </button>
          ) : (
            <button className="knopf-zweit" onClick={() => (setAuswahl(new Set()), setMeldung(null))}>
              <Symbol name="haken" className="size-4" /> {t("Gruppe ändern")}
            </button>
          ))
        }
      />
      <div className="mb-4 inline-flex rounded-xl border border-rand bg-flaeche-2 p-1 text-sm" role="tablist">
        {(["artikel", "sorten"] as const).map((a) => (
          <button
            key={a}
            role="tab"
            aria-selected={ansicht === a}
            className={`rounded-lg px-3 py-1.5 font-medium ${ansicht === a ? "bg-flaeche text-text shadow-sm" : "text-text-3 hover:text-text"}`}
            onClick={() => (setAnsicht(a), setAuswahl(null))}
          >
            {a === "artikel" ? t("Artikel") : t("Sorten")}
          </button>
        ))}
      </div>
      {ansicht === "sorten" ? (
        <Sorten />
      ) : (
        <>
      {auswahl && (
        <Umgruppieren
          artikel={[...auswahl]}
          onAbbrechen={() => setAuswahl(null)}
          onFertig={(text) => (setMeldung(text), setAuswahl(null), neuLaden())}
        />
      )}
      {meldung && (
        <div className="mb-4">
          <Hinweis art="gut">{meldung}</Hinweis>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-0 max-w-md flex-1">
          <Symbol name="suche" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
          <input className="eingabe pl-9" placeholder={t("Artikel suchen, z. B. Milch")} value={suche} onChange={(e) => setSuche(e.target.value)} />
        </div>
        <select className="eingabe w-auto" value={gruppe} onChange={(e) => setGruppe(e.target.value)} aria-label={t("Nach Untergruppe filtern")}>
          <option value="">{t("Alle Gruppen")}</option>
          {(alleGruppen.length ? alleGruppen : untergruppen).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {daten && daten.length === 0 ? (
        <Leer titel={t("Keine Artikel gefunden")} text={t("Artikel erscheinen hier, sobald Bons geprüft wurden.")} />
      ) : (
        <div className="karte overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1fr)_6rem_7rem_7rem_7rem] gap-3 border-b border-rand px-4 py-2.5 text-xs font-semibold text-text-3 md:grid">
            <span>{t("Artikel")}</span>
            <span className="text-right">{t("Käufe")}</span>
            <span className="text-right">{t("Letzter Preis")}</span>
            <span className="text-right">{t("Spanne")}</span>
            <span className="text-right">{t("Gesamt")}</span>
          </div>
          <div className="divide-y divide-rand">
            {daten?.map((a) => {
              const schluessel = a.name + "|" + a.untergruppe;
              return (
                <div key={schluessel}>
                  <button
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 text-left text-sm transition hover:bg-flaeche-2 md:grid-cols-[minmax(0,1fr)_6rem_7rem_7rem_7rem] md:items-center ${
                      auswahl?.has(a.name) ? "bg-akzent-hell/50" : ""
                    }`}
                    onClick={() => (auswahl ? umschalten(a.name) : setOffen(offen === schluessel ? null : schluessel))}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {auswahl && <input type="checkbox" className="size-4 shrink-0" checked={auswahl.has(a.name)} readOnly tabIndex={-1} />}
                        <Farbpunkt farbe={a.farbe} />
                        <span className="truncate font-medium">{a.name}</span>
                      </div>
                      <div className="mt-0.5 truncate pl-[18px] text-xs text-text-3">
                        {a.untergruppe} · {a.haendler.filter(Boolean).join(", ")} · {t("zuletzt {datum}", { datum: datum(a.zuletzt) })}
                      </div>
                    </div>
                    <span className="text-right text-text-2 max-md:hidden">{a.kaeufe}×</span>
                    <span className="text-right font-medium max-md:hidden">{euro(a.letzter_cent)}</span>
                    <span className="text-right text-xs text-text-2 max-md:hidden">
                      {a.min_cent === a.max_cent ? "–" : `${euro(a.min_cent)} – ${euro(a.max_cent)}`}
                    </span>
                    <span className="text-right font-semibold">
                      {euro(a.summe_cent)}
                      <span className="block text-xs font-normal text-text-3 md:hidden">{a.kaeufe}× · {euro(a.letzter_cent)}</span>
                    </span>
                  </button>
                  {offen === schluessel && <Preisverlauf name={a.name} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
        </>
      )}
    </>
  );
}
