import { useEffect, useState } from "react";
import { api } from "../api";
import { AKZENTE, anwenden, gespeichert, istDunkel, type Darstellung, type Modus } from "../darstellung";
import { t } from "../i18n";

const MODI: { wert: Modus; text: string }[] = [
  { wert: "system", text: t("Wie das System") },
  { wert: "hell", text: t("Hell") },
  { wert: "dunkel", text: t("Dunkel") },
];

/** Hell/Dunkel und Akzentfarbe wählen – wirkt sofort und wird am Benutzer gespeichert (gilt auf allen Geräten) */
export function DarstellungWahl() {
  const [d, setD] = useState<Darstellung>(gespeichert);
  const [dunkel, setDunkel] = useState(istDunkel);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    const neu = () => (setD(gespeichert()), setDunkel(istDunkel()));
    window.addEventListener("tillsplit:darstellung", neu);
    return () => window.removeEventListener("tillsplit:darstellung", neu);
  }, []);

  const setzen = async (teil: Partial<Darstellung>) => {
    const neu = { ...d, ...teil };
    anwenden(neu);
    setFehler(null);
    try {
      await api.put("/api/konto/darstellung", neu);
    } catch (e) {
      setFehler((e as Error).message);
    }
  };
  const eigene = d.akzent.startsWith("#");

  return (
    <section className="karte space-y-5 p-5">
      <div>
        <h2 className="font-semibold">{t("Darstellung")}</h2>
        <p className="text-sm text-text-2">{t("Gilt für dein Konto auf allen Geräten.")}</p>
      </div>

      <div>
        <div className="ueberschrift mb-2">{t("Farbschema")}</div>
        <div className="inline-flex flex-wrap rounded-xl border border-rand bg-flaeche-2 p-1 text-sm" role="radiogroup" aria-label={t("Farbschema")}>
          {MODI.map((m) => (
            <button
              key={m.wert}
              role="radio"
              aria-checked={d.modus === m.wert}
              className={`rounded-lg px-3 py-1.5 font-medium ${d.modus === m.wert ? "bg-flaeche text-text shadow-sm" : "text-text-3 hover:text-text"}`}
              onClick={() => void setzen({ modus: m.wert })}
            >
              {m.text}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="ueberschrift mb-2">{t("Akzentfarbe")}</div>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("Akzentfarbe")}>
          {AKZENTE.map((a) => {
            const farbe = dunkel ? a.dunkel : a.hell;
            const gewaehlt = d.akzent === a.schluessel;
            return (
              <button
                key={a.schluessel}
                role="radio"
                aria-checked={gewaehlt}
                title={a.name}
                aria-label={a.name}
                className={`grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-flaeche transition ${gewaehlt ? "ring-2 ring-text" : "hover:scale-110"}`}
                style={{ background: farbe }}
                onClick={() => void setzen({ akzent: a.schluessel })}
              >
                {gewaehlt && <span className="text-sm font-bold" style={{ color: "var(--akzent-text)" }}>✓</span>}
              </button>
            );
          })}
          <label
            title={t("Eigene Farbe")}
            className={`relative grid size-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-rand ring-offset-2 ring-offset-flaeche ${eigene ? "ring-2 ring-text" : ""}`}
            style={eigene ? { background: d.akzent } : { background: "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)" }}
          >
            <input
              type="color"
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label={t("Eigene Farbe")}
              value={eigene ? d.akzent : "#0f766e"}
              // während des Ziehens nur anzeigen, gespeichert wird beim Loslassen
              onInput={(e) => anwenden({ ...d, akzent: (e.target as HTMLInputElement).value }, false)}
              onChange={(e) => void setzen({ akzent: e.target.value })}
            />
            {eigene && <span className="pointer-events-none text-sm font-bold" style={{ color: "var(--akzent-text)" }}>✓</span>}
          </label>
        </div>
      </div>

      <div>
        <div className="ueberschrift mb-2">{t("Vorschau")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="knopf-haupt">{t("Speichern")}</button>
          <button className="knopf-zweit">{t("Abbrechen")}</button>
          <span className="chip chip-aktiv">{t("Ausgewählt")}</span>
          <span className="text-sm font-medium text-akzent">{t("Link")}</span>
        </div>
      </div>
      {fehler && <p className="text-sm text-fehler">{fehler}</p>}
    </section>
  );
}
