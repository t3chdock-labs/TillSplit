import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Gruppe } from "../api";
import { t } from "../i18n";

/** für die Suche: klein, ohne Umlaute/Akzente („gemuse“ findet „Gemüse“) */
const normal = (s: string) => s.toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * Auswahl einer Untergruppe mit Suchfeld: Klick öffnet die nach Bereichen gegliederte Liste,
 * Tippen filtert (Untergruppe und Bereich), ↑/↓ + Enter wählen, Esc schließt.
 * Die Liste liegt über der Seite (Portal), damit sie in scrollenden oder abgeschnittenen Karten nicht verschwindet.
 */
export function GruppenWahl({
  gruppen,
  wert,
  onWahl,
  klein = true,
  leer = t("– Gruppe wählen –"),
}: {
  gruppen: Gruppe[];
  wert: number | null;
  onWahl: (id: number | null) => void;
  klein?: boolean;
  leer?: string;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [markiert, setMarkiert] = useState(0);
  const [lage, setLage] = useState<{ links: number; oben: number; breite: number; nachOben: boolean; mobil: boolean } | null>(null);
  const knopf = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const suchfeld = useRef<HTMLInputElement>(null);
  // Suchfeld sofort bereit zum Tippen (autoFocus greift im Portal nicht zuverlässig)
  useEffect(() => {
    if (offen && lage) suchfeld.current?.focus({ preventScroll: true });
  }, [offen, lage]);

  const nachId = useMemo(() => new Map(gruppen.map((g) => [g.id, g])), [gruppen]);
  const gewaehlt = wert != null ? nachId.get(wert) : undefined;
  const bereichVon = (u: Gruppe) => (u.eltern_id != null ? nachId.get(u.eltern_id) : undefined);

  // Treffer in Bereichs-Reihenfolge; flache Liste für die Tastatur
  const treffer = useMemo(() => {
    const begriff = normal(suche.trim());
    const bereiche = gruppen.filter((g) => g.eltern_id == null).sort((a, b) => a.sortierung - b.sortierung);
    return bereiche.flatMap((h) =>
      gruppen
        .filter((u) => u.eltern_id === h.id)
        .sort((a, b) => a.sortierung - b.sortierung)
        .filter((u) => !begriff || normal(u.name).includes(begriff) || normal(h.name).includes(begriff))
        .map((u) => ({ unter: u, bereich: h })),
    );
  }, [gruppen, suche]);

  useEffect(() => setMarkiert(0), [suche]);

  const schliessen = () => {
    setOffen(false);
    setSuche("");
    knopf.current?.focus();
  };
  const waehlen = (id: number) => {
    onWahl(id);
    schliessen();
  };

  // Lage unter (oder über) dem Knopf; bei Scrollen/Größenänderung schließen
  useLayoutEffect(() => {
    if (!offen || !knopf.current) return;
    const r = knopf.current.getBoundingClientRect();
    // Handy: feste Leiste oben über die ganze Breite – die Tastatur verschiebt/verkleinert sonst die Ansicht
    const mobil = window.innerWidth < 640;
    const nachOben = window.innerHeight - r.bottom < 320 && r.top > window.innerHeight - r.bottom;
    setLage({ links: Math.min(r.left, window.innerWidth - Math.max(r.width, 280) - 8), oben: nachOben ? r.top : r.bottom, breite: Math.max(r.width, 280), nachOben, mobil });
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

  // markierten Eintrag sichtbar halten
  useEffect(() => {
    liste.current?.querySelector(`[data-nr="${markiert}"]`)?.scrollIntoView({ block: "nearest" });
  }, [markiert]);

  const taste = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setMarkiert((m) => Math.min(treffer.length - 1, m + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setMarkiert((m) => Math.max(0, m - 1)));
    else if (e.key === "Enter") (e.preventDefault(), treffer[markiert] && waehlen(treffer[markiert].unter.id));
    else if (e.key === "Escape") (e.preventDefault(), schliessen());
  };

  return (
    <>
      <button
        ref={knopf}
        type="button"
        className={`eingabe flex w-full items-center gap-2 text-left ${klein ? "py-1.5 text-[13px]" : ""} ${wert == null ? "border-warnung text-warnung" : ""}`}
        onClick={() => setOffen(!offen)}
        aria-haspopup="listbox"
        aria-expanded={offen}
        title={gewaehlt ? `${bereichVon(gewaehlt)?.name ?? ""} / ${gewaehlt.name}` : undefined}
      >
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: gewaehlt?.farbe ?? "transparent" }} />
        <span className="min-w-0 flex-1 truncate">{gewaehlt ? gewaehlt.name : leer}</span>
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
                placeholder={t("Gruppe suchen …")}
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                onKeyDown={taste}
                aria-label={t("Gruppe suchen …")}
              />
              <div ref={liste} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1" role="listbox">
                {treffer.length === 0 && <p className="px-3 py-2 text-sm text-text-3">{t("Keine passende Gruppe")}</p>}
                {treffer.map(({ unter, bereich }, i) => (
                  <div key={unter.id}>
                    {(i === 0 || treffer[i - 1].bereich.id !== bereich.id) && (
                      <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                        <span className="size-2 rounded-full" style={{ background: bereich.farbe }} />
                        {bereich.name}
                      </div>
                    )}
                    <button
                      type="button"
                      data-nr={i}
                      role="option"
                      aria-selected={unter.id === wert}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 pl-6 text-left text-sm ${i === markiert ? "bg-akzent-hell text-akzent" : "hover:bg-flaeche-2"} ${
                        unter.id === wert ? "font-semibold" : ""
                      }`}
                      onMouseEnter={() => setMarkiert(i)}
                      onClick={() => waehlen(unter.id)}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ background: unter.farbe }} />
                      {unter.name}
                      {unter.id === wert && <span className="ml-auto text-xs">✓</span>}
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
