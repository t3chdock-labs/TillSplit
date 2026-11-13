import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type BonListeneintrag } from "../api";
import { Hinweis, Kopf, Leer, StatusMarke, useDaten } from "../komponenten/Bausteine";
import { SammelDialog, SammelVorschlaege } from "../komponenten/Sammelbuchung";
import { useHochladen } from "../komponenten/Hochladen";
import { Symbol } from "../komponenten/Symbol";
import { datum, euro, iso, monatsNamen, zahlungText } from "../format";
import { useSitzung } from "../sitzung";
import { t } from "../i18n";

const filter = [
  { wert: "", text: t("Alle") },
  { wert: "erkannt", text: t("Zu prüfen") },
  { wert: "geprueft", text: t("Geprüft") },
  { wert: "wartet", text: t("Wartet auf Bank") },
  { wert: "gebucht", text: t("In Actual") },
  { wert: "fehler", text: t("Fehler") },
];

type ZeitArt = "alle" | "jahr" | "monat" | "tag" | "frei";
const zeitArten: { wert: ZeitArt; text: string }[] = [
  { wert: "alle", text: t("Alle Zeiten") },
  { wert: "jahr", text: t("Jahr") },
  { wert: "monat", text: t("Monat") },
  { wert: "tag", text: t("Tag") },
  { wert: "frei", text: t("Zeitraum") },
];
const heuteIso = () => iso(new Date());
const monatsnamen = monatsNamen("long");
const letzterTag = (jahr: number, monat: number) => new Date(jahr, monat, 0).getDate();

/** Zeitfilter (Jahr, Monat, Tag oder freier Zeitraum) in von/bis umrechnen */
function zeitraumVon(art: ZeitArt, wert: { jahr: string; monat: string; tag: string; von: string; bis: string }) {
  if (art === "jahr" && /^\d{4}$/.test(wert.jahr)) return { von: `${wert.jahr}-01-01`, bis: `${wert.jahr}-12-31` };
  if (art === "monat" && /^\d{4}-\d{2}$/.test(wert.monat)) {
    const [j, m] = wert.monat.split("-").map(Number);
    return { von: `${wert.monat}-01`, bis: `${wert.monat}-${String(letzterTag(j, m)).padStart(2, "0")}` };
  }
  if (art === "tag" && wert.tag) return { von: wert.tag, bis: wert.tag };
  if (art === "frei") return { von: wert.von || null, bis: wert.bis || null };
  return { von: null, bis: null };
}

/** Für eine Sammelbuchung wählbar: geprüft, noch nicht gebucht, nicht bar bezahlt, kein mögliches Duplikat */
const sammelWaehlbar = (b: BonListeneintrag) =>
  (b.status === "geprueft" || b.status === "wartet") && b.zahlung !== "bar" && !b.dublette_von && b.summe_cent != null;

/** Kleines Vorschaubild: Fotos verkleinert, bei PDFs die erste Seite; schlägt das fehl, bleibt die Beschriftung */
function Vorschaubild({ bon }: { bon: BonListeneintrag }) {
  const [fehler, setFehler] = useState(false);
  const pdf = bon.datei_mime === "application/pdf";
  if (fehler) return <div className="flex size-full items-center justify-center text-[10px] font-bold text-text-3">{pdf ? "PDF" : ""}</div>;
  return (
    <div className="relative size-full bg-white">
      <img
        src={`/api/bons/${bon.id}/vorschau?v=${bon.datei_version ?? ""}`}
        alt=""
        loading="lazy"
        onError={() => setFehler(true)}
        className="size-full object-cover object-top"
      />
      {pdf && <span className="absolute right-0 bottom-0 rounded-tl bg-red-600 px-1 text-[8px] leading-tight font-bold text-white">PDF</span>}
    </div>
  );
}

