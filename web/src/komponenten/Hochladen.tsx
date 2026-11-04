import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api, type Konto } from "../api";
import { KontoOptionen } from "./Bausteine";
import { BildZuschnitt, bilderZusammenfuegen, zuschneidbar } from "./BildZuschnitt";
import { Symbol } from "./Symbol";
import { t } from "../i18n";

type Ergebnis = { id?: number; doppelt?: boolean; datei?: string; fehler?: string };
type Kontext = { auswaehlen: (kamera?: boolean) => void; hochladen: (dateien: File[]) => void; zaehler: number };
type ZahlungWahl = "auto" | "karte" | "bar";
type Vorgabe = { zahlung: ZahlungWahl; konto: string };

const HochladenKontext = createContext<Kontext>({ auswaehlen: () => {}, hochladen: () => {}, zaehler: 0 });
export const useHochladen = () => useContext(HochladenKontext);

const SPEICHER = "tillsplit:zahlung";
function letzteVorgabe(): Vorgabe {
  try {
    const wert = JSON.parse(localStorage.getItem(SPEICHER) ?? "null");
    if (wert && ["auto", "karte", "bar"].includes(wert.zahlung)) return { zahlung: wert.zahlung, konto: wert.konto ?? "" };
  } catch {
    // Speicher nicht verfügbar (privates Fenster) – Standard nehmen
  }
  return { zahlung: "auto", konto: "" };
}

/** Kleine Vorschau einer Datei; Bilder lassen sich per Tipp zuschneiden */
function Vorschaubild({ datei, onZuschneiden }: { datei: File; onZuschneiden: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!zuschneidbar(datei)) return;
    const u = URL.createObjectURL(datei);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [datei]);

  if (!url) {
    return (
      <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg border border-rand bg-flaeche-2 p-1 text-center text-[10px] text-text-3">
        {datei.type === "application/pdf" ? "PDF" : datei.name}
      </div>
    );
  }
  return (
    <button
      className="group relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-rand"
      onClick={onZuschneiden}
      title={t("Zuschneiden")}
    >
      <img src={url} alt={datei.name} className="size-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 py-1 text-[11px] text-white">
        <Symbol name="zuschneiden" className="size-3.5" /> {t("Zuschneiden")}
      </span>
    </button>
  );
}

