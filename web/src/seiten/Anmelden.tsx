import { useState, type ReactNode } from "react";
import { browserSupportsWebAuthn, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api } from "../api";
import { Fusszeile } from "../komponenten/Fusszeile";
import { SprachWahl } from "../komponenten/SprachWahl";
import { Symbol } from "../komponenten/Symbol";
import type { Status } from "../sitzung";
import { sprache, t } from "../i18n";

function Rahmen({ unter, children }: { unter: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="karte w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-10" />
          <div className="flex-1">
            <div className="text-lg font-semibold">TillSplit</div>
            <div className="text-sm text-text-2">{unter}</div>
          </div>
          <SprachWahl className="self-start" />
        </div>
        {children}
        <Fusszeile className="mt-6 border-t border-rand pt-4 text-center" />
      </div>
    </div>
  );
}

const passkeyMoeglich = () => typeof window !== "undefined" && browserSupportsWebAuthn();

/** Fehlermeldungen der Passkey-Abfrage verständlich machen */
function passkeyFehler(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === "NotAllowedError" || name === "AbortError") return t("Passkey-Anmeldung abgebrochen");
  if (name === "SecurityError") return t("Passkeys funktionieren nur über HTTPS mit der eingerichteten Adresse");
  return (e as Error)?.message ?? t("Passkey-Anmeldung fehlgeschlagen");
}

/** Ersteinrichtung: erster Administrator mit dem Code aus dem Server-Protokoll */
export function Einrichten({ onFertig }: { onFertig: () => void }) {
  const [f, setF] = useState({ code: "", name: "", email: "", passwort: "", wiederholung: "" });
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  const absenden = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.passwort !== f.wiederholung) return setFehler(t("Die Passwörter stimmen nicht überein"));
    setLaedt(true);
    setFehler(null);
    try {
      await api.post("/api/auth/einrichten", { code: f.code, name: f.name, email: f.email, passwort: f.passwort, sprache: sprache() });
      onFertig();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaedt(false);
    }
  };
  const feld = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <Rahmen unter={t("Ersteinrichtung")}>
      <form onSubmit={absenden} className="space-y-3">
        <p className="text-sm text-text-2">
          {t("Lege den ersten Administrator an. Den Einrichtungscode findest du im Protokoll des Servers")} (<code>docker logs</code>).
        </p>
        <input className="eingabe font-mono" placeholder={t("Einrichtungscode")} autoFocus {...feld("code")} />
        <input className="eingabe" placeholder={t("Dein Name")} autoComplete="name" {...feld("name")} />
        <input className="eingabe" type="email" placeholder={t("E-Mail")} autoComplete="email" {...feld("email")} />
        <input className="eingabe" type="password" placeholder={t("Passwort (mind. 10 Zeichen)")} autoComplete="new-password" {...feld("passwort")} />
        <input className="eingabe" type="password" placeholder={t("Passwort wiederholen")} autoComplete="new-password" {...feld("wiederholung")} />
        {fehler && <p className="text-sm text-fehler">{fehler}</p>}
        <button className="knopf-haupt w-full" disabled={laedt || !f.code || !f.email || !f.passwort}>
          {t("Administrator anlegen")}
        </button>
      </form>
    </Rahmen>
  );
}

