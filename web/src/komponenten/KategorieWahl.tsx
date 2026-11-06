import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";

/** für die Suche: klein, ohne Umlaute/Akzente („getranke“ findet „Getränke“) */
const normal = (s: string) => s.toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[̀-ͯ]/g, "");

export type Kategorie = { id: string; name: string; gruppe: string };

type Eintrag = { id: string | null; name: string; gruppe: string };

/**
 * Auswahl einer Actual-Kategorie mit Suchfeld (wie Sorten- und Gruppenauswahl): Tippen filtert nach
 * Kategorie- und Gruppenname, Pfeiltasten + Enter wählen. Der erste Eintrag ist „leer“ (z. B. „wie Bereich“).
 */
export function KategorieWahl({ kategorien, wert, onWahl, leer = t("– keine –") }: { kategorien: Kategorie[]; wert: string | null; onWahl: (id: string | null) => void; leer?: string }) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [markiert, setMarkiert] = useState(0);
  const [lage, setLage] = useState<{ links: number; oben: number; breite: number; nachOben: boolean; mobil: boolean } | null>(null);
  const knopf = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const suchfeld = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (offen && lage) suchfeld.current?.focus({ preventScroll: true });
  }, [offen, lage]);

  const aktuell = kategorien.find((k) => k.id === wert);

  const eintraege = useMemo<Eintrag[]>(() => {
    const begriff = normal(suche.trim());
    const treffer = kategorien.filter((k) => !begriff || normal(k.name).includes(begriff) || normal(k.gruppe ?? "").includes(begriff));
    // nach Gruppe zusammenhalten (Reihenfolge wie in Actual), damit die Überschriften passen
    const gruppen = [...new Set(kategorien.map((k) => k.gruppe))];
    treffer.sort((a, b) => gruppen.indexOf(a.gruppe) - gruppen.indexOf(b.gruppe));
    const ergebnis: Eintrag[] = treffer.map((k) => ({ id: k.id, name: k.name, gruppe: k.gruppe }));
    return begriff ? ergebnis : [{ id: null, name: leer, gruppe: "" }, ...ergebnis];
  }, [kategorien, suche, leer]);

  // beim Öffnen die aktuelle Wahl markieren, beim Tippen den ersten Treffer
  useEffect(() => {
    setMarkiert(suche ? 0 : Math.max(0, eintraege.findIndex((e) => e.id === wert)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suche, offen]);

  const schliessen = () => {
    setOffen(false);
    setSuche("");
    knopf.current?.focus();
  };
  const waehlen = (e: Eintrag) => {
    if (e.id !== wert) onWahl(e.id);
    schliessen();
  };

  // Lage wie bei der Sortenauswahl: unter/über dem Knopf, auf dem Handy feste Leiste oben
  useLayoutEffect(() => {
    if (!offen || !knopf.current) return;
    const r = knopf.current.getBoundingClientRect();
    const mobil = window.innerWidth < 640;
    const breite = Math.max(r.width, 280);
    const nachOben = window.innerHeight - r.bottom < 340 && r.top > window.innerHeight - r.bottom;
    setLage({ links: Math.min(r.left, window.innerWidth - breite - 8), oben: nachOben ? r.top : r.bottom, breite, nachOben, mobil });
    if (mobil) return;
    const zu = (e: Event) => {
      if (e.type === "scroll" && liste.current?.contains(e.target as Node)) return;
      setOffen(false);
      setSuche("");
    };
    window.addEventListener("scroll", zu, true);
    window.addEventListener("resize", zu);
    return () => {
      window.removeEventListener("scroll", zu, true);
      window.removeEventListener("resize", zu);
    };
  }, [offen]);

  useEffect(() => {
    liste.current?.querySelector(`[data-nr="${markiert}"]`)?.scrollIntoView({ block: "nearest" });
  }, [markiert, lage]);

  const taste = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setMarkiert((m) => Math.min(eintraege.length - 1, m + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setMarkiert((m) => Math.max(0, m - 1)));
    else if (e.key === "Enter") (e.preventDefault(), eintraege[markiert] && waehlen(eintraege[markiert]));
    else if (e.key === "Escape") (e.preventDefault(), schliessen());
  };

  return (
    <>
      <button
        ref={knopf}
        type="button"
        className="eingabe flex w-full items-center gap-2 py-1.5 text-left text-[13px]"
        onClick={() => setOffen(!offen)}
        aria-haspopup="listbox"
        aria-expanded={offen}
      >
        <span className={`min-w-0 flex-1 truncate ${aktuell ? "" : "text-text-3"}`}>
          {aktuell ? (
            <>
              {aktuell.name}
              {aktuell.gruppe && <span className="text-text-3"> · {aktuell.gruppe}</span>}
            </>
          ) : (
            leer
          )}
        </span>
        <span className="text-text-3">▾</span>
      </button>
      {offen &&
        lage &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onMouseDown={schliessen} />
            <div
              className={`karte fixed z-[81] flex flex-col overflow-hidden shadow-2xl ${lage.mobil ? "inset-x-2 top-2 max-h-[60dvh]" : "max-h-96"}`}
              style={
                lage.mobil
                  ? undefined
                  : {
                      left: Math.max(8, lage.links),
                      width: lage.breite,
                      ...(lage.nachOben ? { bottom: window.innerHeight - lage.oben + 4 } : { top: lage.oben + 4 }),
                    }
              }
            >
              <input
                ref={suchfeld}
                className="m-2 rounded-lg border border-rand bg-flaeche-2 px-2.5 py-1.5 text-sm outline-none focus:border-akzent"
                placeholder={t("Kategorie suchen …")}
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                onKeyDown={taste}
                aria-label={t("Kategorie suchen …")}
              />
              <div ref={liste} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1" role="listbox">
                {eintraege.length === 0 && <p className="px-3 py-2 text-sm text-text-3">{t("Keine passende Kategorie")}</p>}
                {eintraege.map((e, i) => (
                  <div key={e.id ?? "leer"}>
                    {e.id && e.gruppe !== eintraege[i - 1]?.gruppe && <div className="ueberschrift px-3 pb-0.5 pt-2">{e.gruppe}</div>}
                    <button
                      type="button"
                      data-nr={i}
                      role="option"
                      aria-selected={e.id === wert}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === markiert ? "bg-akzent-hell text-akzent" : "hover:bg-flaeche-2"} ${
                        e.id === wert ? "font-semibold" : ""
                      } ${e.id ? "" : "italic text-text-3"}`}
                      onMouseEnter={() => setMarkiert(i)}
                      onClick={() => waehlen(e)}
                    >
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      {e.id === wert && <span className="text-xs">✓</span>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
