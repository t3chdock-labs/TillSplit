import { useState } from "react";
import { Link } from "react-router";
import { api, type AbgleichErgebnis, type Bon, type BonKurz, type UrsprungKandidat } from "../api";
import { Hinweis, StatusMarke } from "./Bausteine";
import { Symbol } from "./Symbol";
import { centAlsText, centAusText, datum, euro, iso } from "../format";
import { t } from "../i18n";

/** Zeile eines verknüpften Bons (Kauf oder Erstattung) mit Link */
function BonZeile({ bon, zusatz }: { bon: BonKurz; zusatz?: string }) {
  return (
    <Link to={`/bons/${bon.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-flaeche-2">
      <span className="min-w-0 flex-1 truncate">
        {bon.haendler ?? t("Unbekannt")}{" "}
        <span className="text-xs text-text-3">
          · {datum(bon.datum)} · {t("Bon {nr}", { nr: bon.id })}
          {zusatz && ` · ${zusatz}`}
        </span>
      </span>
      <StatusMarke status={bon.status} />
      <span className="font-medium">{euro(bon.summe_cent)}</span>
    </Link>
  );
}

const trefferText = (k: UrsprungKandidat) =>
  k.treffer === "bestellnummer" ? t("gleiche Bestellnummer") : k.treffer === "positionen" ? t("Positionen passen") : k.treffer === "summe" ? t("gleicher Betrag") : "";

/**
 * Erstattungen am Bon: bei einer Erstattung der zugehörige Kauf (oder die Auswahl möglicher Käufe),
 * bei einem Kauf seine Erstattungen und der Knopf „Rückgabe erfassen“.
 */
export function ErstattungBereich({ bon, onGeaendert, onAngelegt }: { bon: Bon; onGeaendert: () => void; onAngelegt: (id: number, hinweis: string | null) => void }) {
  const [arbeitet, setArbeitet] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);

  const senden = async (pfad: string, daten: unknown) => {
    setArbeitet(true);
    setMeldung(null);
    try {
      await api.post(pfad, daten);
      onGeaendert();
    } catch (e) {
      setMeldung((e as Error).message);
    } finally {
      setArbeitet(false);
    }
  };

  if (bon.erstattung) {
    const kandidaten = bon.ursprung_kandidaten ?? [];
    return (
      <section className="karte p-5">
        <div className="mb-1 flex items-center gap-2">
          <Symbol name="aktualisieren" className="size-4 text-akzent" />
          <h2 className="text-sm font-semibold">{t("Erstattung")}</h2>
        </div>
        <p className="mb-3 text-xs text-text-2">
          {t("Geld zurück: Die Beträge sind negativ. Die Gutschrift wird in Actual denselben Bereichen zugeordnet wie der Kauf.")}
        </p>
        {bon.ursprung ? (
          <>
            <p className="mb-2 text-sm text-text-2">{t("Gehört zu diesem Kauf:")}</p>
            <div className="rounded-xl border border-rand text-sm">
              <BonZeile bon={bon.ursprung} />
            </div>
          </>
        ) : kandidaten.length > 0 ? (
          <>
            <p className="mb-2 text-sm text-text-2">{t("Der Kauf wurde nicht eindeutig gefunden. Zu welchem Bon gehört die Erstattung?")}</p>
            <ul className="divide-y divide-rand rounded-xl border border-rand text-sm">
              {kandidaten.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <Link to={`/bons/${k.id}`} className="block truncate hover:underline">{k.haendler ?? t("Unbekannt")}</Link>
                    <span className="block text-xs text-text-3">
                      {datum(k.datum)} · {t("Bon {nr}", { nr: k.id })}
                      {k.treffer && <b className="block font-semibold text-gut sm:inline"><span className="hidden sm:inline"> · </span>{trefferText(k)}</b>}
                    </span>
                  </span>
                  <span className="font-medium">{euro(k.summe_cent)}</span>
                  <button className="knopf-zweit shrink-0 px-2.5 py-1 text-xs" disabled={arbeitet} onClick={() => senden(`/api/bons/${bon.id}/ursprung`, { ursprungId: k.id })}>
                    {t("Wählen")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-text-2">
            {bon.status === "gebucht"
              ? t("Kein Kauf verknüpft.")
              : t("Kein passender Kauf gefunden. Die Erstattung wird trotzdem der Gutschrift in Actual zugeordnet – nach den Gruppen der Positionen unten.")}
          </p>
        )}
        <div className="-ml-3 mt-2 flex flex-wrap gap-x-1">
          {bon.ursprung && (
            <button className="knopf-leise text-xs text-text-3" disabled={arbeitet} onClick={() => senden(`/api/bons/${bon.id}/ursprung`, { ursprungId: null })}>
              {t("Gehört nicht zu diesem Kauf")}
            </button>
          )}
          {bon.status !== "gebucht" && bon.ki_modell && (
            <button
              className="knopf-leise text-xs text-text-3"
              disabled={arbeitet}
              onClick={() => confirm(t("Den Beleg als normalen Kauf führen? Die Beträge werden wieder positiv.")) && senden(`/api/bons/${bon.id}/erstattung`, { erstattung: false })}
            >
              {t("Doch keine Erstattung")}
            </button>
          )}
        </div>
        {meldung && <div className="mt-3"><Hinweis art="fehler">{meldung}</Hinweis></div>}
      </section>
    );
  }

  const erstattungen = bon.erstattungen ?? [];
  const geprueft = bon.status === "geprueft" || bon.status === "wartet" || bon.status === "gebucht";
  const erstattet = erstattungen.reduce((s, e) => s - (e.summe_cent ?? 0), 0);
  return (
    <section className="karte p-5">
      <div className="mb-1 flex items-center gap-2">
        <Symbol name="aktualisieren" className="size-4 text-akzent" />
        <h2 className="text-sm font-semibold">{t("Rückgabe & Erstattung")}</h2>
      </div>
      {erstattungen.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-text-2">
            {t("Bisher erstattet: {betrag} von {summe}.", { betrag: euro(erstattet), summe: euro(bon.summe_cent) })}
          </p>
          <ul className="mb-3 divide-y divide-rand rounded-xl border border-rand text-sm">
            {erstattungen.map((e) => (
              <li key={e.id}><BonZeile bon={e} /></li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-3 text-xs text-text-2">
          {t("Etwas zurückgeschickt? Hast du einen Erstattungsbeleg, lade ihn wie einen Bon hoch – TillSplit ordnet ihn diesem Kauf zu. Ohne Beleg erfasst du die Rückgabe hier.")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {geprueft && (
          <button className="knopf-zweit" disabled={arbeitet} onClick={() => setDialog(true)}>
            <Symbol name="aktualisieren" className="size-4" /> {t("Rückgabe erfassen")}
          </button>
        )}
        {bon.status !== "gebucht" && erstattungen.length === 0 && (
          <button
            className="knopf-leise text-xs text-text-3"
            disabled={arbeitet}
            onClick={() =>
              confirm(t("Ist dieser Beleg selbst eine Gutschrift oder Erstattung? Die Beträge werden dann negativ und TillSplit sucht den zugehörigen Kauf.")) &&
              senden(`/api/bons/${bon.id}/erstattung`, { erstattung: true })
            }
          >
            {t("Dieser Beleg ist eine Erstattung")}
          </button>
        )}
      </div>
      {meldung && <div className="mt-3"><Hinweis art="fehler">{meldung}</Hinweis></div>}
      {dialog && <RueckgabeDialog bon={bon} onAbbrechen={() => setDialog(false)} onFertig={onAngelegt} />}
    </section>
  );
}

type Wahl = { gewaehlt: boolean; text: string };

/** Dialog „Rückgabe erfassen“: zurückgeschickte Positionen ankreuzen, erstatteten Betrag bei Bedarf anpassen. */
function RueckgabeDialog({ bon, onFertig, onAbbrechen }: { bon: Bon; onFertig: (id: number, hinweis: string | null) => void; onAbbrechen: () => void }) {
  const positionen = bon.positionen.filter((p) => p.id != null && p.betrag_cent > 0);
  const [wahl, setWahl] = useState<Record<number, Wahl>>(() =>
    Object.fromEntries(positionen.map((p) => [p.id!, { gewaehlt: positionen.length === 1, text: centAlsText(p.betrag_cent) }])),
  );
  const [tag, setTag] = useState(iso(new Date()));
  const [arbeitet, setArbeitet] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  const gewaehlt = positionen.filter((p) => wahl[p.id!]?.gewaehlt);
  const cent = (id: number) => centAusText(wahl[id]?.text ?? "") ?? 0;
  const summe = gewaehlt.reduce((s, p) => s + cent(p.id!), 0);
  const ungueltig = gewaehlt.some((p) => cent(p.id!) <= 0 || cent(p.id!) > p.betrag_cent);
  const alle = gewaehlt.length === positionen.length;

  const anlegen = async () => {
    setArbeitet(true);
    setMeldung(null);
    try {
      const { id, abgleich } = await api.post<{ id: number; abgleich: AbgleichErgebnis | null }>(`/api/bons/${bon.id}/rueckgabe`, {
        datum: tag || null,
        positionen: gewaehlt.map((p) => ({ id: p.id, betrag_cent: cent(p.id!) })),
      });
      onFertig(id, abgleich && abgleich.ergebnis !== "aus" ? abgleich.text : null);
    } catch (e) {
      setMeldung((e as Error).message);
      setArbeitet(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={onAbbrechen}>
      <div
        className="karte unten-sicher flex max-h-[90dvh] w-full max-w-lg flex-col rounded-b-none p-5 shadow-2xl sm:rounded-b-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rueckgabe-titel"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="rueckgabe-titel" className="text-lg font-semibold">{t("Rückgabe erfassen")}</h2>
        <p className="mt-1 text-sm text-text-2">
          {t("Kreuze an, was du zurückgegeben hast. Erstattet der Händler weniger als den Kaufpreis, passe den Betrag an.")}
        </p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-text-2">
            {t("Datum der Rückgabe")}
            <input type="date" className="eingabe w-auto py-1.5" value={tag} min={bon.datum ?? undefined} max={iso(new Date())} onChange={(e) => setTag(e.target.value)} />
          </label>
          {positionen.length > 1 && (
            <button
              className="knopf-leise text-xs"
              onClick={() => setWahl((alt) => Object.fromEntries(Object.entries(alt).map(([id, w]) => [id, { ...w, gewaehlt: !alle }])))}
            >
              {alle ? t("Keine") : t("Alle")}
            </button>
          )}
        </div>

        <ul className="mt-3 min-h-0 flex-1 divide-y divide-rand overflow-y-auto rounded-xl border border-rand text-sm">
          {positionen.map((p) => {
            const w = wahl[p.id!];
            const falsch = w.gewaehlt && (cent(p.id!) <= 0 || cent(p.id!) > p.betrag_cent);
            return (
              <li key={p.id} className={`flex items-center gap-3 px-3 py-2 ${w.gewaehlt ? "bg-akzent-hell/40" : ""}`}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-[var(--color-akzent)]"
                    checked={w.gewaehlt}
                    onChange={(e) => setWahl({ ...wahl, [p.id!]: { ...w, gewaehlt: e.target.checked } })}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </label>
                {w.gewaehlt ? (
                  <input
                    inputMode="decimal"
                    aria-label={t("Erstatteter Betrag für {name}", { name: p.name })}
                    className={`eingabe w-24 py-1.5 text-right text-[13px] font-semibold ${falsch ? "border-red-500 text-fehler" : ""}`}
                    value={w.text}
                    onChange={(e) => setWahl({ ...wahl, [p.id!]: { ...w, text: e.target.value } })}
                  />
                ) : (
                  <span className="w-24 text-right text-text-3">{euro(p.betrag_cent)}</span>
                )}
              </li>
            );
          })}
        </ul>
        {positionen.length === 0 && <Hinweis art="info">{t("Der Bon hat keine Positionen, die erstattet werden können.")}</Hinweis>}
        {ungueltig && <p className="mt-2 text-xs text-fehler">{t("Der erstattete Betrag muss größer als null sein und darf den Kaufpreis nicht übersteigen.")}</p>}
        {meldung && <div className="mt-3"><Hinweis art="fehler">{meldung}</Hinweis></div>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            {t("Erstattung")} <b className="ml-1 text-gut">{euro(summe)}</b>
          </div>
          <div className="flex gap-2">
            <button className="knopf-zweit" onClick={onAbbrechen}>{t("Abbrechen")}</button>
            <button className="knopf-haupt" disabled={!gewaehlt.length || ungueltig || arbeitet} onClick={anlegen}>
              {arbeitet ? t("Wird angelegt …") : t("Rückgabe anlegen")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
