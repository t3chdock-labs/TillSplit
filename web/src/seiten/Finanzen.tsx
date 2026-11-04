import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Farbpunkt, Kopf, Leer, useDaten } from "../komponenten/Bausteine";
import { Diagramm, themaFarben } from "../komponenten/Diagramm";
import { Symbol } from "../komponenten/Symbol";
import { datum, euro, euroGerundet, iso } from "../format";
import {
  autoRaster,
  bereichVon,
  hineinZoomen,
  periodenListe,
  periodenText,
  rasterJe,
  rasterNach,
  rasterNamen,
  titelVon,
  verschieben,
  type Ansicht,
  type Bereich,
  type Raster,
} from "../zeit";
import { Abschnitt, ansichten, grau, Kennzahl, mitUebrigen, palette, UEBRIGE, vergleichText } from "./Uebersicht";
import { t } from "../i18n";

type Summe = { name: string; summe_cent: number; anzahl?: number };
type FinanzDaten = {
  kennzahlen: { ausgaben_cent: number; einnahmen_cent: number; buchungen: number };
  vorher: { ausgaben_cent: number; einnahmen_cent: number } | null;
  ebene: Summe[];
  verlauf: { periode: string; name: string; summe_cent: number }[];
  einnahmenVerlauf: { periode: string; summe_cent: number }[];
  empfaenger: Summe[];
  groesste: { datum: string; empfaenger: string; kategorie: string; konto: string; notiz: string | null; betrag_cent: number }[];
  vermoegen: { periode: string; name: string; saldo_cent: number }[];
  budgets: { sync_id: string; name: string; eingelesen: string | null; buchungen: number | null; fehler: string | null }[];
};

