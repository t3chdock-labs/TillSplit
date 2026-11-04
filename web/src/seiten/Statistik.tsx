import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Kopf, Leer, useDaten } from "../komponenten/Bausteine";
import { Diagramm, themaFarben } from "../komponenten/Diagramm";
import { Symbol } from "../komponenten/Symbol";
import { datum, geld, iso, zahl } from "../format";
import { autoRaster, bereichVon, periodenListe, periodenText, titelVon, verschieben, type Ansicht, type Bereich, type Raster } from "../zeit";
import { Abschnitt, ansichten, Kennzahl, palette } from "./Uebersicht";
import { t } from "../i18n";

type Statistik = {
  waehrung: string;
  kennzahlen: {
    bons: number; fehler: number; offen: number; summe_falsch: number; nachgelesen: number;
    aufrufe: number; kosten: number; sekunden: number; eingabe: number; ausgabe: number; cache: number; kostenJeBon: number;
  };
  eingang: { periode: string; name: string; anzahl: number }[];
  kosten: { periode: string; modell: string; kosten: number; aufrufe: number }[];
  modelle: { modell: string; aufrufe: number; kosten: number; eingabe: number; ausgabe: number; sekunden: number }[];
  anlaesse: { anlass: string; aufrufe: number; kosten: number }[];
  personen: { name: string; bons: number; kosten: number }[];
  stunden: { stunde: number; anzahl: number }[];
  teuerste: { id: number; haendler: string; datum: string | null; kosten: number; modell: string | null; positionen: number }[];
};

// feste Farben je Modell, damit sie in allen Diagrammen gleich bleiben
const modellFarbe = (m: string) =>
  m.startsWith("Haiku") ? "#16a34a" : m.startsWith("Sonnet") ? "#2563eb" : m.startsWith("Opus") ? "#9333ea" : m.includes("Tesseract") ? "#ca8a04" : "#64748b";
const anlassText: Record<string, string> = {
  erkennung: t("Erste Erkennung"),
  nachlesen: t("Automatisch nachgelesen"),
  manuell: t("Von Hand neu gelesen"),
  gruppen: t("Warengruppen neu geordnet"),
};
const tausend = (n: number) => (n >= 1e6 ? t("{n} Mio.", { n: zahl(n / 1e6, 1) }) : zahl(n));

