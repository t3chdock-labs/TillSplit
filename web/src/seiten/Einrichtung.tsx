import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../api";
import { Hinweis, Kopf, useDaten } from "../komponenten/Bausteine";
import { useHochladen } from "../komponenten/Hochladen";
import { Symbol } from "../komponenten/Symbol";
import { t } from "../i18n";

type Schritt = {
  id: string;
  titel: string;
  text: string;
  ziel: string;
  erledigt: boolean;
  optional: boolean;
  nurAdmin: boolean;
  vonHand: boolean;
  hinweis?: string;
  unterpunkte?: { titel: string; ziel: string; erledigt: boolean }[];
};
type EinrichtungDaten = { schritte: Schritt[]; ausgeblendet: boolean; pflichtOffen: number };

/** Schmaler Balken über allen Seiten, solange die Einrichtung nicht abgeschlossen oder ausgeblendet ist */
export function EinrichtungsHinweis() {
  const ort = useLocation();
  const navigieren = useNavigate();
  const [daten, setDaten] = useState<EinrichtungDaten | null>(null);
  // Beim ersten Start (noch kein Bon) einmal pro Sitzung direkt zur Tour
  useEffect(() => {
    if (!daten || daten.ausgeblendet || daten.pflichtOffen === 0 || ort.pathname !== "/") return;
    if (daten.schritte.find((s) => s.id === "bon")?.erledigt) return;
    try {
      if (sessionStorage.getItem("tillsplit:tour")) return;
      sessionStorage.setItem("tillsplit:tour", "1");
    } catch {
      return;
    }
    navigieren("/einrichtung", { replace: true });
  }, [daten, ort.pathname, navigieren]);
  // bei jedem Seitenwechsel neu prüfen, damit erledigte Schritte sofort verschwinden
  useEffect(() => {
    let aktiv = true;
    api
      .get<EinrichtungDaten>("/api/einrichtung")
      .then((d) => aktiv && setDaten(d))
      .catch(() => aktiv && setDaten(null));
    return () => {
      aktiv = false;
    };
  }, [ort.pathname]);

  if (!daten || daten.ausgeblendet || daten.pflichtOffen === 0 || ort.pathname === "/einrichtung") return null;
  const gesamt = daten.schritte.length;
  const fertig = daten.schritte.filter((s) => s.erledigt).length;
  return (
    <Link
      to="/einrichtung"
      className="mb-5 flex items-center gap-3 rounded-xl border border-akzent/30 bg-akzent-hell px-4 py-3 text-sm text-akzent transition hover:border-akzent/60"
    >
      <Symbol name="kompass" className="size-5 shrink-0" />
      <span className="flex-1">
        <span className="font-semibold">{t("Einrichtung fortsetzen")}</span>
        <span className="max-sm:hidden"> {t("– {fertig} von {gesamt} Schritten erledigt", { fertig, gesamt })}</span>
      </span>
      <Symbol name="weiter" className="size-4" />
    </Link>
  );
}