/** Feste Farbe je Name, damit „Wohnen“ in allen Ansichten gleich aussieht */
function farbeFuer(name: string): string {
  if (name === UEBRIGE || name === t("Ohne Kategorie") || name === "Ohne Kategorie") return grau;
  let h = 0;
  for (const z of name) h = (h * 31 + z.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

const einnahmenFarbe = "#16a34a";

export function Finanzen() {
  const [ansicht, setAnsicht] = useState<Ansicht>("jahr");
  const [anker, setAnker] = useState(() => new Date());
  const [frei, setFrei] = useState<Bereich>(() => {
    const heute = new Date();
    return { von: iso(new Date(heute.getFullYear() - 1, heute.getMonth(), 1)), bis: iso(heute) };
  });
  const [rasterWahl, setRasterWahl] = useState<Raster | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [gruppe, setGruppeRoh] = useState<string | null>(null);
  const [kategorie, setKategorie] = useState<string | null>(null);
  const setGruppe = (g: string | null) => (setGruppeRoh(g), setKategorie(null));
  const [liest, setLiest] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  const bereich = useMemo(() => bereichVon(ansicht, anker, frei), [ansicht, anker, frei]);
  const raster = rasterWahl ?? autoRaster(ansicht, bereich);
  const ansichtWechseln = (neu: Ansicht, neuerAnker = anker) => {
    setAnsicht(neu);
    setAnker(neuerAnker);
    setRasterWahl(null);
  };

  const pfad = useMemo(() => {
    const p = new URLSearchParams({ raster });
    if (bereich.von) p.set("von", bereich.von);
    if (bereich.bis) p.set("bis", bereich.bis);
    if (budget) p.set("budget", budget);
    if (gruppe) p.set("gruppe", gruppe);
    if (kategorie) p.set("kategorie", kategorie);
    return `/api/finanzen?${p}`;
  }, [bereich, raster, budget, gruppe, kategorie]);
  const { daten, fehler, neuLaden } = useDaten<FinanzDaten>(pfad);
  const f = themaFarben();

  const einlesen = async () => {
    setLiest(true);
    setMeldung(null);
    try {
      const erg = await api.post<{ budget: string; buchungen?: number; fehler?: string }[]>("/api/finanzen/einlesen", {});
      setMeldung(erg.map((e) => (e.fehler ? `${e.budget}: ${e.fehler}` : `${e.budget}: ${t("{n} Buchungen", { n: e.buchungen })}`)).join(" · "));
      neuLaden();
    } catch (e) {
      setMeldung((e as Error).message);
    } finally {
      setLiest(false);
    }
  };

  // Ebene: Gruppen -> Kategorien -> Empfänger (dort die größten 10 einzeln)
  const ebene = useMemo(() => {
    if (!daten) return [];
    const liste = kategorie ? (mitUebrigen(daten.ebene.map((e) => ({ ...e, farbe: "" })), 10) as Summe[]) : daten.ebene;
    return liste.map((e, i) => ({ ...e, farbe: kategorie ? (e.name === UEBRIGE ? grau : palette[i % palette.length]) : farbeFuer(e.name) }));
  }, [daten, kategorie]);
  const tiefer = (name: string) => {
    if (name === UEBRIGE) return;
    if (!gruppe) setGruppe(name);
    else if (!kategorie) setKategorie(name);
  };

  const diagramme = useMemo(() => {
    if (!daten) return null;
    const achse = { axisLine: { lineStyle: { color: f.rand } }, axisLabel: { color: f.leise }, splitLine: { lineStyle: { color: f.rand } } };
    const ausgaben = daten.kennzahlen.ausgaben_cent;

    const kreis = {
      tooltip: { trigger: "item", valueFormatter: (v: number) => euro(v) },
      series: [
        {
          type: "pie",
          radius: ["58%", "86%"],
          padAngle: 2,
          itemStyle: { borderRadius: 6 },
          label: { show: false },
          data: ebene.map((g) => ({ name: g.name, value: g.summe_cent, itemStyle: { color: g.farbe } })),
        },
      ],
    };

    const empf = daten.empfaenger.slice(0, 12).reverse();
    const empfaenger = {
      grid: { left: 8, right: 16, top: 4, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => euro(v) },
      xAxis: { type: "value", splitNumber: 3, ...achse, axisLabel: { color: f.leise, formatter: (v: number) => euroGerundet(v) } },
      yAxis: {
        type: "category",
        data: empf.map((e) => e.name),
        ...achse,
        axisTick: { show: false },
        axisLabel: { color: f.text, width: 150, overflow: "truncate" },
      },
      series: [
        {
          type: "bar",
          barWidth: "60%",
          data: empf.map((e) => ({ value: e.summe_cent, itemStyle: { color: "#0f766e", borderRadius: [0, 6, 6, 0] } })),
        },
      ],
    };

    // Verlauf: Ausgaben gestapelt nach Ebene, Einnahmen als Linie
    const vorhanden = [...daten.verlauf.map((v) => v.periode), ...daten.einnahmenVerlauf.map((v) => v.periode)].sort();
    const von = bereich.von ?? vorhanden[0];
    const bis = bereich.bis ?? vorhanden[vorhanden.length - 1];
    const perioden = von && bis ? periodenListe(von, bis, raster) : [];
    const oben = new Set(ebene.slice(0, 8).map((e) => e.name).filter((n) => n !== UEBRIGE));
    const werte = new Map<string, number>();
    for (const v of daten.verlauf) {
      const name = oben.has(v.name) ? v.name : UEBRIGE;
      werte.set(`${v.periode}|${name}`, (werte.get(`${v.periode}|${name}`) ?? 0) + v.summe_cent);
    }
    const reihen = [...oben, ...(daten.verlauf.some((v) => !oben.has(v.name)) ? [UEBRIGE] : [])];
    const farben = new Map(ebene.map((e) => [e.name, e.farbe]));
    const einnahmen = new Map(daten.einnahmenVerlauf.map((v) => [v.periode, v.summe_cent]));
    const mitEinnahmen = !gruppe && !kategorie;
    const viele = perioden.length > 40;
    const verlauf = {
      grid: { left: 8, right: 8, top: 36, bottom: viele ? 28 : 4, containLabel: true },
      legend: { top: 0, type: "scroll", icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: f.text } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => euro(v) },
      dataZoom: viele ? [{ type: "inside", startValue: perioden.length - 40 }, { type: "slider", height: 14, bottom: 4, startValue: perioden.length - 40 }] : [],
      xAxis: { type: "category", data: perioden.map((p) => periodenText(p, raster, perioden.length <= 7)), ...achse, axisTick: { show: false } },
      yAxis: { type: "value", ...achse, axisLabel: { color: f.leise, formatter: (v: number) => euroGerundet(v) } },
      series: [
        ...reihen.map((name) => ({
          name,
          type: "bar",
          stack: "ausgaben",
          barMaxWidth: 42,
          itemStyle: { color: farben.get(name) ?? grau },
          data: perioden.map((p) => werte.get(`${p}|${name}`) ?? 0),
        })),
        ...(mitEinnahmen
          ? [{
              name: t("Einnahmen"),
              type: "line",
              smooth: true,
              symbolSize: 6,
              itemStyle: { color: einnahmenFarbe },
              lineStyle: { width: 2.5 },
              // künftige Perioden leer lassen statt auf 0 abfallen
              data: perioden.map((p) => (p <= iso(new Date()) ? (einnahmen.get(p) ?? 0) : null)),
            }]
          : []),
      ],
    };

    // Vermögen: Kontostände gestapelt, Summe im Tooltip
    const vPerioden = [...new Set(daten.vermoegen.map((v) => v.periode))].sort();
    const vKonten = [...new Set(daten.vermoegen.map((v) => v.name))];
    const vWert = new Map(daten.vermoegen.map((v) => [`${v.periode}|${v.name}`, v.saldo_cent]));
    const vermoegen = {
      grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
      legend: { top: 0, type: "scroll", icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: f.text } },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => euro(v),
      },
      xAxis: { type: "category", boundaryGap: false, data: vPerioden.map((p) => periodenText(p, raster === "jahr" ? "jahr" : "monat", false)), ...achse, axisTick: { show: false } },
      yAxis: { type: "value", ...achse, axisLabel: { color: f.leise, formatter: (v: number) => euroGerundet(v) } },
      series: vKonten.map((name, i) => ({
        name,
        type: "line",
        stack: "vermoegen",
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.25 },
        itemStyle: { color: palette[(i + 3) % palette.length] },
        data: vPerioden.map((p) => vWert.get(`${p}|${name}`) ?? 0),
      })),
    };
    const vLetzte = vPerioden[vPerioden.length - 1];
    const vErste = vPerioden[0];
    const vSumme = (p?: string) => (p ? vKonten.reduce((s, k) => s + (vWert.get(`${p}|${k}`) ?? 0), 0) : 0);
    const bisher = Math.max(1, perioden.filter((p) => p <= iso(new Date())).length);

    return { kreis, empfaenger, verlauf, vermoegen, perioden, ausgaben, bisher, vermoegenJetzt: vSumme(vLetzte), vermoegenStart: vSumme(vErste), hatVermoegen: vKonten.length > 0 };
  }, [daten, ebene, gruppe, kategorie, bereich, raster, f.rand, f.leise, f.text]);

  const k = daten?.kennzahlen;
  const trend = k && daten?.vorher?.ausgaben_cent ? ((k.ausgaben_cent - daten.vorher.ausgaben_cent) / daten.vorher.ausgaben_cent) * 100 : null;
  const saldo = k ? k.einnahmen_cent - k.ausgaben_cent : 0;
  const sparquote = k?.einnahmen_cent ? Math.round((saldo / k.einnahmen_cent) * 100) : null;
  const stand = daten?.budgets.map((b) => b.eingelesen).filter(Boolean).sort().at(-1);
  const ohneDaten = daten && daten.budgets.every((b) => !b.buchungen);

  return (
    <>
      <Kopf
        titel={t("Finanzen")}
        unter={t("Einnahmen, Ausgaben und Vermögen aus Actual")}
        rechts={
          <div className="flex flex-wrap gap-1.5">
            {ansichten.map((a) => (
              <button key={a.wert} className={`chip ${ansicht === a.wert ? "chip-aktiv" : ""}`} onClick={() => ansichtWechseln(a.wert)}>
                {a.text}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ansicht === "frei" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input type="date" className="eingabe w-auto" value={frei.von ?? ""} max={frei.bis} onChange={(e) => setFrei({ ...frei, von: e.target.value })} />
            <span className="text-text-3">{t("bis")}</span>
            <input type="date" className="eingabe w-auto" value={frei.bis ?? ""} min={frei.von} onChange={(e) => setFrei({ ...frei, bis: e.target.value })} />
          </div>
        ) : (
          <>
            {ansicht !== "alles" && (
              <button className="knopf-leise px-2" title={t("Zurück")} onClick={() => setAnker(verschieben(ansicht, anker, -1))}>
                <Symbol name="zurueck" className="size-4" />
              </button>
            )}
            <h2 className="min-w-0 text-lg font-semibold">{titelVon(ansicht, anker, bereich)}</h2>
            {ansicht !== "alles" && (
              <>
                <button className="knopf-leise px-2" title={t("Weiter")} onClick={() => setAnker(verschieben(ansicht, anker, 1))}>
                  <Symbol name="weiter" className="size-4" />
                </button>
                <button className="knopf-leise text-xs" onClick={() => setAnker(new Date())}>
                  {t("Heute")}
                </button>
              </>
            )}
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {daten && daten.budgets.length > 1 && (
            <>
              <button className={`chip ${budget == null ? "chip-aktiv" : ""}`} onClick={() => setBudget(null)}>
                {t("Alle Budgets")}
              </button>
              {daten.budgets.map((b) => (
                <button key={b.sync_id} className={`chip ${budget === b.sync_id ? "chip-aktiv" : ""}`} onClick={() => setBudget(b.sync_id)}>
                  {b.name}
                </button>
              ))}
            </>
          )}
          <button className="knopf-leise text-xs" onClick={einlesen} disabled={liest} title={stand ? t("Stand: {stand}", { stand }) : undefined}>
            <Symbol name="aktualisieren" className={`size-3.5 ${liest ? "animate-spin" : ""}`} /> {liest ? t("Liest …") : stand ? t("Stand {stand}", { stand }) : t("Einlesen")}
          </button>
        </div>
      </div>

      {meldung && <p className="mb-3 text-xs text-text-2">{meldung}</p>}
      {fehler && <p className="text-sm text-fehler">{fehler}</p>}
      {daten?.budgets.filter((b) => b.fehler).map((b) => (
        <p key={b.sync_id} className="mb-2 text-sm text-fehler">
          {b.name}: {b.fehler}
        </p>
      ))}

      {ohneDaten ? (
        <Leer
          titel={t("Noch keine Daten aus Actual")}
          text={t("Die Buchungen werden nach dem Start automatisch eingelesen. Budgets und Vermögenskonten legst du unter Einstellungen → Finanzen fest.")}
          aktion={
            <button className="knopf-haupt" onClick={einlesen} disabled={liest}>
              <Symbol name="aktualisieren" className="size-4" /> {t("Jetzt einlesen")}
            </button>
          }
        />
      ) : (
        daten &&
        k &&
        diagramme && (
          <div className="space-y-4">
            {gruppe && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button className="chip" onClick={() => setGruppe(null)}>
                  {t("Alle Gruppen")}
                </button>
                <Symbol name="weiter" className="size-3.5 text-text-3" />
                <button className={`chip ${kategorie ? "" : "chip-aktiv"}`} onClick={() => setKategorie(null)}>
                  {gruppe}
                </button>
                {kategorie && (
                  <>
                    <Symbol name="weiter" className="size-3.5 text-text-3" />
                    <span className="chip chip-aktiv">{kategorie}</span>
                  </>
                )}
                {(kategorie === "Lebensmittel" || gruppe === "Essen") && (
                  <Link to="/" className="ml-1 text-xs font-medium text-akzent hover:underline">
                    {t("Details aus den Bons →")}
                  </Link>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kennzahl titel={t("Ausgaben")} wert={euro(k.ausgaben_cent)} trend={trend} unter={trend != null ? (vergleichText[ansicht] ?? t("zum Vorzeitraum")) : t("{n} Buchungen", { n: k.buchungen })} />
              {!gruppe ? (
                <>
                  <Kennzahl titel={t("Einnahmen")} wert={euro(k.einnahmen_cent)} unter={daten.vorher ? t("vorher {n}", { n: euroGerundet(daten.vorher.einnahmen_cent) }) : undefined} />
                  <Kennzahl titel={t("Überschuss")} wert={euro(saldo)} unter={sparquote != null ? t("Sparquote {n} %", { n: sparquote }) : undefined} />
                </>
              ) : (
                <>
                  <Kennzahl titel={t("Buchungen")} wert={String(k.buchungen)} />
                  <Kennzahl titel={`Ø ${rasterJe[raster]}`} wert={euro(Math.round(k.ausgaben_cent / diagramme.bisher))} />
                </>
              )}
              {diagramme.hatVermoegen ? (
                <Kennzahl
                  titel={t("Vermögen (Depots)")}
                  wert={euroGerundet(diagramme.vermoegenJetzt)}
                  trend={diagramme.vermoegenStart ? ((diagramme.vermoegenJetzt - diagramme.vermoegenStart) / Math.abs(diagramme.vermoegenStart)) * 100 : null}
                  trendGut="rauf"
                  unter={t("im Zeitraum")}
                />
              ) : (
                <Kennzahl titel={t("Ø Ausgaben")} wert={euro(Math.round(k.ausgaben_cent / diagramme.bisher))} unter={rasterJe[raster]} />
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Abschnitt titel={kategorie ? t("{name} nach Empfängern", { name: kategorie }) : gruppe ? t("{name} nach Kategorien", { name: gruppe }) : t("Ausgaben nach Gruppen")} className="lg:col-span-2">
                <div className="relative">
                  <Diagramm optionen={diagramme.kreis} hoehe={240} onKlick={tiefer} />
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-xs text-text-3">{t("Ausgaben")}</div>
                    <div className="text-lg font-semibold">{euroGerundet(k.ausgaben_cent)}</div>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {ebene.map((g) => (
                    <li key={g.name}>
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-sm hover:bg-flaeche-2 disabled:hover:bg-transparent"
                        onClick={() => tiefer(g.name)}
                        disabled={!!kategorie}
                      >
                        <Farbpunkt farbe={g.farbe} />
                        <span className="flex-1 truncate">{g.name}</span>
                        <span className="text-text-3">{k.ausgaben_cent ? Math.round((g.summe_cent / k.ausgaben_cent) * 100) : 0} %</span>
                        <span className="w-24 text-right font-medium">{euro(g.summe_cent)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Abschnitt>
              <Abschnitt titel={t("Größte Empfänger")} className="lg:col-span-3">
                <Diagramm optionen={diagramme.empfaenger} hoehe={Math.max(200, Math.min(12, daten.empfaenger.length) * 30 + 20)} />
              </Abschnitt>
            </div>

            {diagramme.perioden.length > 1 && (
              <Abschnitt
                titel={`${gruppe ? t("Ausgaben") : t("Einnahmen und Ausgaben")} ${rasterNach[raster]}`}
                rechts={
                  <div className="flex flex-wrap justify-end gap-1">
                    {(Object.keys(rasterNamen) as Raster[]).map((r) => (
                      <button key={r} className={`chip text-xs ${raster === r ? "chip-aktiv" : ""}`} onClick={() => setRasterWahl(r)}>
                        {rasterNamen[r]}
                      </button>
                    ))}
                  </div>
                }
              >
                {raster !== "tag" && <p className="-mt-1 mb-2 text-xs text-text-2">{t("Balken anklicken, um hineinzuzoomen")}</p>}
                <Diagramm
                  optionen={diagramme.verlauf}
                  hoehe={320}
                  onKlick={(_, __, index) => {
                    const ziel = index != null ? hineinZoomen(diagramme.perioden[index], raster) : null;
                    if (ziel) ansichtWechseln(ziel.ansicht, ziel.anker);
                  }}
                />
              </Abschnitt>
            )}

            <div className="grid gap-4 lg:grid-cols-5">
              {diagramme.hatVermoegen && (
                <Abschnitt titel={t("Vermögensverlauf")} className="lg:col-span-3">
                  <Diagramm optionen={diagramme.vermoegen} hoehe={280} />
                </Abschnitt>
              )}
              <Abschnitt titel={t("Größte Ausgaben")} className={diagramme.hatVermoegen ? "lg:col-span-2" : "lg:col-span-5"}>
                <div className="divide-y divide-rand">
                  {daten.groesste.length === 0 && <p className="py-3 text-sm text-text-2">{t("Keine Ausgaben im Zeitraum.")}</p>}
                  {daten.groesste.map((g, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{g.empfaenger}</div>
                        <div className="truncate text-xs text-text-3">
                          {datum(g.datum)} · {g.kategorie} · {g.konto}
                        </div>
                      </div>
                      <span className="font-medium">{euro(g.betrag_cent)}</span>
                    </div>
                  ))}
                </div>
              </Abschnitt>
            </div>
          </div>
        )
      )}
    </>
  );
}
