import { useState } from "react";
import { datum, euro, zahl } from "../format";
import { t } from "../i18n";
import { Farbpunkt, useDaten } from "./Bausteine";

export type Preisaenderung = {
  name: string;
  haendler: string | null;
  untergruppe: string;
  farbe: string;
  einheit: string | null;
  datum: string;
  preis_cent: number;
  alt_datum: string;
  alt_cent: number;
  prozent: number;
};
type Antwort = { teurer: Preisaenderung[]; guenstiger: Preisaenderung[]; teurer_gesamt: number; guenstiger_gesamt: number };

/** So viele Zeilen sind zu sehen, bevor man aufklappt */
const KURZ = 10;

function Liste({
  titel,
  leer,
  eintraege,
  gesamt,
  teurer,
  onWahl,
}: {
  titel: string;
  leer: string;
  eintraege: Preisaenderung[];
  gesamt: number;
  teurer: boolean;
  onWahl: (p: Preisaenderung) => void;
}) {
  const [alle, setAlle] = useState(false);
  const sichtbar = alle ? eintraege : eintraege.slice(0, KURZ);
  return (
    <section className="karte min-w-0 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">
          <span className={teurer ? "text-fehler" : "text-gut"}>{teurer ? "▲" : "▼"}</span> {titel}
        </h2>
        {gesamt > 0 && (
          <span className="text-xs text-text-3">
            {gesamt > eintraege.length ? t("die größten {n} von {gesamt}", { n: eintraege.length, gesamt }) : t("{n} Artikel", { n: gesamt })}
          </span>
        )}
      </div>
      {eintraege.length === 0 ? (
        <p className="text-sm text-text-3">{leer}</p>
      ) : (
        <>
          <div className="divide-y divide-rand">
            {sichtbar.map((p, i) => (
              <button
                key={`${p.name}|${p.haendler ?? ""}`}
                className="flex w-full items-center gap-3 rounded-lg py-2 text-left text-sm hover:bg-flaeche-2"
                onClick={() => onWahl(p)}
              >
                <span className="w-6 shrink-0 text-right text-xs text-text-3">{i + 1}</span>
                <Farbpunkt farbe={p.farbe} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="flex text-xs text-text-3">
                    <span className="truncate">{p.haendler ?? t("Unbekannt")}</span>
                    <span className="shrink-0 whitespace-pre"> · {t("seit {datum}", { datum: datum(p.alt_datum) })}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block font-semibold ${teurer ? "text-fehler" : "text-gut"}`}>
                    {teurer ? "+" : "−"}
                    {zahl(Math.abs(p.prozent), Math.abs(p.prozent) < 10 ? 1 : 0)} %
                  </span>
                  <span className="block whitespace-nowrap text-xs text-text-3">
                    {euro(p.alt_cent)} → {euro(p.preis_cent)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {eintraege.length > KURZ && (
            <button className="knopf-leise -ml-3 mt-2 text-xs text-akzent" onClick={() => setAlle(!alle)}>
              {alle ? t("Weniger anzeigen") : t("Alle {n} anzeigen", { n: eintraege.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Die größten Preissteigerungen und -senkungen im Zeitraum – unten auf der Übersicht */
export function Preisaenderungen({ abfrage, onWahl }: { abfrage: string; onWahl: (p: Preisaenderung) => void }) {
  const { daten } = useDaten<Antwort>(`/api/auswertung/preise?${abfrage}`);
  if (!daten) return null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
        <h2 className="text-sm font-semibold">{t("Preisänderungen")}</h2>
        <span className="text-xs text-text-3">{t("Letzter Preis im Zeitraum gegenüber dem Preis davor – je Artikel und Geschäft")}</span>
      </div>
      {daten.teurer_gesamt + daten.guenstiger_gesamt === 0 ? (
        <p className="karte p-5 text-sm text-text-3">
          {t("Noch keine Preisänderungen in diesem Zeitraum. Dafür muss ein Artikel mindestens zweimal im selben Geschäft gekauft worden sein.")}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Liste titel={t("Teurer geworden")} leer={t("Nichts ist teurer geworden.")} eintraege={daten.teurer} gesamt={daten.teurer_gesamt} teurer onWahl={onWahl} />
          <Liste titel={t("Günstiger geworden")} leer={t("Nichts ist günstiger geworden.")} eintraege={daten.guenstiger} gesamt={daten.guenstiger_gesamt} teurer={false} onWahl={onWahl} />
        </div>
      )}
    </div>
  );
}
