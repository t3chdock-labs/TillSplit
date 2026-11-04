import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Hinweis, useDaten } from "./Bausteine";
import { Symbol } from "./Symbol";
import { t } from "../i18n";

type Teil = { typ: "baustein"; name: string } | { typ: "text"; wert: string } | { typ: "ordner" };
type AblageDaten = { vorlage: string; verschluesseln: boolean; standard: string; bausteine: string[]; beispiel: string; laeuft: boolean };

const erklaerung: Record<string, string> = {
  Jahr: "2026",
  Monat: "11",
  Monatsname: t("11-November"),
  Tag: "02",
  Datum: "2026-11-02",
  Händler: "REWE",
  Summe: "47,80",
  Zahlung: t("Karte / Bar"),
  Hochgeladen: t("wer hochgeladen hat"),
  Haushalt: t("Name des Haushalts"),
  Bon: t("Bon-Nummer"),
};

function zerlegen(vorlage: string): Teil[] {
  return vorlage
    .split(/(\{[^}]+\}|\/)/)
    .filter(Boolean)
    .map((s): Teil => (s === "/" ? { typ: "ordner" } : s.startsWith("{") ? { typ: "baustein", name: s.slice(1, -1) } : { typ: "text", wert: s }));
}
const zusammensetzen = (teile: Teil[]) => teile.map((x) => (x.typ === "ordner" ? "/" : x.typ === "baustein" ? `{${x.name}}` : x.wert)).join("");
/** Bausteine heißen intern deutsch (so stehen sie in der Vorlage), angezeigt wird die Übersetzung */
const bausteinName = (name: string) => t(name);
// Übersetzungsschlüssel der Bausteine (für werkzeuge/texte-pruefen.mjs)
void (() => [t("Jahr"), t("Monat"), t("Monatsname"), t("Tag"), t("Datum"), t("Händler"), t("Summe"), t("Zahlung"), t("Hochgeladen"), t("Haushalt"), t("Bon")]);

function Chip({ teil, onEntfernen, ziehbar, onZiehen, onAblegen, aktiv }: {
  teil: Teil; onEntfernen?: () => void; ziehbar?: boolean; onZiehen?: () => void; onAblegen?: () => void; aktiv?: boolean;
}) {
  const stil =
    teil.typ === "ordner"
      ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : teil.typ === "baustein"
        ? "border-akzent/40 bg-akzent-hell text-akzent"
        : "border-rand bg-flaeche-2 font-mono text-text-2";
  return (
    <span
      draggable={ziehbar}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "teil");
        onZiehen?.();
      }}
      onDragOver={(e) => onAblegen && (e.preventDefault(), (e.dataTransfer.dropEffect = "move"))}
      onDrop={(e) => (e.preventDefault(), e.stopPropagation(), onAblegen?.())}
      className={`inline-flex select-none items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium ${stil} ${ziehbar ? "cursor-grab active:cursor-grabbing" : ""} ${aktiv ? "ring-2 ring-akzent" : ""}`}
    >
      {teil.typ === "ordner" ? (
        <>
          <Symbol name="weiter" className="size-3" /> {t("Ordner")}
        </>
      ) : teil.typ === "baustein" ? (
        bausteinName(teil.name)
      ) : (
        `"${teil.wert}"`
      )}
      {onEntfernen && (
        <button type="button" className="-mr-1 ml-0.5 rounded px-1 opacity-60 hover:opacity-100" aria-label={t("Entfernen")} onClick={onEntfernen}>
          ×
        </button>
      )}
    </span>
  );
}