export function Bons() {
  // Filter aus dem Link übernehmen (z. B. Benachrichtigung „Prüfung ausstehend“ -> ?status=erkannt)
  const [adresse] = useSearchParams();
  const [status, setStatus] = useState(() => adresse.get("status") ?? "");
  useEffect(() => {
    const s = adresse.get("status");
    if (s != null) setStatus(s);
  }, [adresse]);
  const [suche, setSuche] = useState("");
  const [seite, setSeite] = useState(1);
  const [zeitArt, setZeitArt] = useState<ZeitArt>("alle");
  const [zeit, setZeit] = useState(() => ({
    jahr: String(new Date().getFullYear()),
    monat: heuteIso().slice(0, 7),
    tag: heuteIso(),
    von: "",
    bis: "",
  }));
  const zeitAendern = (teil: Partial<typeof zeit>) => (setZeit({ ...zeit, ...teil }), setSeite(1));
  const { auswaehlen, zaehler } = useHochladen();
  const { darf } = useSitzung();

  const pfad = useMemo(() => {
    const p = new URLSearchParams({ seite: String(seite) });
    if (status) p.set("status", status);
    if (suche.trim()) p.set("suche", suche.trim());
    const { von, bis } = zeitraumVon(zeitArt, zeit);
    if (von) p.set("von", von);
    if (bis) p.set("bis", bis);
    return `/api/bons?${p}`;
  }, [status, suche, seite, zeitArt, zeit]);
  const gefiltert = Boolean(status || suche || zeitArt !== "alle");
  const jahre = useMemo(() => {
    const jetzt = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, i) => String(jetzt - i));
  }, []);
  const { daten, neuLaden } = useDaten<{ bons: BonListeneintrag[]; gesamt: number; proSeite: number }>(pfad);

  useEffect(() => {
    neuLaden();
  }, [zaehler, neuLaden]);

  // Solange Bons gelesen werden, regelmäßig nachsehen
  const inArbeit = daten?.bons.some((b) => b.status === "neu" || b.status === "in_arbeit");
  useEffect(() => {
    if (!inArbeit) return;
    const zeit = setInterval(neuLaden, 2500);
    return () => clearInterval(zeit);
  }, [inArbeit, neuLaden]);

  const seiten = daten ? Math.ceil(daten.gesamt / daten.proSeite) : 1;

  // Sammelbuchung: Bons auswählen (null = Auswahl aus), Summe je Bon merken (auch über Seiten hinweg)
  const [auswahl, setAuswahl] = useState<Map<number, number> | null>(null);
  const [sammelOffen, setSammelOffen] = useState(false);
  const [vorschlagZaehler, setVorschlagZaehler] = useState(0);
  const umschalten = (b: BonListeneintrag) => {
    if (!auswahl || !sammelWaehlbar(b)) return;
    const neu = new Map(auswahl);
    if (neu.has(b.id)) neu.delete(b.id);
    else neu.set(b.id, b.summe_cent ?? 0);
    setAuswahl(neu);
  };
  const auswahlSumme = auswahl ? [...auswahl.values()].reduce((s, c) => s + c, 0) : 0;

  const [gleichtAb, setGleichtAb] = useState(false);
  const [abgleichText, setAbgleichText] = useState<string | null>(null);
  const abgleichen = async () => {
    setGleichtAb(true);
    setAbgleichText(null);
    try {
      const z = await api.post<Record<string, number>>("/api/abgleich");
      const teile = [
        z.gebucht && t("{n} zugeordnet", { n: z.gebucht }),
        z.wartet && t("{n} wartet auf die Bank|{n} warten auf die Bank", { n: z.wartet }),
        z.auswahl && t("{n} mit mehreren Treffern", { n: z.auswahl }),
        z.duplikat && t("{n} mögliches Duplikat (nicht gebucht)|{n} mögliche Duplikate (nicht gebucht)", { n: z.duplikat }),
        z.kein_konto && t("{n} ohne Konto", { n: z.kein_konto }),
        z.fehler && t("{n} Fehler", { n: z.fehler }),
      ].filter(Boolean);
      setAbgleichText(teile.length ? teile.join(" · ") : t("Nichts offen"));
      neuLaden();
      setVorschlagZaehler((z) => z + 1);
    } catch (e) {
      setAbgleichText((e as Error).message);
    } finally {
      setGleichtAb(false);
    }
  };

  return (
    <>
      <Kopf
        titel={t("Bons")}
        unter={abgleichText ?? (daten ? t("{n} Bon|{n} Bons", { n: daten.gesamt }) : undefined)}
        rechts={
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {darf("bons_bearbeiten") && (
              <button
                className={auswahl ? "knopf-haupt" : "knopf-zweit"}
                onClick={() => setAuswahl(auswahl ? null : new Map())}
                title={t("Mehrere Bons gemeinsam auf eine Abbuchung buchen (z. B. mehrere Amazon-Rechnungen)")}
              >
                <Symbol name="link" className="size-4" /> <span className="max-sm:hidden">{auswahl ? t("Auswahl beenden") : t("Zusammen buchen")}</span><span className="sm:hidden">{auswahl ? t("Fertig") : t("Bündeln")}</span>
              </button>
            )}
            {darf("bons_bearbeiten") && (
              <button className="knopf-zweit" disabled={gleichtAb} onClick={abgleichen} title={t("Nach dem Bankimport: offene Bons den Abbuchungen zuordnen")}>
                <Symbol name="aktualisieren" className={`size-4 ${gleichtAb ? "animate-spin" : ""}`} /> <span className="max-sm:hidden">{t("Mit Actual abgleichen")}</span><span className="sm:hidden">{t("Abgleichen")}</span>
              </button>
            )}
            <button className="knopf-haupt" onClick={() => auswaehlen()}>
              <Symbol name="hochladen" className="size-4" /> {t("Hochladen")}
            </button>
          </div>
        }
      />

      {darf("bons_bearbeiten") && !auswahl && (
        <SammelVorschlaege neuLadenZaehler={vorschlagZaehler} onGebucht={neuLaden} />
      )}
      {auswahl && (
        <div className="mb-4">
          <Hinweis art="info">
            {t("Wähle die Bons, die zusammen abgebucht wurden (z. B. mehrere Amazon-Rechnungen mit einer Abbuchung). Wählbar sind geprüfte Bons, die noch nicht in Actual gebucht und nicht bar bezahlt sind.")}
          </Hinweis>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1.5">
          {filter.map((f) => (
            <button
              key={f.wert}
              className={`chip ${status === f.wert ? "chip-aktiv" : ""}`}
              onClick={() => (setStatus(f.wert), setSeite(1))}
            >
              {f.text}
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <Symbol name="suche" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
          <input
            className="eingabe pl-9"
            placeholder={t("Geschäft oder Artikel suchen")}
            value={suche}
            onChange={(e) => (setSuche(e.target.value), setSeite(1))}
          />
        </div>
      </div>

      {/* Zeitfilter nach Bon-Datum */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {zeitArten.map((z) => (
          <button key={z.wert} className={`chip ${zeitArt === z.wert ? "chip-aktiv" : ""}`} onClick={() => (setZeitArt(z.wert), setSeite(1))}>
            {z.text}
          </button>
        ))}
        {zeitArt === "jahr" && (
          <select className="eingabe w-auto py-1.5" value={zeit.jahr} onChange={(e) => zeitAendern({ jahr: e.target.value })} aria-label={t("Jahr")}>
            {jahre.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        )}
        {zeitArt === "monat" && (
          // zwei Auswahllisten statt <input type="month"> – das kann Firefox nicht
          <>
            <select
              className="eingabe w-auto py-1.5"
              value={zeit.monat.slice(5, 7)}
              onChange={(e) => zeitAendern({ monat: `${zeit.monat.slice(0, 4)}-${e.target.value}` })}
              aria-label={t("Monat")}
            >
              {monatsnamen.map((name, i) => (
                <option key={name} value={String(i + 1).padStart(2, "0")}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="eingabe w-auto py-1.5"
              value={zeit.monat.slice(0, 4)}
              onChange={(e) => zeitAendern({ monat: `${e.target.value}-${zeit.monat.slice(5, 7)}` })}
              aria-label={t("Jahr des Monats")}
            >
              {jahre.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </>
        )}
        {zeitArt === "tag" && (
          <input type="date" className="eingabe w-auto py-1.5" value={zeit.tag} onChange={(e) => zeitAendern({ tag: e.target.value })} aria-label={t("Tag")} />
        )}
        {zeitArt === "frei" && (
          <span className="flex flex-wrap items-center gap-1.5 text-sm">
            <input type="date" className="eingabe w-auto py-1.5" value={zeit.von} max={zeit.bis || undefined} onChange={(e) => zeitAendern({ von: e.target.value })} aria-label={t("Von")} />
            <span className="text-text-3">{t("bis")}</span>
            <input type="date" className="eingabe w-auto py-1.5" value={zeit.bis} min={zeit.von || undefined} onChange={(e) => zeitAendern({ bis: e.target.value })} aria-label={t("Bis")} />
          </span>
        )}
      </div>

      {daten && daten.bons.length === 0 ? (
        <Leer
          titel={gefiltert ? t("Nichts gefunden") : t("Noch keine Bons")}
          text={gefiltert ? (zeitArt !== "alle" ? t("In diesem Zeitraum gibt es keine passenden Bons.") : undefined) : t("Fotografiere einen Kassenbon, lade einen Screenshot oder ein PDF hoch.")}
          aktion={
            !gefiltert && (
              <button className="knopf-haupt" onClick={() => auswaehlen()}>
                {t("Ersten Bon hochladen")}
              </button>
            )
          }
        />
      ) : (
        <div className="karte divide-y divide-rand overflow-hidden">
          {daten?.bons.map((b) => {
            const abweichung = b.summe_cent != null && b.anzahl_positionen > 0 && b.summe_cent !== b.positionen_cent;
            const waehlbar = sammelWaehlbar(b);
            const inhalt = (
              <>
                {auswahl && (
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-[var(--color-akzent)]"
                    checked={auswahl.has(b.id)}
                    disabled={!waehlbar}
                    readOnly
                    tabIndex={-1}
                    aria-hidden
                  />
                )}
                <div className="size-12 shrink-0 overflow-hidden rounded-lg border border-rand bg-flaeche-2">
                  <Vorschaubild bon={b} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{b.haendler ?? (b.status === "fehler" ? t("Nicht lesbar") : t("Wird gelesen …"))}</span>
                    <StatusMarke status={b.status} />
                    {!!b.ohne_gruppe && (
                      <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-warnung">
                        {t("{n} ohne Gruppe", { n: b.ohne_gruppe })}
                      </span>
                    )}
                    {!!b.unsicher && (
                      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-fehler">
                        {t("{n} unsicher", { n: b.unsicher })}
                      </span>
                    )}
                    {b.gegenpruefung === "abweichung" && (
                      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-fehler" title={t("Im Bild steht ein anderes Geschäft")}>
                        {t("Bild prüfen")}
                      </span>
                    )}
                    {b.sammel && (
                      <span className="shrink-0 rounded-full bg-akzent-hell px-2 py-0.5 text-[11px] font-semibold text-akzent" title={t("Mit anderen Bons zusammen auf eine Abbuchung gebucht")}>
                        {t("Sammelbuchung")}
                      </span>
                    )}
                    {b.erstattung && (
                      <span
                        className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-gut"
                        title={b.erstattung_von ? t("Erstattung zu Bon {nr}", { nr: b.erstattung_von }) : t("Geld zurück – noch keinem Kauf zugeordnet")}
                      >
                        {t("Erstattung")}
                      </span>
                    )}
                    {b.dublette_von && (
                      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-fehler">{t("Doppelt?")}</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-text-3">
                    {b.status === "fehler"
                      ? b.fehler
                      : `${datum(b.datum)}${b.uhrzeit ? ` · ${b.uhrzeit}` : ""} · ${t("{n} Position|{n} Positionen", { n: b.anzahl_positionen })} · ${zahlungText(b.zahlung, b.karte_endziffern)}`}
                    {abweichung && <span className="ml-2 text-warnung">{t("Summe weicht ab")}</span>}
                  </div>
                </div>
                <div className={`text-right font-semibold ${b.erstattung ? "text-gut" : ""}`}>{euro(b.summe_cent)}</div>
                {!auswahl && <Symbol name="weiter" className="size-4 text-text-3" />}
              </>
            );
            return auswahl ? (
              <button
                key={b.id}
                type="button"
                role="checkbox"
                aria-checked={auswahl.has(b.id)}
                disabled={!waehlbar}
                onClick={() => umschalten(b)}
                className={`flex w-full items-center gap-4 px-4 py-3 text-left transition ${waehlbar ? "hover:bg-flaeche-2" : "opacity-45"} ${auswahl.has(b.id) ? "bg-akzent-hell/40" : ""}`}
              >
                {inhalt}
              </button>
            ) : (
              <Link key={b.id} to={`/bons/${b.id}`} className="flex items-center gap-4 px-4 py-3 transition hover:bg-flaeche-2">
                {inhalt}
              </Link>
            );
          })}
        </div>
      )}

      {seiten > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          <button className="knopf-zweit" disabled={seite <= 1} onClick={() => setSeite(seite - 1)}>
            {t("Zurück")}
          </button>
          <span className="text-text-2">
            {t("Seite {seite} von {seiten}", { seite, seiten })}
          </span>
          <button className="knopf-zweit" disabled={seite >= seiten} onClick={() => setSeite(seite + 1)}>
            {t("Weiter")}
          </button>
        </div>
      )}
      {auswahl && <div className="h-20" aria-hidden />}
      {auswahl && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:bottom-6">
          <div className="karte flex w-full max-w-md items-center gap-3 px-4 py-3 shadow-2xl">
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate font-semibold">{t("{n} ausgewählt", { n: auswahl.size })}</div>
              <div className="truncate text-xs text-text-2">{t("Zusammen {betrag}", { betrag: euro(auswahlSumme) })}</div>
            </div>
            {/* auf dem Handy beendet der Knopf oben die Auswahl – hier fehlt der Platz */}
            <button className="knopf-zweit max-sm:hidden" onClick={() => setAuswahl(null)}>{t("Abbrechen")}</button>
            <button className="knopf-haupt shrink-0" disabled={auswahl.size < 2} onClick={() => setSammelOffen(true)}>
              {t("Abbuchung suchen")}
            </button>
          </div>
        </div>
      )}
      {auswahl && sammelOffen && (
        <SammelDialog
          bonIds={[...auswahl.keys()]}
          onAbbrechen={() => setSammelOffen(false)}
          onFertig={() => {
            setSammelOffen(false);
            setAuswahl(null);
            neuLaden();
            setVorschlagZaehler((z) => z + 1);
          }}
        />
      )}
    </>
  );
}
