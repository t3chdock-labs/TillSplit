import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type AbgleichErgebnis, type Bon, type Gruppe, type Kandidat, type Konto, type Position, type Zahlung } from "../api";
import { Farbpunkt, Hinweis, KontoOptionen, StatusMarke, useDaten } from "../komponenten/Bausteine";
import { GruppenWahl } from "../komponenten/GruppenWahl";
import { PdfAnsicht } from "../komponenten/PdfAnsicht";
import { SammelBonListe } from "../komponenten/Sammelbuchung";
import { ErstattungBereich } from "../komponenten/Erstattung";
import { SortenWahl, type Sorte } from "../komponenten/SortenWahl";
import { Symbol } from "../komponenten/Symbol";
import { centAlsText, centAusText, datum, euro, geld, zahl, zahlungText } from "../format";
import { useSitzung } from "../sitzung";
import { t } from "../i18n";

type Zeile = Position & { schluessel: string; betragText: string };

const tausender = (n: number) => zahl(n);

let laufnummer = 0;
const zeileAus = (p: Position): Zeile => ({ ...p, schluessel: `z${++laufnummer}`, betragText: centAlsText(p.betrag_cent) });

function Vorschau({ bon }: { bon: Bon }) {
  const [gross, setGross] = useState(false);
  const quelle = `/api/bons/${bon.id}/datei?v=${bon.datei_version ?? ""}`;
  if (bon.datei_mime === "application/pdf") {
    return <PdfAnsicht quelle={quelle} />;
  }
  return (
    <div className={`overflow-auto rounded-xl border border-rand bg-white ${gross ? "max-h-[80dvh]" : "max-h-[75dvh]"}`}>
      <img
        src={quelle}
        alt={t("Kassenbon")}
        onClick={() => setGross(!gross)}
        className={gross ? "max-w-none cursor-zoom-out" : "w-full cursor-zoom-in"}
        style={gross ? { width: "180%" } : undefined}
      />
    </div>
  );
}

