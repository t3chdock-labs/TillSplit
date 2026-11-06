import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Farbpunkt, Kopf, Leer, useDaten } from "../komponenten/Bausteine";
import { Diagramm, themaFarben } from "../komponenten/Diagramm";
import { useHochladen } from "../komponenten/Hochladen";
import { PostenListe } from "../komponenten/PostenListe";
import { Symbol } from "../komponenten/Symbol";
import { euro, euroGerundet, iso, wochentage } from "../format";
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
import { t } from "../i18n";

type Summe = { name: string; farbe: string; summe_cent: number; anzahl?: number };
type Auswertung = {
  kennzahlen: { summe_cent: number; bons: number; positionen: number; artikel: number };
  vorher: { summe_cent: number; bons: number } | null;
  hauptgruppen: Summe[];
  untergruppen: (Summe & { hauptgruppe: string })[];
  sorten: (Summe & { untergruppe: string })[];
  verlauf: { periode: string; name: string; farbe: string | null; summe_cent: number }[];
  haendler: { name: string; summe_cent: number; bons: number }[];
  artikel: { name: string; untergruppe: string; farbe: string; kaeufe: number; summe_cent: number; schnitt_cent: number }[];
  wochentage: { tag: number; summe_cent: number; bons: number }[];
};

export const ansichten: { wert: Ansicht; text: string }[] = [
  { wert: "woche", text: t("Woche") },
  { wert: "monat", text: t("Monat") },
  { wert: "jahr", text: t("Jahr") },
  { wert: "alles", text: t("Alles") },
  { wert: "frei", text: t("Frei") },
];

// Farben für Sorten (die haben keine eigene Farbe)
export const palette = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#db2777", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#65a30d"];
export const grau = "#94a3b8";
/** Sammeleintrag für den Rest einer Liste */
export const UEBRIGE = t("Übrige");

/** Die größten n Einträge einzeln, den Rest als „Übrige“ */
export function mitUebrigen<T extends Summe>(liste: T[], n: number): Summe[] {
  if (liste.length <= n + 1) return liste;
  const rest = liste.slice(n).reduce((s, e) => s + e.summe_cent, 0);
  return [...liste.slice(0, n), { name: UEBRIGE, farbe: grau, summe_cent: rest }];
}

const KONTO_SPEICHER = "tillsplit:uebersicht-konto";

export const vergleichText: Partial<Record<Ansicht, string>> = { woche: t("zur Vorwoche"), monat: t("zum Vormonat"), jahr: t("zum Vorjahr") };

export function Kennzahl({ titel, wert, unter, trend, trendGut = "runter" }: { titel: string; wert: string; unter?: string; trend?: number | null; trendGut?: "rauf" | "runter" }) {
  const schlecht = trend != null && (trendGut === "runter" ? trend > 0 : trend < 0);
  return (
    <div className="karte p-5">
      <div className="ueberschrift">{titel}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight md:text-[28px]">{wert}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-text-2">
        {trend != null && Number.isFinite(trend) && (
          <span className={`whitespace-nowrap font-semibold ${schlecht ? "text-fehler" : "text-gut"}`}>
            {trend > 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(0)} %
          </span>
        )}
        {unter}
      </div>
    </div>
  );
}