/** Abfrage vor dem Hochladen: bar oder Karte, und von welchem Actual-Konto? */
function ZahlungsDialog({
  dateien,
  zusammen,
  onZusammen,
  onErsetzen,
  onEntfernen,
  onFotoDazu,
  onHochladen,
  onAbbrechen,
}: {
  dateien: File[];
  /** mehrere Fotos sind Teile eines langen Bons */
  zusammen: boolean;
  onZusammen: (z: boolean) => void;
  onErsetzen: (index: number, datei: File) => void;
  onEntfernen: (index: number) => void;
  onFotoDazu: () => void;
  onHochladen: (v: Vorgabe) => void;
  onAbbrechen: () => void;
}) {
  const [vorgabe, setVorgabe] = useState<Vorgabe>(letzteVorgabe);
  const [konten, setKonten] = useState<Konto[] | null>(null);
  const [bearbeiten, setBearbeiten] = useState<number | null>(null);
  const bilder = dateien.filter(zuschneidbar).length;
  const kannZusammen = bilder >= 2 && bilder === dateien.length;
  const anzahl = kannZusammen && zusammen ? 1 : dateien.length;
  const editorOffen = bearbeiten != null;

  useEffect(() => {
    api.get<Konto[]>("/api/actual/konten").then(setKonten).catch(() => setKonten([]));
  }, []);
  useEffect(() => {
    if (editorOffen) return; // Escape schließt dann den Editor, nicht den Dialog
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onAbbrechen();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onAbbrechen, editorOffen]);
  const editorZu = useCallback(() => setBearbeiten(null), []);

  if (bearbeiten != null && dateien[bearbeiten]) {
    return (
      <BildZuschnitt
        datei={dateien[bearbeiten]}
        onAbbrechen={editorZu}
        onFertig={(neu) => {
          onErsetzen(bearbeiten, neu);
          setBearbeiten(null);
        }}
      />
    );
  }

  const optionen: { wert: ZahlungWahl; titel: string; text: string; symbol: string }[] = [
    { wert: "auto", titel: t("Vom Bon"), text: t("Zahlart & Karte erkennen"), symbol: "funke" },
    { wert: "karte", titel: t("Karte / Konto"), text: t("Abbuchung kommt mit dem Bankimport"), symbol: "link" },
    { wert: "bar", titel: t("Bar"), text: t("Wird direkt gebucht"), symbol: "bons" },
  ];
  const kontoAuswahl = konten?.filter((k) => !k.offbudget) ?? [];
  const kontoGueltig = !vorgabe.konto || kontoAuswahl.some((k) => k.id === vorgabe.konto);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onAbbrechen}>
      <div
        className="karte unten-sicher w-full max-w-md rounded-b-none p-5 shadow-2xl sm:rounded-b-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zahlung-titel"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="zahlung-titel" className="text-lg font-semibold">
          {t("Bon hochladen|{n} Bons hochladen", { n: anzahl })}
        </h2>
        {dateien.some(zuschneidbar) && (
          <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {dateien.map((d, i) => (
              <div key={`${i}-${d.name}-${d.lastModified}`} className="relative shrink-0">
                <Vorschaubild datei={d} onZuschneiden={() => setBearbeiten(i)} />
                {kannZusammen && zusammen && (
                  <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 text-[11px] font-medium text-white">{i + 1}</span>
                )}
                {dateien.length > 1 && (
                  <button
                    className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-rand bg-flaeche text-text-2 shadow"
                    onClick={() => onEntfernen(i)}
                    aria-label={t("Foto entfernen")}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {dateien.every(zuschneidbar) && (
              <button
                className="flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-rand text-[11px] leading-tight text-text-2 hover:bg-flaeche-2"
                onClick={onFotoDazu}
              >
                <Symbol name="kamera" className="size-5" />
                {t("Weiteres Foto")}
              </button>
            )}
          </div>
        )}

        {kannZusammen && (
          <label className="mt-3 flex items-start gap-2 rounded-xl border border-rand p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-akzent)]" checked={zusammen} onChange={(e) => onZusammen(e.target.checked)} />
            <span>
              <span className="font-medium">{t("Teile eines langen Bons")}</span>
              <span className="block text-xs text-text-3">
                {zusammen
                  ? t("Nur anhaken, wenn alle Fotos zum selben Bon gehören! Sie werden in dieser Reihenfolge untereinander zu einem Bild zusammengefügt – das lässt sich danach nicht mehr trennen.")
                  : t("Jedes Foto wird als eigener Bon gelesen ({n} Bons). Anhaken, wenn ein langer Bon in mehreren Teilen fotografiert wurde.", { n: dateien.length })}
              </span>
            </span>
          </label>
        )}

        <p className="mt-3 text-sm text-text-2">{t("Wie wurde bezahlt?")}</p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {optionen.map((o) => (
            <button
              key={o.wert}
              className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition ${
                vorgabe.zahlung === o.wert ? "border-akzent bg-akzent-hell/60 text-akzent" : "border-rand hover:bg-flaeche-2"
              }`}
              onClick={() => setVorgabe({ ...vorgabe, zahlung: o.wert })}
            >
              <Symbol name={o.symbol} className="size-5" />
              <span className="text-sm font-medium">{o.titel}</span>
              <span className="text-[11px] leading-tight text-text-3">{o.text}</span>
            </button>
          ))}
        </div>

        {kontoAuswahl.length > 0 && (
          <label className="mt-4 block text-xs text-text-2">
            {t("Actual-Konto")}
            <select
              className="eingabe mt-1"
              value={kontoGueltig ? vorgabe.konto : ""}
              onChange={(e) => setVorgabe({ ...vorgabe, konto: e.target.value })}
            >
              <option value="">
                {vorgabe.zahlung === "bar" ? t("Wie in den Einstellungen") : t("Automatisch (über die Karte auf dem Bon)")}
              </option>
              <KontoOptionen konten={kontoAuswahl} />
            </select>
          </label>
        )}

        <div className="mt-5 flex gap-2">
          <button className="knopf-zweit flex-1" onClick={onAbbrechen}>
            {t("Abbrechen")}
          </button>
          <button
            autoFocus
            className="knopf-haupt flex-[2]"
            onClick={() => onHochladen({ ...vorgabe, konto: kontoGueltig ? vorgabe.konto : "" })}
          >
            <Symbol name="hochladen" className="size-4" />
            {kannZusammen && zusammen ? t("Als 1 Bon zusammenfügen") : dateien.length > 1 ? t("Bon hochladen|{n} Bons hochladen", { n: dateien.length }) : t("Hochladen")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hochladen per Dateiauswahl, Kamera oder Drag & Drop irgendwo ins Fenster */
export function HochladenAnbieter({ children }: { children: ReactNode }) {
  const eingabe = useRef<HTMLInputElement>(null);
  const kamera = useRef<HTMLInputElement>(null);
  const [ziehen, setZiehen] = useState(false);
  const [ausstehend, setAusstehend] = useState<File[] | null>(null);
  const [zusammen, setZusammen] = useState(false);
  // nächste Auswahl (Kamera) an die ausstehenden Fotos anhängen statt sie zu ersetzen
  const anhaengen = useRef(false);
  const [meldung, setMeldung] = useState<{ text: string; art: "gut" | "fehler" } | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [zaehler, setZaehler] = useState(0);
  const navigate = useNavigate();

  const senden = useCallback(
    async (dateien: File[], vorgabe: Vorgabe) => {
      setLaedt(true);
      try {
        localStorage.setItem(SPEICHER, JSON.stringify(vorgabe));
      } catch {
        // egal – dann wird beim nächsten Mal wieder "Vom Bon" vorgeschlagen
      }
      try {
        const form = new FormData();
        // Felder vor den Dateien, damit der Server sie beim Anlegen schon kennt
        if (vorgabe.zahlung !== "auto") form.append("zahlung", vorgabe.zahlung);
        if (vorgabe.konto) form.append("konto", vorgabe.konto);
        for (const d of dateien) form.append("dateien", d, d.name);
        const ergebnisse = await api.post<Ergebnis[]>("/api/bons", form);
        const neu = ergebnisse.filter((e) => e.id && !e.doppelt).length;
        const doppelt = ergebnisse.filter((e) => e.doppelt).length;
        const fehler = ergebnisse.filter((e) => e.fehler);
        const teile = [
          neu && t("{n} Bon wird gelesen|{n} Bons werden gelesen", { n: neu }),
          doppelt && t("{n} schon vorhanden", { n: doppelt }),
          fehler.length && fehler.map((f) => f.fehler).join("; "),
        ].filter(Boolean);
        setMeldung({ text: teile.join(" · "), art: fehler.length && !neu ? "fehler" : "gut" });
        setZaehler((z) => z + 1);
        if (dateien.length === 1 && ergebnisse[0]?.doppelt && ergebnisse[0].id) navigate(`/bons/${ergebnisse[0].id}`);
        else navigate("/bons");
      } catch (e) {
        setMeldung({ text: (e as Error).message, art: "fehler" });
      } finally {
        setLaedt(false);
      }
    },
    [navigate],
  );

  const hochladen = useCallback((dateien: File[]) => {
    if (!dateien.length) return;
    if (anhaengen.current) {
      anhaengen.current = false;
      // „Teile eines langen Bons“ bleibt bewusst aus – zusammenfügen nur, wenn ausdrücklich angehakt
      setAusstehend((alt) => [...(alt ?? []), ...dateien]);
    } else {
      setAusstehend(dateien);
      setZusammen(false);
    }
  }, []);
  const abbrechen = useCallback(() => {
    anhaengen.current = false;
    setAusstehend(null);
  }, []);

  useEffect(() => {
    if (!meldung) return;
    const zeit = setTimeout(() => setMeldung(null), 5000);
    return () => clearTimeout(zeit);
  }, [meldung]);

  useEffect(() => {
    let tiefe = 0;
    const rein = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      tiefe++;
      setZiehen(true);
    };
    const raus = () => {
      tiefe = Math.max(0, tiefe - 1);
      if (tiefe === 0) setZiehen(false);
    };
    const ueber = (e: DragEvent) => e.preventDefault();
    const fallen = (e: DragEvent) => {
      e.preventDefault();
      tiefe = 0;
      setZiehen(false);
      hochladen([...(e.dataTransfer?.files ?? [])]);
    };
    // Screenshots per Strg+V einfügen
    const einfuegen = (e: ClipboardEvent) => {
      const dateien = [...(e.clipboardData?.files ?? [])];
      if (dateien.length && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        hochladen(dateien);
      }
    };
    window.addEventListener("dragenter", rein);
    window.addEventListener("dragleave", raus);
    window.addEventListener("dragover", ueber);
    window.addEventListener("drop", fallen);
    window.addEventListener("paste", einfuegen);
    return () => {
      window.removeEventListener("dragenter", rein);
      window.removeEventListener("dragleave", raus);
      window.removeEventListener("dragover", ueber);
      window.removeEventListener("drop", fallen);
      window.removeEventListener("paste", einfuegen);
    };
  }, [hochladen]);

  const auswaehlen = useCallback((mitKamera = false) => (mitKamera ? kamera : eingabe).current?.click(), []);

  const gewaehlt = (e: React.ChangeEvent<HTMLInputElement>) => {
    hochladen([...(e.target.files ?? [])]);
    e.target.value = "";
  };

  return (
    <HochladenKontext.Provider value={{ auswaehlen, hochladen, zaehler }}>
      {children}
      <input ref={eingabe} type="file" multiple accept="image/*,application/pdf,.heic,.heif" hidden onChange={gewaehlt} />
      <input ref={kamera} type="file" accept="image/*" capture="environment" hidden onChange={gewaehlt} />

      {ausstehend && (
        <ZahlungsDialog
          dateien={ausstehend}
          zusammen={zusammen}
          onZusammen={setZusammen}
          onErsetzen={(i, neu) => setAusstehend((alt) => alt && alt.map((d, j) => (j === i ? neu : d)))}
          onEntfernen={(i) => setAusstehend((alt) => alt && alt.filter((_, j) => j !== i))}
          onFotoDazu={() => {
            anhaengen.current = true;
            kamera.current?.click();
          }}
          onAbbrechen={abbrechen}
          onHochladen={async (vorgabe) => {
            const dateien = ausstehend;
            const zusammenfuegen = zusammen && dateien.length > 1 && dateien.every(zuschneidbar);
            setAusstehend(null);
            if (!zusammenfuegen) return void senden(dateien, vorgabe);
            setLaedt(true);
            try {
              void senden([await bilderZusammenfuegen(dateien)], vorgabe);
            } catch (e) {
              setLaedt(false);
              setMeldung({ text: t("Fotos ließen sich nicht zusammenfügen: {fehler}", { fehler: (e as Error).message }), art: "fehler" });
            }
          }}
        />
      )}

      {ziehen && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-akzent/10 backdrop-blur-sm">
          <div className="karte flex flex-col items-center gap-3 border-2 border-dashed border-akzent px-12 py-10">
            <Symbol name="hochladen" className="size-10 text-akzent" />
            <div className="text-lg font-medium">{t("Bons hier ablegen")}</div>
            <div className="text-sm text-text-2">{t("Fotos, Screenshots oder PDFs")}</div>
          </div>
        </div>
      )}

      {(laedt || meldung) && (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-6">
          <div
            className={`karte flex max-w-lg items-center gap-3 px-4 py-3 text-sm shadow-xl ${
              meldung?.art === "fehler" ? "text-fehler" : ""
            }`}
          >
            {laedt ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-akzent border-t-transparent" />
                {t("Wird hochgeladen …")}
              </>
            ) : (
              meldung?.text
            )}
          </div>
        </div>
      )}
    </HochladenKontext.Provider>
  );
}