function ActualBereich({
  bon,
  konten,
  aufteilung,
  onGebucht,
}: {
  bon: Bon;
  konten: Konto[] | null;
  aufteilung: { name: string; farbe: string; cent: number }[];
  onGebucht: () => void;
}) {
  const suchen = bon.zahlung !== "bar" && bon.status !== "gebucht";
  const { daten: kandidaten, fehler, laedt } = useDaten<Kandidat[]>(suchen ? `/api/bons/${bon.id}/kandidaten` : null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [neuKonto, setNeuKonto] = useState(bon.actual_konto_id ?? "");
  const [arbeitet, setArbeitet] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);

  useEffect(() => {
    const erster = kandidaten?.find((k) => !k.aufgeteilt);
    if (erster && !gewaehlt) setGewaehlt(erster.id);
  }, [kandidaten, gewaehlt]);

  const buchen = async (daten: { transaktionId?: string; budget?: string; neuKontoId?: string }) => {
    setArbeitet(true);
    setMeldung(null);
    try {
      await api.post(`/api/bons/${bon.id}/buchen`, daten);
      onGebucht();
    } catch (e) {
      setMeldung((e as Error).message);
    } finally {
      setArbeitet(false);
    }
  };

  // Abgleich serverseitig: bucht automatisch, wenn genau eine Abbuchung passt
  const erneutSuchen = async () => {
    setArbeitet(true);
    setMeldung(null);
    try {
      await api.post(`/api/bons/${bon.id}/abgleich`);
      onGebucht();
    } catch (e) {
      setMeldung((e as Error).message);
    } finally {
      setArbeitet(false);
    }
  };

  const sammelBons = bon.sammel_bons ?? [];
  const aufloesen = async () => {
    if (!confirm(t("Sammelbuchung auflösen? Die Aufteilung in Actual wird zurückgenommen (die Abbuchung bleibt), alle {n} Bons sind danach wieder offen.", { n: sammelBons.length }))) return;
    setArbeitet(true);
    setMeldung(null);
    try {
      await api.post(`/api/bons/${bon.id}/sammel-aufloesen`);
      onGebucht();
    } catch (e) {
      setMeldung((e as Error).message);
    } finally {
      setArbeitet(false);
    }
  };

  const kontoName = (id: string | null) => konten?.find((k) => k.id === id)?.name;
  const gesamt = aufteilung.reduce((s, a) => s + Math.abs(a.cent), 0) || 1;

  return (
    <section className="karte p-5">
      <div className="mb-1 flex items-center gap-2">
        <Symbol name="link" className="size-4 text-akzent" />
        <h2 className="text-sm font-semibold">{t("An Actual übergeben")}</h2>
      </div>
      <p className="mb-4 text-xs text-text-2">
        {bon.erstattung ? t("Die Gutschrift wird in Actual den Bereichen zugeordnet.") : t("Die Abbuchung wird in Actual nach Bereichen aufgeteilt.")}
      </p>

      <div className="mb-4">
        <div className="flex h-2.5 overflow-hidden rounded-full">
          {aufteilung.map((a) => (
            <div key={a.name} style={{ width: `${(Math.abs(a.cent) / gesamt) * 100}%`, background: a.farbe }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {aufteilung.map((a) => (
            <span key={a.name} className="flex items-center gap-1.5">
              <Farbpunkt farbe={a.farbe} className="size-2" /> {a.name} <b>{euro(a.cent)}</b>
            </span>
          ))}
        </div>
      </div>

      {bon.status === "gebucht" ? (
        <>
          <Hinweis art="gut">
            {bon.gebucht_am ? t("In Actual gebucht am {datum}", { datum: datum(bon.gebucht_am) }) : t("In Actual gebucht")}
            {kontoName(bon.actual_konto_id) && ` (${kontoName(bon.actual_konto_id)})`}.
          </Hinweis>
          {sammelBons.length > 1 && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-text-2">
                {t("Sammelbuchung: Diese {n} Bons sind zusammen auf eine Abbuchung über {betrag} gebucht.", {
                  n: sammelBons.length,
                  betrag: euro(sammelBons.reduce((s, b) => s + b.summe_cent, 0)),
                })}
              </p>
              <SammelBonListe bons={sammelBons} aktuell={bon.id} />
              <button className="knopf-zweit mt-3" disabled={arbeitet} onClick={aufloesen}>
                {arbeitet ? t("Wird zurückgenommen …") : t("Sammelbuchung auflösen")}
              </button>
              {meldung && <div className="mt-3"><Hinweis art="fehler">{meldung}</Hinweis></div>}
            </div>
          )}
        </>
      ) : bon.zahlung === "bar" ? (
        <>
          {bon.abgleich_hinweis && (
            <div className="mb-3">
              <Hinweis art={bon.abgleich_hinweis.startsWith("Bar bezahlt") || bon.abgleich_hinweis.startsWith(t("Bar bezahlt")) ? "info" : "warnung"}>{bon.abgleich_hinweis}</Hinweis>
            </div>
          )}
          <p className="mb-2 text-sm text-text-2">{t("Bar bezahlt – von Hand in Actual übernehmen (so wie unter Einstellungen festgelegt):")}</p>
          <div className="flex gap-2">
            <select className="eingabe" value={neuKonto} onChange={(e) => setNeuKonto(e.target.value)}>
              <option value="">{t("Konto wählen")}</option>
              <KontoOptionen konten={konten ?? []} />
            </select>
            <button className="knopf-haupt shrink-0" disabled={!neuKonto || arbeitet} onClick={() => buchen({ neuKontoId: neuKonto })}>
              {arbeitet ? t("Wird gebucht …") : t("In Actual buchen")}
            </button>
          </div>
          {meldung && <div className="mt-3"><Hinweis art="fehler">{meldung}</Hinweis></div>}
        </>
      ) : (
        <>
          {bon.abgleich_hinweis && (
            <div className="mb-3">
              <Hinweis art={bon.status === "wartet" ? "info" : "warnung"}>
                {bon.abgleich_hinweis}
                {bon.abgleich_am && <span className="block text-xs opacity-75">{t("Zuletzt gesucht: {datum}", { datum: datum(bon.abgleich_am) })}</span>}
              </Hinweis>
            </div>
          )}
          {laedt && <p className="text-sm text-text-2">{bon.erstattung ? t("Suche passende Gutschrift …") : t("Suche passende Abbuchung …")}</p>}
          {fehler && <Hinweis art="warnung">{fehler}</Hinweis>}
          {kandidaten && kandidaten.length === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-text-2">
                {bon.erstattung
                  ? bon.actual_konto_id && kontoName(bon.actual_konto_id)
                    ? t("Noch keine Gutschrift über {betrag} ab dem {datum} im Konto {konto} gefunden.", { betrag: euro(Math.abs(bon.summe_cent ?? 0)), datum: datum(bon.datum), konto: kontoName(bon.actual_konto_id) })
                    : t("Noch keine Gutschrift über {betrag} ab dem {datum} gefunden.", { betrag: euro(Math.abs(bon.summe_cent ?? 0)), datum: datum(bon.datum) })
                  : bon.actual_konto_id && kontoName(bon.actual_konto_id)
                  ? t("Keine Abbuchung über {betrag} um den {datum} im Konto {konto} gefunden.", { betrag: euro(bon.summe_cent), datum: datum(bon.datum), konto: kontoName(bon.actual_konto_id) })
                  : t("Keine Abbuchung über {betrag} um den {datum} gefunden.", { betrag: euro(bon.summe_cent), datum: datum(bon.datum) })}
              </p>
              <button className="knopf-zweit" disabled={arbeitet} onClick={erneutSuchen}>
                <Symbol name="aktualisieren" className="size-4" /> {t("Erneut suchen")}
              </button>
              <p className="w-full text-xs text-text-3">
                {bon.erstattung
                  ? t("Kommen mehrere Erstattungen als eine Gutschrift? In der Bon-Liste „Zusammen buchen“ wählen und die Erstattungen ankreuzen.")
                  : t("Wurde der Bon mit anderen zusammen abgebucht (z. B. mehrere Amazon-Rechnungen)? In der Bon-Liste „Zusammen buchen“ wählen und die Bons ankreuzen.")}{" "}
                <Link to="/bons?status=wartet" className="text-akzent hover:underline">{t("Zur Bon-Liste")}</Link>
              </p>
            </div>
          )}
          {kandidaten && kandidaten.length > 0 && (
            <div className="space-y-2">
              {kandidaten.map((k) => (
                <label
                  key={k.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                    gewaehlt === k.id ? "border-akzent bg-akzent-hell/50" : "border-rand hover:bg-flaeche-2"
                  } ${k.aufgeteilt ? "opacity-50" : ""}`}
                >
                  <input type="radio" name="kandidat" className="accent-[var(--akzent)]" checked={gewaehlt === k.id} disabled={k.aufgeteilt} onChange={() => setGewaehlt(k.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{k.empfaenger || t("Ohne Empfänger")}</div>
                    <div className="text-xs text-text-3">
                      {k.konto} · {datum(k.datum)}
                      {k.abstand_tage !== 0 && ` (${t("{n} Tage", { n: `${k.abstand_tage > 0 ? "+" : ""}${k.abstand_tage}` })})`}
                      {k.aufgeteilt && ` · ${t("bereits aufgeteilt")}`}
                    </div>
                  </div>
                  <span className="font-semibold">{euro(k.betrag_cent)}</span>
                </label>
              ))}
              <button className="knopf-haupt mt-2 w-full" disabled={!gewaehlt || arbeitet} onClick={() => gewaehlt && buchen({ transaktionId: gewaehlt, budget: kandidaten.find((k) => k.id === gewaehlt)?.budget })}>
                {arbeitet ? t("Wird übertragen …") : bon.erstattung ? t("Gutschrift zuordnen") : t("Abbuchung aufteilen")}
              </button>
            </div>
          )}
          {konten && konten.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-text-2 hover:text-text">{bon.erstattung ? t("Bar erstattet? Neue Buchung anlegen") : t("Bar bezahlt? Neue Buchung anlegen")}</summary>
              <div className="mt-3 flex gap-2">
                <select className="eingabe" value={neuKonto} onChange={(e) => setNeuKonto(e.target.value)}>
                  <option value="">{t("Konto wählen")}</option>
                  <KontoOptionen konten={konten} />
                </select>
                <button className="knopf-zweit shrink-0" disabled={!neuKonto || arbeitet} onClick={() => buchen({ neuKontoId: neuKonto })}>
                  {t("Anlegen")}
                </button>
              </div>
            </details>
          )}
          {meldung && <div className="mt-3"><Hinweis art="fehler">{meldung}</Hinweis></div>}
        </>
      )}
    </section>
  );
}

export function BonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const bearbeiten = useSitzung().darf("bons_bearbeiten");
  const { daten: bon, neuLaden, fehler } = useDaten<Bon>(`/api/bons/${id}`);
  const { daten: gruppen } = useDaten<Gruppe[]>("/api/gruppen");
  const { daten: sorten, neuLaden: sortenLaden } = useDaten<Sorte[]>("/api/sorten");
  const { daten: alleKonten } = useDaten<Konto[]>("/api/actual/konten");
  const konten = alleKonten?.filter((k) => !k.offbudget) ?? null;

  const [haendler, setHaendler] = useState("");
  const [zahlung, setZahlung] = useState<Zahlung>("unbekannt");
  const [konto, setKonto] = useState("");
  const [tag, setTag] = useState("");
  const [summeText, setSummeText] = useState("");
  const [notiz, setNotiz] = useState("");
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [geaendert, setGeaendert] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "gut" | "fehler"; text: string } | null>(null);

  useEffect(() => {
    if (!bon) return;
    setHaendler(bon.haendler ?? "");
    setZahlung(bon.zahlung);
    setKonto(bon.actual_konto_id ?? "");
    setTag(bon.datum ?? "");
    setSummeText(centAlsText(bon.summe_cent));
    setNotiz(bon.notiz ?? "");
    setZeilen(bon.positionen.map(zeileAus));
    setGeaendert(false);
    // gerade aus einer Rückgabe angelegt: Ergebnis des Abgleichs einmal anzeigen
    try {
      const neu = JSON.parse(sessionStorage.getItem("tillsplit-rueckgabe") ?? "null") as { id: number; hinweis: string } | null;
      if (neu) sessionStorage.removeItem("tillsplit-rueckgabe");
      if (neu?.id === bon.id) setMeldung({ art: "gut", text: `${t("Rückgabe angelegt.")} ${neu.hinweis}` });
    } catch {
      // kein Sitzungsspeicher (privates Fenster): dann eben ohne Hinweis
    }
  }, [bon]);

  const wirdGelesen = bon?.status === "neu" || bon?.status === "in_arbeit";
  useEffect(() => {
    if (!wirdGelesen) return;
    const zeit = setInterval(neuLaden, 2500);
    return () => clearInterval(zeit);
  }, [wirdGelesen, neuLaden]);

  const summeCent = centAusText(summeText);
  const positionenCent = zeilen.reduce((s, z) => s + z.betrag_cent, 0);
  const differenz = summeCent == null ? 0 : summeCent - positionenCent;
  const ohneGruppe = zeilen.filter((z) => z.gruppe_id == null).length;
  const unsicher = zeilen.filter((z) => z.unsicher).length;
  // am Bon neu eingetippte Sorten sofort in der Auswahl anbieten (auch für die übrigen Positionen)
  const sortenListe = useMemo(() => {
    const liste = [...(sorten ?? [])];
    for (const z of zeilen) if (z.sorte && !liste.some((s) => s.name === z.sorte)) liste.push({ name: z.sorte, anzahl: 0 });
    return liste;
  }, [sorten, zeilen]);

  const aufteilung = useMemo(() => {
    if (!gruppen) return [];
    const nachId = new Map(gruppen.map((g) => [g.id, g]));
    const summen = new Map<string, { name: string; farbe: string; cent: number }>();
    for (const z of zeilen) {
      const unter = z.gruppe_id != null ? nachId.get(z.gruppe_id) : undefined;
      const haupt = unter?.eltern_id != null ? nachId.get(unter.eltern_id) : undefined;
      const name = haupt?.name ?? t("Ohne Gruppe");
      const eintrag = summen.get(name) ?? { name, farbe: haupt?.farbe ?? "#94a3b8", cent: 0 };
      eintrag.cent += z.betrag_cent;
      summen.set(name, eintrag);
    }
    return [...summen.values()].filter((s) => s.cent !== 0).sort((a, b) => b.cent - a.cent);
  }, [zeilen, gruppen]);

  // wer eine Position anfasst, hat sie geprüft -> Markierung „unsicher“ entfällt
  const aendern = (schluessel: string, teil: Partial<Zeile>) => {
    setZeilen((alt) => alt.map((z) => (z.schluessel === schluessel ? { ...z, unsicher: false, ...teil } : z)));
    setGeaendert(true);
  };

  const speichern = async (danach?: "weiter") => {
    if (!bon) return;
    if (
      unsicher > 0 &&
      !confirm(t("1 Position ist noch als unsicher markiert. Trotzdem speichern?|{n} Positionen sind noch als unsicher markiert. Trotzdem speichern?", { n: unsicher }))
    )
      return;
    setSpeichert(true);
    setMeldung(null);
    try {
      const { abgleich } = await api.put<{ abgleich: AbgleichErgebnis | null }>(`/api/bons/${bon.id}`, {
        haendler,
        datum: tag || null,
        summe_cent: summeCent,
        notiz: notiz || null,
        zahlung,
        actual_konto_id: konto || null,
        positionen: zeilen.map(({ schluessel: _s, betragText: _b, ...p }) => p),
      });
      sortenLaden();
      if (danach === "weiter" && bon.naechster_offen) navigate(`/bons/${bon.naechster_offen}`);
      else {
        const aktual = abgleich && abgleich.ergebnis !== "aus" ? ` ${abgleich.text}` : "";
        setMeldung({
          art: abgleich?.ergebnis === "fehler" ? "fehler" : "gut",
          text: `${t("Gespeichert – Korrekturen werden für künftige Bons gemerkt.")}${aktual}`,
        });
        neuLaden();
      }
    } catch (e) {
      setMeldung({ art: "fehler", text: (e as Error).message });
    } finally {
      setSpeichert(false);
    }
  };

  const neuErkennen = async (anbieter: "claude" | "ollama" | "tesseract") => {
    if (!bon) return;
    await api.post(`/api/bons/${bon.id}/neu-erkennen`, { anbieter });
    neuLaden();
  };

  /** Mit einem größeren (teureren) Claude-Modell nachlesen – nur nach ausdrücklicher Bestätigung */
  const mitModellLesen = async (m: { id: string; name: string; schaetzung: number | null }) => {
    if (!bon) return;
    const kosten = m.schaetzung != null ? t("voraussichtlich {betrag}", { betrag: geld(m.schaetzung) }) : t("Kosten unbekannt");
    if (!confirm(t("Bon mit {name} neu lesen?\n\nDas größere Modell ist teurer: {kosten} für diesen Bon.\nBisherige Korrekturen an diesem Bon werden überschrieben.", { name: m.name, kosten }))) return;
    try {
      await api.post(`/api/bons/${bon.id}/neu-erkennen`, { modell: m.id });
      neuLaden();
    } catch (e) {
      setMeldung({ art: "fehler", text: (e as Error).message });
    }
  };

  const loeschen = async () => {
    // (Löschen eigener Bons ist auch ohne Bearbeitungsrecht erlaubt, solange nicht gebucht)
    if (!bon || !confirm(t("Bon und Datei wirklich löschen?"))) return;
    let actual = "";
    if (bon.actual_tx_id) {
      const zuruecknehmen = confirm(
        bon.sammel
          ? t("Dieser Bon gehört zu einer Sammelbuchung mit {n} Bons. Soll die Aufteilung in Actual zurückgenommen werden? Die übrigen Bons sind danach wieder offen und können neu zugeordnet werden.\n\nOK = zurücknehmen · Abbrechen = in Actual lassen", { n: bon.sammel_bons?.length ?? 2 })
          : bon.zahlung === "bar"
          ? t("Die Buchung in Actual wurde von TillSplit angelegt. Soll sie in Actual ebenfalls gelöscht werden?\n\nOK = in Actual löschen · Abbrechen = in Actual lassen")
          : t("Die Abbuchung in Actual ist nach diesem Bon aufgeteilt. Soll die Aufteilung zurückgenommen werden (die Abbuchung selbst bleibt)?\n\nOK = zurücknehmen · Abbrechen = in Actual lassen"),
      );
      actual = zuruecknehmen ? "" : "?actual=behalten";
    }
    try {
      await api.delete(`/api/bons/${bon.id}${actual}`);
      navigate("/bons");
    } catch (e) {
      setMeldung({ art: "fehler", text: (e as Error).message });
    }
  };

  if (fehler) return <Hinweis art="fehler">{fehler}</Hinweis>;
  if (!bon || !gruppen) return null;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to="/bons" className="knopf-leise -ml-3 px-3">
          <Symbol name="zurueck" className="size-4" /> {t("Bons")}
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{bon.haendler ?? t("Neuer Bon")}</h1>
          <StatusMarke status={bon.status} />
          {bon.erstattung && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-gut">{t("Erstattung")}</span>
          )}
        </div>
        <div className="flex gap-2">
          {bearbeiten && !(bon.erstattung && !bon.ki_modell) && (
          <details className="relative">
            <summary className="knopf-zweit list-none">
              <Symbol name="aktualisieren" className="size-4" /> {t("Neu lesen")}
            </summary>
            <div className="karte absolute right-0 z-20 mt-2 w-60 p-1.5 shadow-xl">
              <button className="knopf-leise w-full justify-start" onClick={() => neuErkennen("claude")}>{t("mit Claude")}</button>
              {bon.nachlesen?.modelle.map((m) => (
                <button key={m.id} className="knopf-leise w-full justify-start" onClick={() => void mitModellLesen(m)}>
                  {t("mit {name}", { name: m.name })}
                  {m.schaetzung != null && <span className="ml-auto text-xs text-text-3">≈ {geld(m.schaetzung)}</span>}
                </button>
              ))}
              <button className="knopf-leise w-full justify-start" onClick={() => neuErkennen("ollama")}>{t("mit Ollama (lokal)")}</button>
              <button className="knopf-leise w-full justify-start" onClick={() => neuErkennen("tesseract")}>{t("mit Tesseract")}</button>
            </div>
          </details>
          )}
          {(bearbeiten || bon.status !== "gebucht") && (
            <button className="knopf-zweit text-fehler" onClick={loeschen} aria-label={t("Löschen")}>
              <Symbol name="muell" className="size-4" />
            </button>
          )}
        </div>
      </div>

      {bon.dublette_von && (
        <div className="mb-5 flex flex-wrap items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <Symbol name="warnung" className="mt-0.5 size-4 shrink-0 text-fehler" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t("Mögliches Duplikat")}</div>
            <div className="mt-0.5 text-text-2">
              <Link to={`/bons/${bon.dublette_von}`} className="underline">{t("Bon {nr}", { nr: bon.dublette_von })}</Link> {t("hat denselben Händler, dasselbe Datum und denselben Betrag – vermutlich wurde der Einkauf zweimal fotografiert. Bis zur Klärung wird dieser Bon nicht nach Actual gebucht.")}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="knopf-zweit text-sm text-fehler" onClick={loeschen}>
              <Symbol name="muell" className="size-4" /> {t("Diesen löschen")}
            </button>
            {bearbeiten && (
              <button
                className="knopf-zweit text-sm"
                onClick={() => void api.post(`/api/bons/${bon.id}/kein-duplikat`).then(neuLaden, (e: Error) => setMeldung({ art: "fehler", text: e.message }))}
              >
                {t("Kein Duplikat")}
              </button>
            )}
          </div>
        </div>
      )}

      {bon.gegenpruefung === "abweichung" && (
        <div className="mb-5 flex gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <Symbol name="warnung" className="mt-0.5 size-4 shrink-0 text-fehler" />
          <div>
            <div className="font-medium">{t("Bild und erkannte Daten passen möglicherweise nicht zusammen")}</div>
            <div className="mt-0.5 text-text-2">
              {t("Bei einer zweiten, unabhängigen Lesung des Bildes wurde „{haendler}“ nicht gefunden, dafür ein anderes Geschäft. Bitte Geschäft und Summe mit dem Bild vergleichen – nach einer Korrektur wird erneut geprüft.", {
                haendler: bon.haendler ?? "–",
              })}
            </div>
          </div>
        </div>
      )}

      {bearbeiten && bon.status === "erkannt" && bon.ki_summe_passt === false && bon.nachlesen && (
        <div className="mb-5 space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex gap-2 text-sm">
            <Symbol name="warnung" className="mt-0.5 size-4 shrink-0 text-warnung" />
            <div>
              <div className="font-medium">{t("Die Positionen ergeben nicht die Bonsumme")}</div>
              <div className="mt-0.5 text-text-2">
                {t("Positionen {positionen} · Bon {bon}. Das günstige Modell hat sich vermutlich verlesen. Du kannst die Positionen selbst korrigieren oder ein größeres Modell nachlesen lassen –", { positionen: euro(bon.positionen.reduce((s, p) => s + p.betrag_cent, 0)), bon: euro(bon.summe_cent ?? 0) })}
                <b> {t("das ist teurer")}</b>:
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pl-6">
            {bon.nachlesen.modelle
              .filter((m) => !m.bisher)
              .map((m) => (
                <button key={m.id} className="knopf-zweit text-sm" onClick={() => void mitModellLesen(m)}>
                  {t("Mit {name} nachlesen", { name: m.name })}
                  {m.schaetzung != null && <span className="text-xs text-text-3">≈ {geld(m.schaetzung)}</span>}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Vorschau bon={bon} />
          <p className="mt-2 text-xs text-text-3">
            {bon.erstattung && !bon.ki_modell && `${t("Von Hand erfasste Rückgabe – das Bild ist der Kaufbeleg.")} `}
            {bon.ki_modell && t("Gelesen mit {modell}", { modell: bon.ki_modell })} {bon.datei_pfad && !bon.datei_pfad.startsWith("eingang/") && `· ${t("Ablage: {pfad}", { pfad: bon.datei_pfad })}`}
          </p>
          {bon.pruef_text && (
            <details className="mt-2 text-xs text-text-3">
              <summary className="cursor-pointer hover:text-text">
                {bon.gegenpruefung === "ok"
                  ? t("✓ Gegenprüfung: Geschäft oder Summe im Bild gefunden")
                  : bon.gegenpruefung === "abweichung"
                    ? t("✗ Gegenprüfung: im Bild steht ein anderes Geschäft")
                    : t("Gegenprüfung: nicht eindeutig")}
              </summary>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-rand bg-flaeche-2 p-2 font-mono text-[11px] text-text-2">{bon.pruef_text}</pre>
            </details>
          )}
          {bon.ki_eingabe_tokens != null && (
            <p className="mt-1 text-xs text-text-3">
              {t("KI: {ein} + {aus} Tokens", { ein: tausender(bon.ki_eingabe_tokens + (bon.ki_cache_tokens ?? 0)), aus: tausender(bon.ki_ausgabe_tokens ?? 0) })}
              {bon.ki_cache_tokens ? ` (${t("{n} aus dem Zwischenspeicher", { n: tausender(bon.ki_cache_tokens) })})` : ""}
              {bon.ki_kosten != null && bon.ki_anbieter !== "ollama" && ` · ${t("bisher ≈ {betrag}", { betrag: geld(bon.ki_kosten) })}`}
              {bon.ki_sekunden != null && ` · ${zahl(bon.ki_sekunden)} s`}
            </p>
          )}
        </div>

        {/* min-w-0: sonst macht eine lange, nicht umbrechende Zeile die ganze Spalte breiter als das Handy */}
        <div className="min-w-0 space-y-4">
          {wirdGelesen && (
            <div className="karte flex items-center gap-3 p-5 text-sm">
              <span className="size-5 animate-spin rounded-full border-2 border-akzent border-t-transparent" />
              {t("Der Bon wird gerade gelesen – das dauert meist 10–40 Sekunden.")}
            </div>
          )}
          {bon.status === "fehler" && <Hinweis art="fehler">{bon.fehler}</Hinweis>}

          {!wirdGelesen && !bearbeiten && (
            <Hinweis art="info">{t("Du kannst diesen Bon ansehen. Prüfen und buchen übernimmt ein anderes Mitglied des Haushalts.")}</Hinweis>
          )}
          {!wirdGelesen && (
            // kein <fieldset disabled>: Chrome zeigt Container-Abfragen (@container) darin teils mit Höhe 0 (Felder und
            // Positionen fehlten bis zum Neuladen). Ohne Bearbeitungsrecht sperrt „inert“ stattdessen alle Eingaben.
            <div inert={!bearbeiten} className={`min-w-0 space-y-4 ${bearbeiten ? "" : "opacity-80"}`}>
              {bon.erstattung && !geaendert && (
                <ErstattungBereich bon={bon} onGeaendert={neuLaden} onAngelegt={() => undefined} />
              )}
              <section className="karte @container p-5">
                <div className="grid grid-cols-2 gap-3 @lg:grid-cols-[minmax(0,1fr)_9.5rem_7rem]">
                <label className="col-span-2 text-xs text-text-2 @lg:col-span-1">
                  {t("Geschäft")}
                  <input className="eingabe mt-1" value={haendler} onChange={(e) => (setHaendler(e.target.value), setGeaendert(true))} />
                </label>
                <label className="text-xs text-text-2">
                  {t("Datum")}
                  <input type="date" className="eingabe mt-1" value={tag} onChange={(e) => (setTag(e.target.value), setGeaendert(true))} />
                </label>
                <label className="text-xs text-text-2">
                  {t("Summe")}
                  <input
                    inputMode="decimal"
                    className="eingabe mt-1 text-right font-semibold"
                    value={summeText}
                    onChange={(e) => (setSummeText(e.target.value), setGeaendert(true))}
                  />
                </label>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-rand pt-3">
                  <label className="text-xs text-text-2">
                    {t("Zahlung")}{bon.karte_endziffern && <span className="text-text-3"> · {zahlungText("karte", bon.karte_endziffern)}</span>}
                    <select
                      className="eingabe mt-1"
                      value={zahlung}
                      disabled={bon.status === "gebucht"}
                      onChange={(e) => (setZahlung(e.target.value as Zahlung), setGeaendert(true))}
                    >
                      <option value="karte">{t("Karte / Konto")}</option>
                      <option value="bar">{t("Bar")}</option>
                      <option value="unbekannt">{t("Unbekannt")}</option>
                    </select>
                  </label>
                  <label className="text-xs text-text-2">
                    {t("Actual-Konto")}
                    {bon.konto_quelle === "karte" && konto === bon.actual_konto_id && <span className="text-text-3"> {t("· über Karte")}</span>}
                    <select
                      className="eingabe mt-1"
                      value={konto}
                      disabled={bon.status === "gebucht" || !konten}
                      onChange={(e) => (setKonto(e.target.value), setGeaendert(true))}
                    >
                      <option value="">{zahlung === "bar" ? t("Wie in den Einstellungen") : t("Alle Konten durchsuchen")}</option>
                      <KontoOptionen konten={konten ?? []} />
                    </select>
                  </label>
                </div>
              </section>

              {zeilen.length > 0 && differenz !== 0 && (
                <Hinweis art="warnung">
                  {differenz > 0
                    ? t("Die Positionen ergeben {summe} – das sind {differenz} weniger als die Bonsumme.", { summe: euro(positionenCent), differenz: euro(Math.abs(differenz)) })
                    : t("Die Positionen ergeben {summe} – das sind {differenz} mehr als die Bonsumme.", { summe: euro(positionenCent), differenz: euro(Math.abs(differenz)) })}
                </Hinweis>
              )}
              {ohneGruppe > 0 && (
                <Hinweis art="warnung">
                  {t("1 Artikel konnte keiner Gruppe zugeordnet werden – in der Liste gelb markiert. Bitte Gruppe wählen; TillSplit merkt sich das für künftige Bons.|{n} Artikel konnten keiner Gruppe zugeordnet werden – in der Liste gelb markiert. Bitte Gruppe wählen; TillSplit merkt sich das für künftige Bons.", { n: ohneGruppe })}
                </Hinweis>
              )}
              {unsicher > 0 && (
                <div className="flex gap-2 rounded-xl border-2 border-red-500/60 bg-red-500/10 px-4 py-3 text-sm text-fehler">
                  <Symbol name="warnung" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <b>{t("Bitte prüfen:")}</b>{" "}
                    {t("1 Position wurde unsicher gelesen (rot markiert). Mit dem Bon vergleichen, korrigieren oder mit „Passt“ bestätigen.|{n} Positionen wurden unsicher gelesen (rot markiert). Mit dem Bon vergleichen, korrigieren oder mit „Passt“ bestätigen.", { n: unsicher })}
                  </span>
                </div>
              )}
              {zeilen.length > 0 && differenz === 0 && ohneGruppe === 0 && unsicher === 0 && <Hinweis art="gut">{t("Summe stimmt, alle Positionen sind zugeordnet.")}</Hinweis>}

              <section className="karte @container overflow-hidden">
                <div className="flex items-center justify-between border-b border-rand px-5 py-3">
                  <h2 className="text-sm font-semibold">{t("Positionen ({n})", { n: zeilen.length })}</h2>
                  <span className="text-xs text-text-3">
                    <Symbol name="funke" className="mr-1 inline size-3.5" />{t("= gelernte Zuordnung")}
                  </span>
                </div>
                <div className="divide-y divide-rand">
                  {zeilen.map((z) => (
                    <div
                      key={z.schluessel}
                      className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-2 px-5 py-3 @lg:grid-cols-[minmax(0,1fr)_12rem_6rem_auto] ${
                        z.unsicher ? "border-l-4 border-l-red-500 bg-red-500/10" : z.gruppe_id == null ? "border-l-4 border-l-amber-500 bg-amber-500/10" : ""
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        {z.unsicher && (
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-fehler">
                            <Symbol name="warnung" className="size-3.5" />
                            {t("Unsicher gelesen – bitte mit dem Bon vergleichen")}
                            <button
                              type="button"
                              className="rounded-md border border-red-500/40 px-1.5 py-0.5 font-medium hover:bg-red-500/10"
                              onClick={() => aendern(z.schluessel, { unsicher: false })}
                            >
                              ✓ {t("Passt")}
                            </button>
                          </div>
                        )}
                        {z.gruppe_id == null && <div className="text-[11px] font-semibold text-warnung">{t("Nicht zugeordnet – bitte Gruppe wählen")}</div>}
                        <input
                          className="eingabe py-1.5 text-sm font-medium"
                          aria-label={t("Artikelname")}
                          placeholder={t("Artikelname")}
                          value={z.name}
                          onChange={(e) => aendern(z.schluessel, { name: e.target.value })}
                        />
                        <div className="flex items-center gap-1 text-[11px] text-text-3">
                          {z.gruppe_quelle === "regel" && <Symbol name="funke" className="size-3 shrink-0 text-akzent" />}
                          <input
                            className="min-w-0 flex-1 rounded-md border border-dashed border-rand bg-transparent px-1.5 py-0.5 font-mono outline-none focus:border-akzent focus:text-text"
                            aria-label={t("Text auf dem Bon")}
                            title={t("Text, wie er auf dem Bon steht – daraus lernt TillSplit die Zuordnung für künftige Bons")}
                            placeholder={t("Text auf dem Bon")}
                            value={z.text_roh}
                            onChange={(e) => aendern(z.schluessel, { text_roh: e.target.value })}
                          />
                          {z.menge != null && z.menge !== 1 && (
                            <span className="shrink-0">
                              · {zahl(z.menge, 3)} {z.einheit ?? ""} × {euro(z.einzelpreis_cent)}
                            </span>
                          )}
                        </div>
                      </div>
                      <input
                        inputMode="decimal"
                        className={`eingabe w-24 py-1.5 text-right text-[13px] font-semibold @lg:order-3 @lg:w-full ${z.betrag_cent < 0 ? "text-gut" : ""}`}
                        value={z.betragText}
                        onChange={(e) => aendern(z.schluessel, { betragText: e.target.value, betrag_cent: centAusText(e.target.value) ?? 0 })}
                      />
                      <div className="col-span-3 row-start-2 grid grid-cols-2 gap-2 @lg:order-2 @lg:col-span-1 @lg:row-start-auto @lg:grid-cols-1 @lg:gap-1">
                        <GruppenWahl gruppen={gruppen} wert={z.gruppe_id} onWahl={(g) => aendern(z.schluessel, { gruppe_id: g, gruppe_quelle: "hand" })} />
                        <SortenWahl sorten={sortenListe} wert={z.sorte ?? null} onWahl={(s) => aendern(z.schluessel, { sorte: s })} />
                      </div>
                      <button
                        className="knopf-leise justify-self-end px-2 text-text-3 @lg:order-4"
                        aria-label={t("Position entfernen")}
                        onClick={() => (setZeilen(zeilen.filter((x) => x.schluessel !== z.schluessel)), setGeaendert(true))}
                      >
                        <Symbol name="muell" className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between border-t border-rand bg-flaeche-2 px-5 py-3">
                  <button
                    className="knopf-leise -ml-3"
                    onClick={() => {
                      setZeilen([...zeilen, zeileAus({ text_roh: "", name: t("Neue Position"), menge: null, einheit: null, einzelpreis_cent: null, betrag_cent: 0, gruppe_id: null })]);
                      setGeaendert(true);
                    }}
                  >
                    <Symbol name="plus" className="size-4" /> {t("Position")}
                  </button>
                  <div className="text-sm">
                    {t("Summe Positionen")} <b className="ml-2">{euro(positionenCent)}</b>
                  </div>
                </div>
              </section>

              <label className="block text-xs text-text-2">
                {t("Notiz")}
                <input className="eingabe mt-1" value={notiz} placeholder={t("optional")} onChange={(e) => (setNotiz(e.target.value), setGeaendert(true))} />
              </label>

              {bearbeiten && <div className="flex flex-wrap items-center gap-2">
                <button className="knopf-haupt" disabled={speichert} onClick={() => speichern()}>
                  <Symbol name="haken" className="size-4" /> {bon.status === "erkannt" ? t("Prüfung abschließen") : t("Speichern")}
                </button>
                {bon.naechster_offen && (
                  <button className="knopf-zweit" disabled={speichert} onClick={() => speichern("weiter")}>
                    {t("Speichern & nächster Bon")} <Symbol name="weiter" className="size-4" />
                  </button>
                )}
                {geaendert && (
                  <span className="text-xs text-warnung">
                    {bon.status === "gebucht"
                      ? t("Ungespeicherte Änderungen – beim Speichern wird die Aufteilung in Actual angepasst.")
                      : t("Ungespeicherte Änderungen")}
                  </span>
                )}
              </div>}
              {meldung && <Hinweis art={meldung.art === "gut" ? "gut" : "fehler"}>{meldung.text}</Hinweis>}

              {bearbeiten && (bon.status === "geprueft" || bon.status === "wartet" || bon.status === "gebucht") && !geaendert && (
                <ActualBereich key={`${bon.status}-${bon.actual_konto_id}-${bon.zahlung}-${bon.summe_cent}`} bon={bon} konten={konten} aufteilung={aufteilung} onGebucht={neuLaden} />
              )}
              {bearbeiten && !bon.erstattung && !geaendert && bon.status !== "fehler" && (
                <ErstattungBereich
                  bon={bon}
                  onGeaendert={neuLaden}
                  onAngelegt={(neu, hinweis) => {
                    if (hinweis) sessionStorage.setItem("tillsplit-rueckgabe", JSON.stringify({ id: neu, hinweis }));
                    navigate(`/bons/${neu}`);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