export function Abschnitt({ titel, rechts, children, className = "" }: { titel: string; rechts?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`karte p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{titel}</h2>
        {rechts}
      </div>
      {children}
    </section>
  );
}

export function Uebersicht() {
  const [ansicht, setAnsicht] = useState<Ansicht>("monat");
  const [anker, setAnker] = useState(() => new Date());
  const [frei, setFrei] = useState<Bereich>(() => {
    const heute = new Date();
    return { von: iso(new Date(heute.getFullYear(), heute.getMonth() - 2, 1)), bis: iso(heute) };
  });
  const [rasterWahl, setRasterWahl] = useState<Raster | null>(null);
  const [haupt, setHauptRoh] = useState<string | null>(null);
  const [unter, setUnter] = useState<string | null>(null);
  const setHaupt = (name: string | null) => (setHauptRoh(name), setUnter(null));
  const { auswaehlen } = useHochladen();
  // Detailliste: die einzelnen Posten hinter einem Balken/Eintrag, mit Link auf den Bon
  const [detail, setDetail] = useState<{ titel: string; filter: Record<string, string> } | null>(null);
  // Filter auf ein Actual-Konto (nur Bons, die diesem Konto zugeordnet sind); die Wahl merkt sich das Gerät
  const { daten: konten, fehler: kontenFehler } = useDaten<{ id: string; name: string; budget_name: string | null; bons: number }[]>("/api/auswertung/konten");
  const [kontoWahl, setKontoWahl] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KONTO_SPEICHER);
    } catch {
      return null;
    }
  });
  // gespeichertes Konto, das es nicht (mehr) gibt, ignorieren
  const konto = konten && kontoWahl && konten.some((k) => k.id === kontoWahl) ? kontoWahl : null;
  const kontoSetzen = (id: string | null) => {
    setKontoWahl(id);
    try {
      if (id) localStorage.setItem(KONTO_SPEICHER, id);
      else localStorage.removeItem(KONTO_SPEICHER);
    } catch {
      /* privates Fenster */
    }
  };
  const mehrereBudgets = new Set(konten?.map((k) => k.budget_name).filter(Boolean)).size > 1;

  const bereich = useMemo(() => bereichVon(ansicht, anker, frei), [ansicht, anker, frei]);
  const postenZeigen = (titel: string, filter: Record<string, string>) =>
    setDetail({
      titel,
      // aktueller Zeitraum, gewählter Bereich/Gruppe und Konto gelten mit
      filter: {
        ...(bereich.von ? { von: bereich.von } : {}),
        ...(bereich.bis ? { bis: bereich.bis } : {}),
        ...(haupt ? { haupt } : {}),
        ...(unter ? { unter } : {}),
        ...(konto ? { konto } : {}),
        ...filter,
      },
    });
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
    if (haupt) p.set("haupt", haupt);
    if (unter) p.set("unter", unter);
    if (konto) p.set("konto", konto);
    return `/api/auswertung?${p}`;
  }, [bereich, raster, haupt, unter, konto]);
  // erst laden, wenn feststeht, ob ein gemerktes Konto noch gilt (sonst zweimal laden)
  const bereit = konten != null || kontenFehler != null || kontoWahl == null;
  const { daten, fehler } = useDaten<Auswertung>(bereit ? pfad : null);
  const f = themaFarben();

  // Aktuelle Ebene: Bereiche -> Gruppen -> Sorten
  const ebene: Summe[] = useMemo(() => {
    if (!daten) return [];
    if (!haupt) return daten.hauptgruppen;
    if (!unter) return daten.untergruppen;
    return mitUebrigen(daten.sorten, 10).map((s, i) => ({ ...s, farbe: s.name === UEBRIGE ? grau : palette[i % palette.length] }));
  }, [daten, haupt, unter]);
  const tiefer = (name: string) => {
    if (!haupt) setHaupt(name);
    else if (!unter) setUnter(name);
    // unterste Ebene (Sorten): die einzelnen Posten zeigen
    else if (name !== UEBRIGE) postenZeigen(name, { sorte: name });
  };
  /** Posten eines Eintrags der aktuellen Ebene (Bereich, Gruppe oder Sorte) */
  const postenDerEbene = (name: string) =>
    !haupt ? postenZeigen(name, { haupt: name }) : !unter ? postenZeigen(name, { unter: name }) : postenZeigen(name, { sorte: name });

  const diagramme = useMemo(() => {
    if (!daten) return null;
    const achse = { axisLine: { lineStyle: { color: f.rand } }, axisLabel: { color: f.leise }, splitLine: { lineStyle: { color: f.rand } } };
    const sortenFarbe = new Map(ebene.map((e) => [e.name, e.farbe]));

    const kreis = {
      tooltip: { trigger: "item", valueFormatter: (v: number) => euro(v) },
      series: [
        {
          type: "pie",
          radius: ["58%", "86%"],
          padAngle: 2,
          itemStyle: { borderRadius: 6 },
          label: { show: false },
          data: ebene.map((g) => ({
            name: g.name,
            value: g.summe_cent,
            itemStyle: { color: g.farbe },
          })),
        },
      ],
    };

    // Größte Posten immer auf Sorten-Ebene (Cola, Tomate, Schokolade …)
    const posten = daten.sorten.slice(0, 12).reverse();
    const balken = {
      grid: { left: 8, right: 16, top: 4, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => euro(v) },
      xAxis: { type: "value", ...achse, axisLabel: { color: f.leise, formatter: (v: number) => euroGerundet(v) } },
      yAxis: { type: "category", data: posten.map((u) => u.name), ...achse, axisTick: { show: false }, axisLabel: { color: f.text } },
      series: [
        {
          type: "bar",
          barWidth: "60%",
          data: posten.map((u) => ({ value: u.summe_cent, itemStyle: { color: (unter && sortenFarbe.get(u.name)) || u.farbe, borderRadius: [0, 6, 6, 0] } })),
        },
      ],
    };

    // Alle Perioden des Zeitraums, auch die ohne Einkauf
    const vorhanden = daten.verlauf.map((v) => v.periode).sort();
    const von = bereich.von ?? vorhanden[0];
    const bis = bereich.bis ?? vorhanden[vorhanden.length - 1];
    const perioden = von && bis ? periodenListe(von, bis, raster) : [];
    // Auf Sorten-Ebene nur die größten einzeln zeigen, Rest als „Übrige“
    const oben = new Set(ebene.map((e) => e.name));
    const verlaufDaten = unter ? daten.verlauf.map((v) => (oben.has(v.name) ? v : { ...v, name: UEBRIGE })) : daten.verlauf;
    const gruppen: [string, string][] = unter
      ? ebene.map((e) => [e.name, e.farbe])
      : [...new Map(verlaufDaten.map((v) => [v.name, v.farbe ?? grau])).entries()];
    const werte = new Map<string, number>();
    for (const v of verlaufDaten) werte.set(`${v.periode}|${v.name}`, (werte.get(`${v.periode}|${v.name}`) ?? 0) + v.summe_cent);
    const viele = perioden.length > 40;
    const verlauf = {
      grid: { left: 8, right: 8, top: 36, bottom: viele ? 28 : 4, containLabel: true },
      legend: { top: 0, type: "scroll", icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: f.text } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => euro(v) },
      dataZoom: viele ? [{ type: "inside", startValue: perioden.length - 40 }, { type: "slider", height: 14, bottom: 4, startValue: perioden.length - 40 }] : [],
      xAxis: {
        type: "category",
        data: perioden.map((p) => periodenText(p, raster, perioden.length <= 7)),
        ...achse,
        axisTick: { show: false },
      },
      yAxis: { type: "value", ...achse, axisLabel: { color: f.leise, formatter: (v: number) => euroGerundet(v) } },
      series: gruppen.map(([name, farbe]) => ({
        name,
        type: "bar",
        stack: "summe",
        barMaxWidth: 42,
        itemStyle: { color: farbe },
        data: perioden.map((p) => werte.get(`${p}|${name}`) ?? 0),
      })),
    };

    const tage = {
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => euro(v) },
      xAxis: { type: "category", data: wochentage, ...achse, axisTick: { show: false } },
      yAxis: { type: "value", show: false },
      series: [
        {
          type: "bar",
          barWidth: "55%",
          itemStyle: { color: getComputedStyle(document.documentElement).getPropertyValue("--akzent").trim(), borderRadius: [6, 6, 0, 0] },
          data: wochentage.map((_, i) => daten.wochentage.find((w) => w.tag === i + 1)?.summe_cent ?? 0),
        },
      ],
    };
    // Für den Durchschnitt nur Perioden bis heute zählen
    const bisher = Math.max(1, perioden.filter((p) => p <= iso(new Date())).length);
    return { kreis, balken, verlauf, tage, perioden, bisher };
  }, [daten, ebene, unter, bereich, raster, f.rand, f.leise, f.text]);

  const k = daten?.kennzahlen;
  const trend = k && daten?.vorher?.summe_cent ? ((k.summe_cent - daten.vorher.summe_cent) / daten.vorher.summe_cent) * 100 : null;
  const maxHaendler = Math.max(1, ...(daten?.haendler.map((h) => h.summe_cent) ?? [1]));

  return (
    <>
      <Kopf
        titel={t("Übersicht")}
        unter={t("Wofür geht das Geld beim Einkaufen drauf?")}
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
        {konten && konten.length > 1 && (
          <label className="flex w-full items-center gap-2 text-sm sm:ml-auto sm:w-auto">
            <Symbol name="finanzen" className="size-4 shrink-0 text-text-3" />
            <select
              className={`eingabe py-1.5 sm:w-64 ${konto ? "border-akzent text-akzent" : ""}`}
              value={konto ?? ""}
              onChange={(e) => kontoSetzen(e.target.value || null)}
              aria-label={t("Nach Actual-Konto filtern")}
            >
              <option value="">{t("Alle Konten")}</option>
              {konten.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                  {mehrereBudgets && k.budget_name ? ` · ${k.budget_name}` : ""} ({t("{n} Bon|{n} Bons", { n: k.bons })})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {fehler && <p className="text-sm text-fehler">{fehler}</p>}

      {daten && k && k.bons === 0 && !haupt && !unter ? (
        <Leer
          titel={t("Noch keine geprüften Bons in diesem Zeitraum")}
          text={t("Lade Kassenbons hoch, prüfe die erkannten Positionen – danach erscheint hier die Auswertung.")}
          aktion={
            <button className="knopf-haupt" onClick={() => auswaehlen()}>
              <Symbol name="hochladen" className="size-4" /> {t("Bons hochladen")}
            </button>
          }
        />
      ) : (
        daten &&
        k &&
        diagramme && (
          <div className="space-y-4">
            {haupt && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button className="chip" onClick={() => (setHaupt(null), setUnter(null))}>
                  {t("Alle Bereiche")}
                </button>
                <Symbol name="weiter" className="size-3.5 text-text-3" />
                <button className={`chip ${unter ? "" : "chip-aktiv"}`} onClick={() => setUnter(null)}>
                  {haupt}
                </button>
                {unter && (
                  <>
                    <Symbol name="weiter" className="size-3.5 text-text-3" />
                    <span className="chip chip-aktiv">{unter}</span>
                  </>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kennzahl titel={t("Ausgaben")} wert={euro(k.summe_cent)} trend={trend} unter={trend != null ? (vergleichText[ansicht] ?? t("zum Vorzeitraum")) : undefined} />
              <Kennzahl titel={t("Einkäufe")} wert={String(k.bons)} unter={daten.vorher ? t("vorher {n}", { n: daten.vorher.bons }) : undefined} />
              <Kennzahl titel={t("Ø je Einkauf")} wert={euro(k.bons ? Math.round(k.summe_cent / k.bons) : 0)} />
              <Kennzahl titel={t("Positionen")} wert={String(k.positionen)} unter={t("{n} verschiedene Artikel", { n: k.artikel })} />
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Abschnitt titel={unter ? t("{name} nach Sorten", { name: unter }) : haupt ? t("{name} nach Gruppen", { name: haupt }) : t("Nach Bereichen")} className="lg:col-span-2">
                <div className="relative">
                  <Diagramm optionen={diagramme.kreis} hoehe={240} onKlick={tiefer} />
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-xs text-text-3">{t("Gesamt")}</div>
                    <div className="text-lg font-semibold">{euroGerundet(k.summe_cent)}</div>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {ebene.map((g) => (
                    <li key={g.name} className="flex items-center gap-1">
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-0.5 text-left text-sm hover:bg-flaeche-2"
                        onClick={() => tiefer(g.name)}
                      >
                        <Farbpunkt farbe={g.farbe} />
                        <span className="flex-1 truncate">{g.name}</span>
                        <span className="text-text-3">{k.summe_cent ? Math.round((g.summe_cent / k.summe_cent) * 100) : 0} %</span>
                        <span className="w-20 text-right font-medium">{euro(g.summe_cent)}</span>
                      </button>
                      {g.name !== UEBRIGE && (
                        <button
                          className="knopf-leise shrink-0 px-1.5 py-0.5 text-text-3 hover:text-akzent"
                          title={t("Einzelne Posten anzeigen")}
                          aria-label={t("Posten von {name} anzeigen", { name: g.name })}
                          onClick={() => postenDerEbene(g.name)}
                        >
                          <Symbol name="bons" className="size-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </Abschnitt>
              <Abschnitt titel={t("Die größten Posten nach Sorte")} className="lg:col-span-3" rechts={<span className="text-xs text-text-3">{t("Balken anklicken für Einzelposten")}</span>}>
                <Diagramm
                  optionen={diagramme.balken}
                  hoehe={Math.max(200, Math.min(12, daten.sorten.length) * 30 + 20)}
                  onKlick={(name) => postenZeigen(name, { sorte: name })}
                />
              </Abschnitt>
            </div>

            {diagramme.perioden.length > 1 && (
              <Abschnitt
                titel={`${t("Verlauf")} ${rasterNach[raster]}`}
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
                <p className="-mt-1 mb-2 text-xs text-text-2">
                  Ø {rasterJe[raster]}: <b>{euro(Math.round(k.summe_cent / diagramme.bisher))}</b>
                  {raster !== "tag" && ` · ${t("Balken anklicken, um hineinzuzoomen")}`}
                </p>
                <Diagramm
                  optionen={diagramme.verlauf}
                  hoehe={300}
                  onKlick={(_, __, index) => {
                    const ziel = index != null ? hineinZoomen(diagramme.perioden[index], raster) : null;
                    if (ziel) ansichtWechseln(ziel.ansicht, ziel.anker);
                  }}
                />
              </Abschnitt>
            )}

            <div className="grid gap-4 lg:grid-cols-5">
              <Abschnitt
                titel={t("Top-Artikel")}
                className="lg:col-span-3"
                rechts={
                  <Link to="/artikel" className="text-xs font-medium text-akzent hover:underline">
                    {t("Alle Artikel")}
                  </Link>
                }
              >
                <div className="divide-y divide-rand">
                  {daten.artikel.slice(0, 12).map((a, i) => (
                    <button
                      key={a.name + a.untergruppe}
                      className="flex w-full items-center gap-3 rounded-lg py-2 text-left text-sm hover:bg-flaeche-2"
                      onClick={() => postenZeigen(a.name, { artikel: a.name, unter: a.untergruppe })}
                    >
                      <span className="w-5 text-right text-xs text-text-3">{i + 1}</span>
                      <Farbpunkt farbe={a.farbe} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{a.name}</div>
                        <div className="text-xs text-text-3">
                          {a.untergruppe} · {a.kaeufe}× · Ø {euro(a.schnitt_cent)}
                        </div>
                      </div>
                      <span className="font-medium">{euro(a.summe_cent)}</span>
                      <Symbol name="weiter" className="size-4 text-text-3" />
                    </button>
                  ))}
                </div>
              </Abschnitt>
              <div className="space-y-4 lg:col-span-2">
                <Abschnitt titel={t("Geschäfte")}>
                  <div className="space-y-2.5">
                    {daten.haendler.slice(0, 8).map((h) => (
                      <button key={h.name} className="block w-full rounded-lg text-left text-sm hover:bg-flaeche-2" onClick={() => postenZeigen(h.name, { haendler: h.name })}>
                        <div className="flex justify-between">
                          <span className="truncate font-medium">{h.name}</span>
                          <span>{euro(h.summe_cent)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-flaeche-2">
                            <div className="h-full rounded-full bg-akzent" style={{ width: `${(h.summe_cent / maxHaendler) * 100}%` }} />
                          </div>
                          <span className="w-16 text-right text-xs text-text-3">{t("{n} Bon|{n} Bons", { n: h.bons })}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </Abschnitt>
                <Abschnitt titel={t("Nach Wochentag")}>
                  <Diagramm
                    optionen={diagramme.tage}
                    hoehe={150}
                    onKlick={(name, _, index) => index != null && postenZeigen(t("Einkäufe am {tag}", { tag: name }), { wochentag: String(index + 1) })}
                  />
                </Abschnitt>
              </div>
            </div>
          </div>
        )
      )}
      {detail && <PostenListe titel={detail.titel} unter={titelVon(ansicht, anker, bereich)} filter={detail.filter} onSchliessen={() => setDetail(null)} />}
    </>
  );
}
