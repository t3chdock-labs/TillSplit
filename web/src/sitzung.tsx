import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { sprache, spracheSetzen } from "./i18n";
import { anwenden, gueltig } from "./darstellung";

export type Rechte = { bons_sehen: boolean; bons_bearbeiten: boolean; finanzen_sehen: boolean; verwalten: boolean };

export type Status = {
  angemeldet: boolean;
  einrichtung?: boolean;
  zweiterFaktor?: { totp: boolean; passkey: boolean };
  nutzer?: { id: number; email: string; name: string; admin: boolean; sprache?: string | null; darstellung?: unknown };
  haushaltId?: number | null;
  haushalte?: { id: number; name: string }[];
  rechte?: Rechte | null;
  passwortAendern?: boolean;
  zweiFaktor?: boolean;
  zweiFaktorEinrichten?: boolean;
};

type Kontext = {
  status: Status;
  neuLaden: () => Promise<void>;
  darf: (recht: keyof Rechte) => boolean;
  abmelden: () => Promise<void>;
  haushaltWechseln: (id: number) => Promise<void>;
};

const SitzungKontext = createContext<Kontext | null>(null);

export function useSitzung(): Kontext {
  const k = useContext(SitzungKontext);
  if (!k) throw new Error("useSitzung außerhalb von SitzungAnbieter");
  return k;
}

export function SitzungAnbieter({ children, platzhalter }: { children: (status: Status) => ReactNode; platzhalter?: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);

  const neuLaden = useCallback(async () => {
    try {
      const neu = await api.get<Status>("/api/auth/status");
      // Sprache des Benutzers gilt auf jedem Gerät (Wechsel lädt die Seite neu)
      if (neu.nutzer?.sprache && neu.nutzer.sprache !== sprache()) return spracheSetzen(neu.nutzer.sprache);
      // ebenso die Darstellung (Farben wirken sofort, ohne Neuladen)
      if (neu.nutzer?.darstellung) anwenden(gueltig(neu.nutzer.darstellung));
      setStatus(neu);
    } catch {
      setStatus({ angemeldet: false });
    }
  }, []);

  useEffect(() => {
    void neuLaden();
    const ereignis = () => void neuLaden();
    window.addEventListener("tillsplit:sitzung", ereignis);
    return () => window.removeEventListener("tillsplit:sitzung", ereignis);
  }, [neuLaden]);

  if (!status) return <>{platzhalter ?? null}</>;

  const wert: Kontext = {
    status,
    neuLaden,
    darf: (recht) => Boolean(status.rechte?.[recht]),
    abmelden: async () => {
      await api.post("/api/auth/abmelden").catch(() => {});
      await neuLaden();
    },
    haushaltWechseln: async (id) => {
      await api.post("/api/auth/haushalt", { haushaltId: id });
      // alle Seiten neu laden, damit keine Daten des alten Haushalts stehen bleiben
      window.location.assign("/");
    },
  };
  return <SitzungKontext.Provider value={wert}>{children(status)}</SitzungKontext.Provider>;
}
