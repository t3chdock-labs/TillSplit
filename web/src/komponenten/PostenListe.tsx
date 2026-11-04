import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { datum, euro, zahl } from "../format";
import { Farbpunkt, useDaten } from "./Bausteine";
import { Symbol } from "./Symbol";
import { t } from "../i18n";

type Posten = {
  bon_id: number;
  datum: string;
  haendler: string;
  artikel: string;
  sorte: string;
  untergruppe: string;
  farbe: string;
  menge: number | null;
  einheit: string | null;
  einzelpreis_cent: number | null;
  betrag_cent: number;
};
type Antwort = { posten: Posten[]; summe_cent: number; bons: number; begrenzt: boolean };

/** Seitenblatt mit den einzelnen Posten hinter einem Balken oder Eintrag der Übersicht, gruppiert nach Bon */
export function PostenListe({ titel, unter, filter, onSchliessen }: { titel: string; unter?: string; filter: Record<string, string | null | undefined>; onSchliessen: () => void }) {
  const pfad = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v != null && v !== "") p.set(k, v);
    return `/api/auswertung/posten?${p}`;
  }, [filter]);
  const { daten, fehler } = useDaten<Antwort>(pfad);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onSchliessen();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onSchliessen]);

  // nach Bon gruppieren, neueste zuerst
  const bons = useMemo(() => {
    const m = new Map<number, { bon_id: number; datum: string; haendler: string; posten: Posten[] }>();
    for (const p of daten?.posten ?? []) {
      const b = m.get(p.bon_id) ?? { bon_id: p.bon_id, datum: p.datum, haendler: p.haendler, posten: [] };
      b.posten.push(p);
      m.set(p.bon_id, b);
    }
    return [...m.values()];
  }, [daten]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[1px]" onClick={onSchliessen}>
      <aside
        className="flex h-full w-full max-w-lg flex-col bg-flaeche shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={titel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-rand px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{titel}</h2>
            <div className="text-xs text-text-2">
              {unter}
              {daten && ` · ${t("{n} Posten auf {bons} Bons", { n: daten.posten.length, bons: daten.bons })} · ${euro(daten.summe_cent)}`}
            </div>
          </div>
          <button className="knopf-leise px-2" onClick={onSchliessen} aria-label={t("Schließen")}>
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {fehler && <p className="p-5 text-sm text-fehler">{fehler}</p>}
          {!daten && !fehler && <p className="p-5 text-sm text-text-3">{t("Lädt …")}</p>}
          {bons.map((b) => (
            <section key={b.bon_id} className="border-b border-rand">
              <Link
                to={`/bons/${b.bon_id}`}
                className="flex items-center gap-2 bg-flaeche-2 px-5 py-2 text-xs font-semibold text-text-2 hover:text-akzent"
                onClick={onSchliessen}
              >
                <Symbol name="bons" className="size-3.5" />
                <span className="flex-1 truncate">
                  {datum(b.datum)} · {b.haendler}
                </span>
                <span>{t("Bon öffnen")}</span>
                <Symbol name="weiter" className="size-3.5" />
              </Link>
              <ul className="divide-y divide-rand">
                {b.posten.map((p, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-2 text-sm">
                    <Farbpunkt farbe={p.farbe} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{p.artikel}</div>
                      <div className="truncate text-xs text-text-3">
                        {p.untergruppe}
                        {p.sorte && p.sorte !== p.artikel ? ` · ${p.sorte}` : ""}
                        {p.menge != null && p.menge !== 1 ? ` · ${zahl(p.menge, 3)} ${p.einheit ?? ""} × ${euro(p.einzelpreis_cent)}` : ""}
                      </div>
                    </div>
                    <span className={`font-medium ${p.betrag_cent < 0 ? "text-gut" : ""}`}>{euro(p.betrag_cent)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {daten?.begrenzt && <p className="p-5 text-xs text-text-3">{t("Es werden die neuesten 500 Posten angezeigt – Zeitraum eingrenzen für mehr.")}</p>}
          {daten && !daten.posten.length && <p className="p-5 text-sm text-text-3">{t("Keine Posten in diesem Zeitraum.")}</p>}
        </div>
      </aside>
    </div>
  );
}