export function Anmelden({ status, onAngemeldet }: { status: Status; onAngemeldet: () => void }) {
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [code, setCode] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);
  // „Angemeldet bleiben“: Wahl des letzten Mals merken (nur die Wahl, keine Zugangsdaten)
  const [merken, setMerken] = useState(() => {
    try {
      return localStorage.getItem("tillsplit:merken") !== "0";
    } catch {
      return true;
    }
  });
  const merkenSetzen = (wert: boolean) => {
    setMerken(wert);
    try {
      localStorage.setItem("tillsplit:merken", wert ? "1" : "0");
    } catch {
      // ohne Speicher gilt die Wahl nur jetzt
    }
  };
  const zweiter = status.zweiterFaktor;

  const ausfuehren = async (fn: () => Promise<void>) => {
    setLaedt(true);
    setFehler(null);
    try {
      await fn();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaedt(false);
    }
  };

  const mitPasswort = (e: React.FormEvent) => {
    e.preventDefault();
    void ausfuehren(async () => {
      await api.post("/api/auth/anmelden", { email, passwort, merken });
      setPasswort("");
      onAngemeldet();
    });
  };

  const mitPasskey = (zweiterFaktor: boolean) =>
    ausfuehren(async () => {
      const basis = zweiterFaktor ? "/api/auth/zweiter-faktor/passkey" : "/api/auth/passkey";
      const optionen = await api.post<PublicKeyCredentialRequestOptionsJSON>(`${basis}/optionen`);
      let antwort;
      try {
        antwort = await startAuthentication({ optionsJSON: optionen });
      } catch (e) {
        throw new Error(passkeyFehler(e));
      }
      await api.post(zweiterFaktor ? basis : `${basis}/anmelden${merken ? "" : "?merken=0"}`, antwort);
      onAngemeldet();
    });

  const mitCode = (e: React.FormEvent) => {
    e.preventDefault();
    void ausfuehren(async () => {
      await api.post("/api/auth/zweiter-faktor/totp", { code });
      onAngemeldet();
    });
  };

  if (zweiter) {
    return (
      <Rahmen unter={t("Zweiter Schritt")}>
        <div className="space-y-4">
          {zweiter.passkey && passkeyMoeglich() && (
            <button className="knopf-haupt w-full" onClick={() => void mitPasskey(true)} disabled={laedt}>
              <Symbol name="schluessel" className="size-4" /> {t("Mit Passkey bestätigen")}
            </button>
          )}
          {zweiter.totp && (
            <form onSubmit={mitCode} className="space-y-3">
              <label className="block text-sm text-text-2">
                {t("Code aus der Authenticator-App")}
                <input
                  className="eingabe mt-1 text-center font-mono text-lg tracking-[0.3em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <button className={zweiter.passkey ? "knopf-zweit w-full" : "knopf-haupt w-full"} disabled={laedt || code.trim().length < 6}>
                {t("Bestätigen")}
              </button>
              <p className="text-xs text-text-3">{t("Handy verloren? Gib stattdessen einen deiner Wiederherstellungscodes ein.")}</p>
            </form>
          )}
          {fehler && <p className="text-sm text-fehler">{fehler}</p>}
          <button className="knopf-leise w-full text-xs" onClick={() => void api.post("/api/auth/abmelden").then(onAngemeldet)}>
            {t("Abbrechen")}
          </button>
        </div>
      </Rahmen>
    );
  }

  return (
    <Rahmen unter={t("Bitte anmelden")}>
      <form onSubmit={mitPasswort} className="space-y-3">
        <input className="eingabe" type="email" autoFocus autoComplete="username webauthn" placeholder={t("E-Mail")} value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="eingabe" type="password" autoComplete="current-password" placeholder={t("Passwort")} value={passwort} onChange={(e) => setPasswort(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input type="checkbox" className="size-4 accent-[var(--color-akzent)]" checked={merken} onChange={(e) => merkenSetzen(e.target.checked)} />
          {t("Angemeldet bleiben (30 Tage)")}
        </label>
        {!merken && <p className="text-xs text-text-3">{t("Die Anmeldung endet, sobald du den Browser schließt – gut für fremde Geräte.")}</p>}
        {fehler && <p className="text-sm text-fehler">{fehler}</p>}
        <button className="knopf-haupt w-full" disabled={laedt || !email || !passwort}>
          {t("Anmelden")}
        </button>
      </form>
      {passkeyMoeglich() && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-text-3">
            <span className="h-px flex-1 bg-rand" /> {t("oder")} <span className="h-px flex-1 bg-rand" />
          </div>
          <button className="knopf-zweit w-full" onClick={() => void mitPasskey(false)} disabled={laedt}>
            <Symbol name="schluessel" className="size-4" /> {t("Mit Passkey anmelden")}
          </button>
        </>
      )}
    </Rahmen>
  );
}

/** Pflichtschritt: Startpasswort durch ein eigenes ersetzen */
export function PasswortAendern({ onFertig, onAbmelden }: { onFertig: () => void; onAbmelden: () => void }) {
  const [f, setF] = useState({ alt: "", neu: "", wiederholung: "" });
  const [fehler, setFehler] = useState<string | null>(null);
  const absenden = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.neu !== f.wiederholung) return setFehler(t("Die Passwörter stimmen nicht überein"));
    try {
      await api.put("/api/konto/passwort", { alt: f.alt, neu: f.neu });
      onFertig();
    } catch (err) {
      setFehler((err as Error).message);
    }
  };
  return (
    <Rahmen unter={t("Eigenes Passwort festlegen")}>
      <form onSubmit={absenden} className="space-y-3">
        <p className="text-sm text-text-2">{t("Du hast ein Startpasswort bekommen. Bitte lege jetzt ein eigenes fest.")}</p>
        <input className="eingabe" type="password" placeholder={t("Startpasswort")} autoComplete="current-password" value={f.alt} onChange={(e) => setF({ ...f, alt: e.target.value })} />
        <input className="eingabe" type="password" placeholder={t("Neues Passwort (mind. 10 Zeichen)")} autoComplete="new-password" value={f.neu} onChange={(e) => setF({ ...f, neu: e.target.value })} />
        <input className="eingabe" type="password" placeholder={t("Neues Passwort wiederholen")} autoComplete="new-password" value={f.wiederholung} onChange={(e) => setF({ ...f, wiederholung: e.target.value })} />
        {fehler && <p className="text-sm text-fehler">{fehler}</p>}
        <button className="knopf-haupt w-full" disabled={!f.alt || !f.neu}>
          {t("Passwort speichern")}
        </button>
        <button type="button" className="knopf-leise w-full text-xs" onClick={onAbmelden}>
          {t("Abmelden")}
        </button>
      </form>
    </Rahmen>
  );
}