export function Statistik() {
  const [ansicht, setAnsicht] = useState<Ansicht>("monat");
  const [anker, setAnker] = useState(() => new Date());
  const [frei, setFrei] = useState<Bereich>(() => {
    const heute = new Date();
    return { von: iso(new Date(heute.getFullYear(), heute.getMonth() - 2, 1)), bis: iso(heute) };
  });
  const [rasterWahl, setRasterWahl] = useState<Raster | null>(null);
  const bereich = useMemo(() => bereichVon(ansicht, anker, frei), [ansicht, anker, frei]);
  const raster = rasterWahl ?? autoRaster(ansicht, bereich);

  const pfad = useMemo(() => {
    const p = new URLSearchParams({ raster });
    if (bereich.von) p.set("von", bereich.von);
    if (bereich.bis) p.set("bis", bereich.bis);
    return `/api/statistik?${p}`;
  }, [bereich, raster]);
  const { daten, fehler } = useDaten<Statistik>(pfad);
  const f = themaFarben();

  const diagramme = useMemo(() => {
    if (!daten) return null;
    const achse = { axisLine: { lineStyle: { color: f.rand } }, axisLabel: { color: f.leise }, splitLine: { lineStyle: { color: f.rand } } };
    const vorhanden = [...daten.eingang.map((e) => e.periode), ...daten.kosten.map((k) => k.periode)].sort();
    const von = bereich.von ?? vorhanden[0];
    const bis = bereich.bis ?? vorhanden[vorhanden.length - 1];
    const perioden = von && bis ? periodenListe(von, bis, raster) : [];
    const xAchse = { type: "category", data: perioden.map((p) => periodenText(p, raster, perioden.length <= 7)), ...achse, axisTick: { show: false } };
    const legende = { top: 0, type: "scroll", icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: f.text } };

    const personen = [...new Set(daten.eingang.map((e) => e.name))];
    const eingang = {
      grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
      legend: legende,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: xAchse,
      yAxis: { type: "value", minInterval: 1, ...achse },
      series: personen.map((name, i) => ({
        name,
        type: "bar",
        stack: "bons",
        barMaxWidth: 42,
        itemStyle: { color: palette[i % palette.length] },
        data: perioden.map((p) => daten.eingang.find((e) => e.periode === p && e.name === name)?.anzahl ?? 0),
      })),
    };

    const modelle = [...new Set(daten.kosten.map((k) => k.modell))];
    const kosten = {
      grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
      legend: legende,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => geld(v) },
      xAxis: xAchse,
      yAxis: { type: "value", ...achse, axisLabel: { color: f.leise, formatter: (v: number) => geld(v) } },
      series: modelle.map((name) => ({
        name,
        type: "bar",
        stack: "kosten",
        barMaxWidth: 42,
        itemStyle: { color: modellFarbe(name) },
        data: perioden.map((p) => daten.kosten.filter((k) => k.periode === p && k.modell === name).reduce((s, k) => s + k.kosten, 0)),
      })),
    };

    const anteil = {
      tooltip: { trigger: "item", valueFormatter: (v: number) => geld(v) },
      series: [
        {
          type: "pie",
          radius: ["58%", "86%"],
          padAngle: 2,
          itemStyle: { borderRadius: 6 },
          label: { show: false },
          data: daten.modelle.map((m) => ({ name: m.modell, value: m.kosten, itemStyle: { color: modellFarbe(m.modell) } })),
        },
      ],
    };

    const stunden = {
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", formatter: (p: { name: string; value: number }[]) => t("{stunde} Uhr: {n} Bons", { stunde: p[0].name, n: p[0].value }) },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => String(i)), ...achse, axisTick: { show: false } },
      yAxis: { type: "value", show: false },
      series: [
        {
          type: "bar",
          barWidth: "60%",
          itemStyle: { color: getComputedStyle(document.documentElement).getPropertyValue("--akzent").trim(), borderRadius: [4, 4, 0, 0] },
          data: Array.from({ length: 24 }, (_, i) => daten.stunden.find((s) => s.stunde === i)?.anzahl ?? 0),
        },
      ],
    };
    return { eingang, kosten, anteil, stunden };
  }, [daten, bereich, raster, f.rand, f.leise, f.text]);

  const k = daten?.kennzahlen;
  const maxPerson = Math.max(1, ...(daten?.personen.map((p) => p.bons) ?? [1]));

  return (
    <>
      <Kopf
        titel={t("Statistik")}
        unter={t("Bon-Eingang und Kosten der Texterkennung")}
        rechts={
          <div className="flex flex-wrap gap-1.5">
            {ansichten.map((a) => (
              <button
                key={a.wert}
                className={`chip ${ansicht === a.wert ? "chip-aktiv" : ""}`}
                onClick={() => (setAnsicht(a.wert), setRasterWahl(null))}
              >
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
      </div>

      {fehler && <p className="text-sm text-fehler">{fehler}</p>}

      {daten && k && k.bons === 0 && k.aufrufe === 0 ? (
        <Leer titel={t("In diesem Zeitraum ist nichts eingegangen")} text={t("Sobald Bons hochgeladen und gelesen werden, erscheinen hier Eingang und Kosten.")} />
      ) : (
        daten &&
        k &&
        diagramme && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kennzahl titel={t("Bons eingegangen")} wert={String(k.bons)} unter={[k.offen && t("{n} zu prüfen", { n: k.offen }), k.fehler && t("{n} Fehler", { n: k.fehler })].filter(Boolean).join(" · ") || undefined} />
              <Kennzahl titel={t("KI-Kosten")} wert={geld(k.kosten)} unter={t("{n} Anfrage|{n} Anfragen", { n: k.aufrufe })} />
              <Kennzahl titel={t("Ø je Bon")} wert={geld(k.kostenJeBon)} unter={t("Ø {n} s Lesedauer", { n: zahl(k.sekunden) })} />
              <Kennzahl
                titel={t("Summe passte nicht")}
                wert={String(k.summe_falsch)}
                unter={`${t("{n} nachgelesen", { n: k.nachgelesen })}${k.bons ? ` · ${t("{n} % auf Anhieb richtig", { n: Math.round(((k.bons - k.summe_falsch) / k.bons) * 100) })}` : ""}`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Abschnitt titel={t("Bon-Eingang")}>
                <Diagramm optionen={diagramme.eingang} hoehe={260} />
              </Abschnitt>
              <Abschnitt titel={t("KI-Kosten nach Modell")}>
                <Diagramm optionen={diagramme.kosten} hoehe={260} />
              </Abschnitt>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Abschnitt titel={t("Kostenanteil der Modelle")} className="lg:col-span-2">
                {daten.modelle.length ? (
                  <>
                    <Diagramm optionen={diagramme.anteil} hoehe={200} />
                    <div className="mt-3 space-y-1.5">
                      {daten.anlaesse.map((a) => (
                        <div key={a.anlass} className="flex justify-between text-sm">
                          <span className="text-text-2">
                            {anlassText[a.anlass] ?? a.anlass} <span className="text-text-3">({a.aufrufe}×)</span>
                          </span>
                          <span className="font-medium">{geld(a.kosten)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-text-3">{t("Keine KI-Anfragen in diesem Zeitraum.")}</p>
                )}
              </Abschnitt>
              <Abschnitt titel={t("Modelle im Detail")} className="lg:col-span-3">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] text-sm">
                    <thead className="text-left text-xs text-text-3">
                      <tr>
                        <th className="pb-2 font-medium">{t("Modell")}</th>
                        <th className="pb-2 text-right font-medium">{t("Anfragen")}</th>
                        <th className="pb-2 text-right font-medium">{t("Tokens ein / aus")}</th>
                        <th className="pb-2 text-right font-medium">{t("Ø Dauer")}</th>
                        <th className="pb-2 text-right font-medium">{t("Kosten")}</th>
                        <th className="pb-2 text-right font-medium">{t("je Anfrage")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rand">
                      {daten.modelle.map((m) => (
                        <tr key={m.modell}>
                          <td className="py-2">
                            <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: modellFarbe(m.modell) }} />
                            {m.modell}
                          </td>
                          <td className="py-2 text-right">{m.aufrufe}</td>
                          <td className="py-2 text-right text-text-2">
                            {tausend(m.eingabe)} / {tausend(m.ausgabe)}
                          </td>
                          <td className="py-2 text-right text-text-2">{zahl(m.sekunden)} s</td>
                          <td className="py-2 text-right font-medium">{geld(m.kosten)}</td>
                          <td className="py-2 text-right text-text-2">{geld(m.kosten / Math.max(1, m.aufrufe))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-text-3">
                  {daten.waehrung !== "USD"
                    ? t("Kosten nach Listenpreis von Anthropic (abgerechnet in US-Dollar), umgerechnet mit dem EZB-Referenzkurs des jeweiligen Tages; tatsächliche Abrechnung siehe console.anthropic.com. Ollama und Tesseract laufen lokal ohne API-Kosten.")
                    : t("Kosten nach Listenpreis von Anthropic (abgerechnet in US-Dollar); tatsächliche Abrechnung siehe console.anthropic.com. Ollama und Tesseract laufen lokal ohne API-Kosten.")}
                </p>
              </Abschnitt>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Abschnitt titel={t("Wer lädt hoch?")}>
                <div className="space-y-2.5">
                  {daten.personen.map((p) => (
                    <div key={p.name}>
                      <div className="flex justify-between text-sm">
                        <span>{p.name}</span>
                        <span className="text-text-2">
                          {t("{n} Bon|{n} Bons", { n: p.bons })} · {geld(p.kosten)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-flaeche-2">
                        <div className="h-full rounded-full bg-akzent" style={{ width: `${(p.bons / maxPerson) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Abschnitt>
              <Abschnitt titel={t("Uhrzeit des Hochladens")}>
                <Diagramm optionen={diagramme.stunden} hoehe={180} />
              </Abschnitt>
              <Abschnitt titel={t("Teuerste Bons")}>
                <div className="divide-y divide-rand">
                  {daten.teuerste.map((b) => (
                    <Link key={b.id} to={`/bons/${b.id}`} className="flex items-center gap-3 py-2 text-sm hover:text-akzent">
                      <span className="min-w-0 flex-1 truncate">
                        {b.haendler}
                        <span className="block text-xs text-text-3">
                          {datum(b.datum)} · {t("{n} Position|{n} Positionen", { n: b.positionen })}{b.modell ? ` · ${b.modell}` : ""}
                        </span>
                      </span>
                      <span className="font-medium">{geld(b.kosten)}</span>
                    </Link>
                  ))}
                  {!daten.teuerste.length && <p className="text-sm text-text-3">{t("Keine Bons mit Kosten.")}</p>}
                </div>
              </Abschnitt>
            </div>
          </div>
        )
      )}
    </>
  );
}