/** Ordner und Dateinamen der Bon-Ablage aus Bausteinen zusammenstellen (Drag & Drop oder Antippen) */
export function AblageVorlage() {
  const { daten, neuLaden } = useDaten<AblageDaten>("/api/ablage");
  const [teile, setTeile] = useState<Teil[] | null>(null);
  const [verschluesseln, setVerschluesseln] = useState(false);
  const [neuAblegen, setNeuAblegen] = useState(true);
  const [text, setText] = useState("");
  const [vorschau, setVorschau] = useState<{ beispiel?: string; fehler?: string }>({});
  const [meldung, setMeldung] = useState<{ text: string; art: "gut" | "fehler" } | null>(null);
  const gezogen = useRef<{ quelle: "palette"; teil: Teil } | { quelle: "zeile"; index: number } | null>(null);

  useEffect(() => {
    if (!daten) return;
    setTeile(zerlegen(daten.vorlage));
    setVerschluesseln(daten.verschluesseln);
  }, [daten]);

  const vorlage = teile ? zusammensetzen(teile) : "";
  useEffect(() => {
    if (!vorlage) return;
    const zeit = setTimeout(() => {
      api
        .post<{ beispiel: string }>("/api/ablage/vorschau", { vorlage })
        .then((v) => setVorschau({ beispiel: v.beispiel }))
        .catch((e: Error) => setVorschau({ fehler: e.message }));
    }, 250);
    return () => clearTimeout(zeit);
  }, [vorlage]);

  if (!daten || !teile) return null;
  const geaendert = vorlage !== daten.vorlage || verschluesseln !== daten.verschluesseln;

  const einfuegen = (teil: Teil, index = teile.length) => setTeile([...teile.slice(0, index), teil, ...teile.slice(index)]);
  const ablegenBei = (index: number) => {
    const g = gezogen.current;
    gezogen.current = null;
    if (!g) return;
    if (g.quelle === "palette") return einfuegen(g.teil, index);
    const neu = [...teile];
    const [teil] = neu.splice(g.index, 1);
    neu.splice(g.index < index ? index - 1 : index, 0, teil);
    setTeile(neu);
  };

  const speichern = async () => {
    setMeldung(null);
    try {
      const erg = await api.put<{ laeuft: boolean }>("/api/ablage", { vorlage, verschluesseln, neuAblegen: neuAblegen && vorlage !== daten.vorlage });
      setMeldung({
        art: "gut",
        text: erg.laeuft
          ? t("Gespeichert – vorhandene Bons werden im Hintergrund umbenannt bzw. ver- oder entschlüsselt.")
          : t("Gespeichert – gilt für alle neuen Bons."),
      });
      neuLaden();
    } catch (e) {
      setMeldung({ art: "fehler", text: (e as Error).message });
    }
  };

  const palette: Teil[] = [
    ...daten.bausteine.map((name): Teil => ({ typ: "baustein", name })),
    { typ: "ordner" },
    { typ: "text", wert: "_" },
    { typ: "text", wert: "-" },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="karte space-y-4 p-5 lg:col-span-2">
        <div>
          <h2 className="font-semibold">{t("Ordner und Dateinamen")}</h2>
          <p className="mt-1 text-sm text-text-2">
            {t("Bausteine in die Zeile ziehen (oder antippen, um sie hinten anzufügen) und dort per Ziehen umsortieren. „Ordner“ beginnt eine neue Ordnerebene, der letzte Teil ist der Dateiname.")}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {palette.map((teil, i) => (
            <button
              key={i}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", "teil");
                gezogen.current = { quelle: "palette", teil };
              }}
              onClick={() => einfuegen(teil)}
              title={teil.typ === "baustein" ? t("Beispiel: {wert}", { wert: erklaerung[teil.name] ?? "" }) : undefined}
            >
              <Chip teil={teil} />
            </button>
          ))}
          <form
            className="inline-flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) einfuegen({ typ: "text", wert: text });
              setText("");
            }}
          >
            <input className="eingabe w-28 py-1 text-xs" placeholder={t("eigener Text")} value={text} onChange={(e) => setText(e.target.value)} maxLength={30} />
            <button className="knopf-zweit px-2 py-1 text-xs" disabled={!text.trim()}>
              <Symbol name="plus" className="size-3.5" />
            </button>
          </form>
        </div>

        <div
          className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-xl border-2 border-dashed border-rand p-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => (e.preventDefault(), ablegenBei(teile.length))}
        >
          {teile.length === 0 && <span className="text-sm text-text-3">{t("Bausteine hierher ziehen")}</span>}
          {teile.map((teil, i) => (
            <Chip
              key={i}
              teil={teil}
              ziehbar
              onZiehen={() => (gezogen.current = { quelle: "zeile", index: i })}
              onAblegen={() => ablegenBei(i)}
              onEntfernen={() => setTeile(teile.filter((_, j) => j !== i))}
            />
          ))}
          <span className="ml-1 text-xs text-text-3">.jpg / .pdf</span>
        </div>

        <div className="text-sm">
          {vorschau.fehler ? (
            <span className="text-fehler">{vorschau.fehler}</span>
          ) : (
            <>
              {t("Beispiel:")} <code className="break-all rounded bg-flaeche-2 px-1.5 py-0.5 text-[13px]">{vorschau.beispiel}</code>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="knopf-leise text-xs" onClick={() => setTeile(zerlegen(daten.standard))}>
            {t("Standard: Jahr / Monat / Datum_Händler_Summe")}
          </button>
          <button className="knopf-leise text-xs" onClick={() => setTeile(zerlegen("{Jahr}/{Händler}/{Datum}_{Summe}"))}>
            {t("Nach Händler: Jahr / Händler / Datum_Summe")}
          </button>
          <button className="knopf-leise text-xs" onClick={() => setTeile(zerlegen("{Händler}/{Jahr}/{Datum}_{Summe}"))}>
            {t("Händler / Jahr / Datum_Summe")}
          </button>
        </div>
      </section>

      <section className="karte space-y-3 p-5">
        <h2 className="font-semibold">{t("Verschlüsselung")}</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={verschluesseln} onChange={(e) => setVerschluesseln(e.target.checked)} />
          <span>
            {t("Bon-Dateien verschlüsselt ablegen")}
            <span className="block text-xs text-text-3">
              {t("AES-256 mit dem Schlüssel des Servers (TILLSPLIT_SCHLUESSEL). Die Ordnerstruktur bleibt, die Dateien enden auf")} <code>.enc</code> {t("und lassen sich nur noch über TillSplit öffnen – nicht mehr direkt auf dem NAS. Geht der Schlüssel verloren, sind die Bons unwiederbringlich verloren.")}
            </span>
          </span>
        </label>
      </section>

      <section className="karte space-y-3 p-5">
        <h2 className="font-semibold">{t("Vorhandene Bons")}</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={neuAblegen} onChange={(e) => setNeuAblegen(e.target.checked)} />
          <span>
            {t("Nach der neuen Vorlage umbenennen")}
            <span className="block text-xs text-text-3">{t("Sonst gilt die Vorlage nur für neue Bons. Beim Ein- oder Ausschalten der Verschlüsselung werden alle Bons umgewandelt.")}</span>
          </span>
        </label>
        {daten.laeuft && <Hinweis art="info">{t("Die Bons werden gerade neu abgelegt …")}</Hinweis>}
      </section>

      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <button className="knopf-haupt" disabled={!geaendert || Boolean(vorschau.fehler) || daten.laeuft} onClick={() => void speichern()}>
          <Symbol name="haken" className="size-4" /> {t("Speichern")}
        </button>
        {meldung && <span className={`text-sm ${meldung.art === "fehler" ? "text-fehler" : "text-gut"}`}>{meldung.text}</span>}
      </div>
    </div>
  );
}
