import { useEffect, useState } from "react";
import { t } from "../i18n";

type Info = { version: string; lizenz: string; quellcode: string | null; spenden: string | null };

let zwischenspeicher: Promise<Info | null> | null = null;
const infoLaden = () => (zwischenspeicher ??= fetch("/api/info").then((r) => (r.ok ? r.json() : null)).catch(() => null));

/** Version, Lizenz, Link zum Quellcode (AGPL) und optional „Unterstützen“ */
export function Fusszeile({ className = "" }: { className?: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    void infoLaden().then(setInfo);
  }, []);
  return (
    <div className={`space-y-1 text-xs text-text-3 ${className}`}>
      <p>
        {t("Version")} {info?.version ?? "0.1.00"} · {info?.lizenz ?? "AGPL-3.0"}
        {info?.quellcode && (
          <>
            {" · "}
            <a className="underline-offset-2 hover:text-text hover:underline" href={info.quellcode} target="_blank" rel="noopener noreferrer">
              {t("Quellcode")}
            </a>
          </>
        )}
      </p>
      {info?.spenden && (
        <a
          className="inline-flex items-center gap-1.5 rounded-lg border border-rand px-2 py-1 text-text-2 hover:bg-flaeche-2 hover:text-text"
          href={info.spenden}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("☕ TillSplit unterstützen")}
        </a>
      )}
    </div>
  );
}
