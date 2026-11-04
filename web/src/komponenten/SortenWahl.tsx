import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";

/** für die Suche: klein, ohne Umlaute/Akzente („kase“ findet „Käse“) */
const normal = (s: string) => s.toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[̀-ͯ]/g, "");

export type Sorte = { name: string; anzahl: number };

type Eintrag = { art: "neu" | "keine" | "sorte"; name: string; anzahl?: number };

/**
 * Auswahl einer Sorte mit Suchfeld (wie die Gruppenauswahl): bekannte Sorten nach Häufigkeit,
 * Tippen filtert; gibt es den Begriff noch nicht, wird er mit Enter als neue Sorte übernommen.
 */
export function SortenWahl({ sorten, wert, onWahl }: { sorten: Sorte[]; wert: string | null; onWahl: (sorte: string | null) => void }) {
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

  const eintraege = useMemo<Eintrag[]>(() => {
    const roh = suche.trim().replace(/\s+/g, " ");
    const begriff = normal(roh);
    const treffer = sorten.filter((s) => !begriff || normal(s.name).includes(begriff));
    // Treffer am Wortanfang zuerst, sonst nach Häufigkeit
    if (begriff) treffer.sort((a, b) => Number(normal(b.name).startsWith(begriff)) - Number(normal(a.name).startsWith(begriff)) || b.anzahl - a.anzahl);
    const liste: Eintrag[] = treffer.slice(0, 200).map((s) => ({ art: "sorte", name: s.name, anzahl: s.anzahl }));
    if (roh && !sorten.some((s) => normal(s.name) === begriff)) liste.unshift({ art: "neu", name: roh.slice(0, 60) });
    if (wert && !begriff) liste.unshift({ art: "keine", name: "" });
    return liste;
  }, [sorten, suche, wert]);

  useEffect(() => setMarkiert(0), [suche]);

  const schliessen = () => {
    setOffen(false);
    setSuche("");
    knopf.current?.focus();
  };
  const waehlen = (e: Eintrag) => {
    onWahl(e.art === "keine" ? null : e.name);
    schliessen();
  };

  // Lage wie bei der Gruppenauswahl: unter/über dem Knopf, auf dem Handy feste Leiste oben
  useLayoutEffect(() => {
    if (!offen || !knopf.current) return;
    const r = knopf.current.getBoundingClientRect();
    const mobil = window.innerWidth < 640;
    const nachOben = window.innerHeight - r.bottom < 320 && r.top > window.innerHeight - r.bottom;
    setLage({ links: Math.min(r.left, window.innerWidth - Math.max(r.width, 260) - 8), oben: nachOben ? r.top : r.bottom, breite: Math.max(r.width, 260), nachOben, mobil });
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
  }, [markiert]);

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
        className="eingabe flex w-full items-center gap-2 py-1 text-left text-xs"
        onClick={() => setOffen(!offen)}
        aria-haspopup="listbox"
        aria-expanded={offen}
        title={t("Sorte")}
      >
        <span className={`min-w-0 flex-1 truncate ${wert ? "" : "text-text-3"}`}>{wert || t("Sorte, z. B. Tomate")}</span>
        <span className="text-text-3">▾</span>
      </button>
      {offen &&
        lage &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onMouseDown={schliessen} />
            <div
              className={`karte fixed z-[81] flex flex-col overflow-hidden shadow-2xl ${lage.mobil ? "inset-x-2 top-2 max-h-[55dvh]" : "max-h-80"}`}
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
                placeholder={t("Sorte suchen oder neu eingeben …")}
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                onKeyDown={taste}
                aria-label={t("Sorte suchen oder neu eingeben …")}
              />
              <div ref={liste} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1" role="listbox">
                {eintraege.length === 0 && <p className="px-3 py-2 text-sm text-text-3">{t("Noch keine Sorten – einfach eintippen")}</p>}
                {eintraege.map((e, i) => (
                  <button
                    key={`${e.art}:${e.name}`}
                    type="button"
                    data-nr={i}
                    role="option"
                    aria-selected={e.art === "sorte" && e.name === wert}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === markiert ? "bg-akzent-hell text-akzent" : "hover:bg-flaeche-2"} ${
                      e.art === "sorte" && e.name === wert ? "font-semibold" : ""
                    } ${e.art === "keine" ? "italic text-text-3" : ""}`}
                    onMouseEnter={() => setMarkiert(i)}
                    onClick={() => waehlen(e)}
                  >
                    {e.art === "neu" ? (
                      <>
                        <span className="font-semibold">+</span>
                        <span className="min-w-0 flex-1 truncate">{t("„{name}“ als neue Sorte", { name: e.name })}</span>
                      </>
                    ) : e.art === "keine" ? (
                      t("Keine Sorte")
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate">{e.name}</span>
                        {e.name === wert ? <span className="text-xs">✓</span> : <span className="text-[11px] text-text-3">{e.anzahl ? `${e.anzahl}×` : t("neu")}</span>}
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