export function Einrichtung() {
  const { daten, fehler, neuLaden } = useDaten<EinrichtungDaten>("/api/einrichtung");
  const { auswaehlen } = useHochladen();
  const navigieren = useNavigate();
  const [meldung, setMeldung] = useState<string | null>(null);

  if (fehler) return <Hinweis art="fehler">{fehler}</Hinweis>;
  if (!daten) return null;

  const speichern = async (body: object) => {
    setMeldung(null);
    try {
      await api.put("/api/einrichtung", body);
      neuLaden();
    } catch (e) {
      setMeldung((e as Error).message);
    }
  };

  const fertig = daten.schritte.filter((s) => s.erledigt).length;
  const anteil = Math.round((fertig / Math.max(1, daten.schritte.length)) * 100);
  // erster offener Pflichtschritt wird hervorgehoben
  const naechster = daten.schritte.find((s) => !s.erledigt && !s.optional) ?? daten.schritte.find((s) => !s.erledigt);

  const oeffnen = (s: Schritt) => {
    if (s.id === "bon") auswaehlen();
    else navigieren(s.ziel);
  };

  return (
    <>
      <Kopf
        titel={t("Einrichtung")}
        unter={t("Schritt für Schritt zu einem fertig eingerichteten TillSplit")}
        rechts={
          daten.ausgeblendet ? (
            <button className="knopf-zweit" onClick={() => void speichern({ ausgeblendet: false })}>
              {t("Hinweis wieder anzeigen")}
            </button>
          ) : (
            <button className="knopf-zweit" onClick={() => void speichern({ ausgeblendet: true }).then(() => navigieren("/"))}>
              {daten.pflichtOffen ? t("Später fortsetzen") : t("Einrichtung abschließen")}
            </button>
          )
        }
      />

      <div className="karte mb-5 p-5">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-medium">
            {t("{fertig} von {gesamt} erledigt", { fertig, gesamt: daten.schritte.length })}
          </span>
          <span className="text-text-3">{daten.pflichtOffen ? t("{n} wichtiger Schritt offen|{n} wichtige Schritte offen", { n: daten.pflichtOffen }) : t("Alle wichtigen Schritte erledigt")}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-flaeche-2">
          <div className="h-full rounded-full bg-akzent transition-all" style={{ width: `${anteil}%` }} />
        </div>
      </div>

      {meldung && (
        <div className="mb-4">
          <Hinweis art="fehler">{meldung}</Hinweis>
        </div>
      )}

      <ol className="space-y-3">
        {daten.schritte.map((s, i) => {
          const aktuell = s.id === naechster?.id;
          return (
            <li key={s.id} className={`karte flex gap-4 p-4 sm:p-5 ${aktuell ? "ring-2 ring-akzent/50" : ""} ${s.erledigt ? "opacity-75" : ""}`}>
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  s.erledigt ? "bg-emerald-500/15 text-gut" : aktuell ? "bg-akzent text-akzent-text" : "bg-flaeche-2 text-text-2"
                }`}
              >
                {s.erledigt ? <Symbol name="haken" className="size-4" /> : i + 1}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{s.titel}</h2>
                  {s.optional && <span className="rounded-full bg-flaeche-2 px-2 py-0.5 text-[11px] text-text-3">{t("optional")}</span>}
                  {s.nurAdmin && <span className="rounded-full bg-flaeche-2 px-2 py-0.5 text-[11px] text-text-3">{t("Admin")}</span>}
                </div>
                <p className="text-sm text-text-2">{s.text}</p>
                {s.hinweis && <p className={`text-xs ${s.erledigt ? "text-text-3" : "text-warnung"}`}>{s.hinweis}</p>}
                {s.unterpunkte ? (
                  <ol className="space-y-1 pt-1">
                    {s.unterpunkte.map((u, j) => (
                      <li key={u.ziel}>
                        <Link to={u.ziel} className="group flex items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-flaeche-2">
                          <span
                            className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${u.erledigt ? "bg-emerald-500/15 text-gut" : "bg-flaeche-2 text-text-2"}`}
                          >
                            {u.erledigt ? <Symbol name="haken" className="size-3" /> : j + 1}
                          </span>
                          <span className={`flex-1 ${u.erledigt ? "text-text-2" : ""}`}>{u.titel}</span>
                          <Symbol name="weiter" className="size-4 text-text-3 group-hover:text-akzent" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button className={aktuell ? "knopf-haupt text-sm" : "knopf-zweit text-sm"} onClick={() => oeffnen(s)}>
                    {s.id === "bon" ? <Symbol name="kamera" className="size-4" /> : null}
                    {s.erledigt ? t("Ansehen") : s.id === "bon" ? t("Bon hochladen") : t("Jetzt einrichten")}
                    {s.id !== "bon" && <Symbol name="weiter" className="size-4" />}
                  </button>
                  {s.vonHand && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-2">
                      <input type="checkbox" checked={s.erledigt} onChange={(e) => void speichern({ schritt: s.id, erledigt: e.target.checked })} />
                      {t("Passt so")}
                    </label>
                  )}
                </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-text-3">
        {t("Die Liste erkennt automatisch, was schon eingerichtet ist. Du findest sie jederzeit wieder unter")} <Link to="/einrichtung" className="underline">{t("Einrichtung")}</Link> {t("in der Seitenleiste.")}
      </p>
    </>
  );
}
