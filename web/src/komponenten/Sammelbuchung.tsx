import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Kandidat, type SammelBon, type SammelVorschlag } from "../api";
import { Hinweis, useDaten } from "./Bausteine";
import { Symbol } from "./Symbol";
import { datum, euro } from "../format";
import { t } from "../i18n";

/** Liste der Bons einer Sammelbuchung (Geschäft, Datum, Betrag), jeweils mit Link zum Bon */
export function SammelBonListe({ bons, aktuell }: { bons: SammelBon[]; aktuell?: number }) {
  return (
    <ul className="divide-y divide-rand rounded-xl border border-rand text-sm">
      {bons.map((b) => (
        <li key={b.id}>
          <Link to={`/bons/${b.id}`} className={`flex items-center gap-3 px-3 py-2 hover:bg-flaeche-2 ${b.id === aktuell ? "font-semibold" : ""}`}>
            <span className="min-w-0 flex-1 truncate">
              {b.haendler ?? t("Unbekannt")} <span className="text-xs font-normal text-text-3">· {datum(b.datum)} · {t("Bon {nr}", { nr: b.id })}</span>
            </span>
            <span className="font-medium">{euro(b.summe_cent)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Vorschläge aus dem Abgleich: mehrere offene Bons ergeben zusammen genau eine Abbuchung.
 * Gebucht wird erst nach Bestätigung, weil bei ähnlichen Beträgen auch eine falsche Kombination passen kann.
 */
export function SammelVorschlaege({ neuLadenZaehler, onGebucht }: { neuLadenZaehler: number; onGebucht: () => void }) {
  const { daten, neuLaden } = useDaten<SammelVorschlag[]>("/api/sammelbuchung/vorschlaege");
  const [arbeitet, setArbeitet] = useState<number | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  useEffect(() => {
    neuLaden();
  }, [neuLadenZaehler, neuLaden]);

  const aktion = async (v: SammelVorschlag, art: "buchen" | "verwerfen") => {
    setArbeitet(v.id);
    setMeldung(null);
    try {
      await api.post(`/api/sammelbuchung/vorschlaege/${v.id}/${art}`);
      neuLaden();
      if (art === "buchen") onGebucht();
    } catch (e) {
      setMeldung((e as Error).message);
    } finally {
      setArbeitet(null);
    }
  };

  if (!daten?.length) return null;
  return (
    <div className="mb-4 space-y-3">
      {daten.map((v) => (
        <section key={v.id} className="karte border-akzent/40 p-4">
          <div className="mb-2 flex items-start gap-2">
            <Symbol name="link" className="mt-0.5 size-4 shrink-0 text-akzent" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{t("Mögliche Sammelbuchung")}</h2>
              <p className="text-xs text-text-2">
                {t("{n} Bons ergeben zusammen {betrag} – genau wie die Abbuchung vom {datum} ({konto}, {empfaenger}).", {
                  n: v.bons.length,
                  betrag: euro(v.betrag_cent),
                  datum: datum(v.datum),
                  konto: v.konto,
                  empfaenger: v.empfaenger || t("Ohne Empfänger"),
                })}
              </p>
            </div>
          </div>
          <SammelBonListe bons={v.bons} />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button className="knopf-zweit" disabled={arbeitet != null} onClick={() => aktion(v, "verwerfen")}>
              {t("Gehört nicht zusammen")}
            </button>
            <button className="knopf-haupt" disabled={arbeitet != null} onClick={() => aktion(v, "buchen")}>
              {arbeitet === v.id ? t("Wird übertragen …") : t("Zusammen buchen")}
            </button>
          </div>
        </section>
      ))}
      {meldung && <Hinweis art="fehler">{meldung}</Hinweis>}
    </div>
  );
}

/** Dialog „Zusammen buchen“: Abbuchung über die Summe der gewählten Bons suchen und aufteilen. */
export function SammelDialog({ bonIds, onFertig, onAbbrechen }: { bonIds: number[]; onFertig: () => void; onAbbrechen: () => void }) {
  const { daten, fehler, laedt } = useDaten<{ summe_cent: number; kandidaten: Kandidat[] }>(
    `/api/sammelbuchung/kandidaten?bons=${bonIds.join(",")}`,
  );
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [arbeitet, setArbeitet] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  useEffect(() => {
    const erster = daten?.kandidaten.find((k) => !k.aufgeteilt);
    if (erster && !gewaehlt) setGewaehlt(erster.id);
  }, [daten, gewaehlt]);

  const buchen = async () => {
    const k = daten?.kandidaten.find((x) => x.id === gewaehlt);
    if (!k) return;
    setArbeitet(true);
    setMeldung(null);
    try {
      await api.post("/api/sammelbuchung", { bonIds, transaktionId: k.id, budget: k.budget });
      onFertig();
    } catch (e) {
      setMeldung((e as Error).message);
    } finally {
      setArbeitet(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onAbbrechen}>
      <div
        className="karte unten-sicher max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-b-none p-5 shadow-2xl sm:rounded-b-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sammel-titel"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="sammel-titel" className="text-lg font-semibold">{t("Zusammen buchen")}</h2>
        <p className="mt-1 text-sm text-text-2">
          {daten
            ? t("{n} Bons, zusammen {betrag}. Wähle die Abbuchung, auf die alle Bons gebucht werden – sie wird nach den Bereichen aller Bons aufgeteilt.", {
                n: bonIds.length,
                betrag: euro(daten.summe_cent),
              })
            : t("{n} Bons", { n: bonIds.length })}
        </p>

        <div className="mt-4">
          {laedt && <p className="text-sm text-text-2">{t("Suche passende Abbuchung …")}</p>}
          {fehler && <Hinweis art="warnung">{fehler}</Hinweis>}
          {daten && daten.kandidaten.length === 0 && (
            <Hinweis art="info">
              {t("Keine Abbuchung über {betrag} gefunden. Ist der Bankimport schon gelaufen? Stimmen alle Summen?", { betrag: euro(daten.summe_cent) })}
            </Hinweis>
          )}
          {daten && daten.kandidaten.length > 0 && (
            <div className="space-y-2">
              {daten.kandidaten.map((k) => (
                <label
                  key={k.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                    gewaehlt === k.id ? "border-akzent bg-akzent-hell/50" : "border-rand hover:bg-flaeche-2"
                  } ${k.aufgeteilt ? "opacity-50" : ""}`}
                >
                  <input type="radio" name="sammel-kandidat" className="accent-[var(--color-akzent)]" checked={gewaehlt === k.id} disabled={k.aufgeteilt} onChange={() => setGewaehlt(k.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{k.empfaenger || t("Ohne Empfänger")}</div>
                    <div className="text-xs text-text-3">
                      {k.konto} · {datum(k.datum)}
                      {k.aufgeteilt && ` · ${t("bereits aufgeteilt")}`}
                    </div>
                  </div>
                  <span className="font-semibold">{euro(k.betrag_cent)}</span>
                </label>
              ))}
            </div>
          )}
          {meldung && <div className="mt-3"><Hinweis art="fehler">{meldung}</Hinweis></div>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="knopf-zweit" onClick={onAbbrechen}>{t("Abbrechen")}</button>
          <button className="knopf-haupt" disabled={!gewaehlt || arbeitet} onClick={buchen}>
            {arbeitet ? t("Wird übertragen …") : t("Abbuchung aufteilen")}
          </button>
        </div>
      </div>
    </div>
  );
}
