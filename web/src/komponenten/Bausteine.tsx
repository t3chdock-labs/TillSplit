import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import type { Konto } from "../api";
import { statusText } from "../format";

/** Daten laden mit Ladezustand, Fehler und Neu-Laden */
export function useDaten<T>(pfad: string | null) {
  const [daten, setDaten] = useState<T | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [zaehler, setZaehler] = useState(0);

  useEffect(() => {
    if (!pfad) return;
    let aktiv = true;
    setLaedt(true);
    api
      .get<T>(pfad)
      .then((d) => aktiv && (setDaten(d), setFehler(null)))
      .catch((e: Error) => aktiv && setFehler(e.message))
      .finally(() => aktiv && setLaedt(false));
    return () => {
      aktiv = false;
    };
  }, [pfad, zaehler]);

  const neuLaden = useCallback(() => setZaehler((z) => z + 1), []);
  return { daten, fehler, laedt, neuLaden, setDaten };
}

const statusFarben: Record<string, string> = {
  neu: "bg-slate-500/10 text-text-2",
  in_arbeit: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  erkannt: "bg-amber-500/15 text-warnung",
  geprueft: "bg-akzent-hell text-akzent",
  wartet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  gebucht: "bg-emerald-500/15 text-gut",
  fehler: "bg-red-500/15 text-fehler",
};

export function StatusMarke({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusFarben[status] ?? ""}`}>
      {status === "in_arbeit" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {statusText[status] ?? status}
    </span>
  );
}

/** <option>s für Actual-Konten, bei mehreren Budgets nach Budget gruppiert */
export function KontoOptionen({ konten }: { konten: Konto[] }) {
  const budgets = [...new Set(konten.map((k) => k.budget_name ?? ""))];
  if (budgets.length < 2) return <>{konten.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</>;
  return (
    <>
      {budgets.map((b) => (
        <optgroup key={b} label={b}>
          {konten
            .filter((k) => (k.budget_name ?? "") === b)
            .map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

export function Farbpunkt({ farbe, className = "size-2.5" }: { farbe: string; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${className}`} style={{ background: farbe }} />;
}

export function Kopf({ titel, unter, rechts }: { titel: string; unter?: ReactNode; rechts?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titel}</h1>
        {unter && <p className="mt-1 text-sm text-text-2">{unter}</p>}
      </div>
      {rechts}
    </div>
  );
}

export function Leer({ titel, text, aktion }: { titel: string; text?: string; aktion?: ReactNode }) {
  return (
    <div className="karte flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="text-base font-medium">{titel}</div>
      {text && <p className="max-w-sm text-sm text-text-2">{text}</p>}
      {aktion && <div className="mt-3">{aktion}</div>}
    </div>
  );
}

export function Hinweis({ art = "info", children }: { art?: "info" | "warnung" | "fehler" | "gut"; children: ReactNode }) {
  const stil = {
    info: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200",
    warnung: "border-amber-500/30 bg-amber-500/10 text-warnung",
    fehler: "border-red-500/30 bg-red-500/10 text-fehler",
    gut: "border-emerald-500/30 bg-emerald-500/10 text-gut",
  }[art];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${stil}`}>{children}</div>;
}
