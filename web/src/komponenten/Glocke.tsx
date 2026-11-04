import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { gebiet, t } from "../i18n";
import { Symbol } from "./Symbol";

type Eintrag = { id: number; art: string; titel: string; text: string; link: string; erstellt: string; gelesen: boolean };

/** "vor 5 Min." / "gestern" … */
function wann(iso: string): string {
  const sekunden = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(gebiet(), { numeric: "auto", style: "short" });
  const abs = Math.abs(sekunden);
  if (abs < 60) return rtf.format(0, "minute");
  if (abs < 3600) return rtf.format(Math.round(sekunden / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sekunden / 3600), "hour");
  return rtf.format(Math.round(sekunden / 86400), "day");
}

/** Glocke mit Zähler ungelesener Benachrichtigungen; ein Klick öffnet die Liste */
export function Glocke({ klein = false }: { klein?: boolean }) {
  const [ungelesen, setUngelesen] = useState(0);
  const [offen, setOffen] = useState(false);
  const [eintraege, setEintraege] = useState<Eintrag[] | null>(null);
  const rahmen = useRef<HTMLDivElement>(null);
  const navigieren = useNavigate();

  const zaehlen = useCallback(() => {
    api.get<{ ungelesen: number }>("/api/benachrichtigungen/anzahl").then((a) => setUngelesen(a.ungelesen)).catch(() => {});
  }, []);

  // regelmäßig und beim Zurückkehren in den Tab nachsehen
  useEffect(() => {
    zaehlen();
    const zeit = setInterval(zaehlen, 60_000);
    const sichtbar = () => document.visibilityState === "visible" && zaehlen();
    document.addEventListener("visibilitychange", sichtbar);
    return () => {
      clearInterval(zeit);
      document.removeEventListener("visibilitychange", sichtbar);
    };
  }, [zaehlen]);

  useEffect(() => {
    if (!offen) return;
    api.get<{ eintraege: Eintrag[]; ungelesen: number }>("/api/benachrichtigungen").then((d) => (setEintraege(d.eintraege), setUngelesen(d.ungelesen))).catch(() => setEintraege([]));
    const draussen = (e: MouseEvent) => rahmen.current && !rahmen.current.contains(e.target as Node) && setOffen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOffen(false);
    document.addEventListener("mousedown", draussen);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", draussen);
      window.removeEventListener("keydown", esc);
    };
  }, [offen]);

  const oeffnen = (e: Eintrag) => {
    if (!e.gelesen) {
      void api.post("/api/benachrichtigungen/gelesen", { id: e.id }).then(zaehlen);
      setEintraege((alt) => alt && alt.map((x) => (x.id === e.id ? { ...x, gelesen: true } : x)));
    }
    setOffen(false);
    navigieren(e.link);
  };
  const alleGelesen = async () => {
    await api.post("/api/benachrichtigungen/gelesen", {});
    setEintraege((alt) => alt && alt.map((x) => ({ ...x, gelesen: true })));
    setUngelesen(0);
  };

  return (
    <div ref={rahmen} className="relative">
      <button
        className={`relative flex items-center justify-center rounded-full text-text-2 hover:bg-flaeche-2 hover:text-text ${klein ? "size-9 border border-rand" : "size-9"}`}
        aria-label={ungelesen ? t("Benachrichtigungen ({n} neu)", { n: ungelesen }) : t("Benachrichtigungen")}
        aria-expanded={offen}
        onClick={() => setOffen(!offen)}
      >
        <Symbol name="glocke" className="size-5" />
        {ungelesen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-fehler px-1 text-[10px] font-semibold text-white">
            {ungelesen > 99 ? "99+" : ungelesen}
          </span>
        )}
      </button>
      {offen && (
        <div
          // in der Seitenleiste (scrollt selbst) fest daneben, sonst unter der Glocke
          className={`karte z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden shadow-2xl ${klein ? "absolute right-0 mt-2" : "fixed left-[15.5rem] top-5"}`}
          role="dialog"
          aria-label={t("Benachrichtigungen")}
        >
          <div className="flex items-center justify-between border-b border-rand px-4 py-2.5">
            <span className="text-sm font-semibold">{t("Benachrichtigungen")}</span>
            {ungelesen > 0 && (
              <button className="text-xs text-akzent hover:underline" onClick={() => void alleGelesen()}>
                {t("Alle gelesen")}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto overscroll-contain">
            {!eintraege && <p className="p-4 text-sm text-text-3">{t("Lädt …")}</p>}
            {eintraege?.length === 0 && <p className="p-4 text-sm text-text-3">{t("Keine Benachrichtigungen.")}</p>}
            {eintraege?.map((e) => (
              <button
                key={e.id}
                className={`flex w-full gap-3 border-b border-rand px-4 py-3 text-left text-sm last:border-b-0 hover:bg-flaeche-2 ${e.gelesen ? "opacity-60" : ""}`}
                onClick={() => oeffnen(e)}
              >
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${e.gelesen ? "bg-transparent" : "bg-akzent"}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-2">
                    <span className="font-medium">{e.titel}</span>
                    <span className="shrink-0 text-xs text-text-3">{wann(e.erstellt)}</span>
                  </span>
                  <span className="block text-xs text-text-2">{e.text}</span>
                </span>
              </button>
            ))}
          </div>
          <Link to="/konto#benachrichtigungen" className="block border-t border-rand px-4 py-2 text-center text-xs text-text-2 hover:text-akzent" onClick={() => setOffen(false)}>
            {t("Benachrichtigungen einstellen")}
          </Link>
        </div>
      )}
    </div>
  );
}
