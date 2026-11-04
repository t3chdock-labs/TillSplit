import { api } from "../api";
import { SPRACHEN, sprache, spracheSetzen, t } from "../i18n";

/** Auswahl der Oberflächensprache; angemeldet wird sie auch am Benutzer gespeichert (gilt dann auf allen Geräten) */
export function SprachWahl({ angemeldet = false, className = "" }: { angemeldet?: boolean; className?: string }) {
  const wechseln = async (code: string) => {
    if (angemeldet) await api.put("/api/konto/sprache", { sprache: code }).catch(() => undefined);
    spracheSetzen(code);
  };
  return (
    <select aria-label={t("Sprache")} className={`eingabe w-auto py-1 text-xs ${className}`} value={sprache()} onChange={(e) => void wechseln(e.target.value)}>
      {SPRACHEN.map((s) => (
        <option key={s.code} value={s.code}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
