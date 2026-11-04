import { useState } from "react";
import { Link } from "react-router";
import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { api } from "../api";
import { Hinweis, Kopf, useDaten } from "../komponenten/Bausteine";
import { BenachrichtigungEinstellungen } from "../komponenten/BenachrichtigungEinstellungen";
import { Fusszeile } from "../komponenten/Fusszeile";
import { SprachWahl } from "../komponenten/SprachWahl";
import { DarstellungWahl } from "../komponenten/DarstellungWahl";
import { Symbol } from "../komponenten/Symbol";
import { useSitzung } from "../sitzung";
import { t } from "../i18n";

type KontoDaten = {
  email: string;
  name: string;
  totp_aktiv: boolean;
  passkeys: { id: string; name: string; erstellt: string; zuletzt: string | null }[];
  sitzungen: { id: string; ip: string | null; geraet: string | null; erstellt: string; zuletzt: string; diese: boolean }[];
  offeneCodes: number;
  zweiFaktorPflicht: boolean;
};

/** Gerätename aus dem User-Agent grob ableiten */
function geraetName(ua: string | null): string {
  if (!ua) return t("Unbekanntes Gerät");
  const system = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : t("Gerät");
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox/.test(ua) ? "Firefox" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Browser";
  return t("{browser} auf {system}", { browser, system });
}

/** In die Zwischenablage kopieren – auch ohne HTTPS, wo navigator.clipboard fehlt */
async function kopieren(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // weiter mit dem Ersatzweg
  }
  const feld = document.createElement("textarea");
  feld.value = text;
  feld.setAttribute("readonly", "");
  feld.style.cssText = "position:fixed;opacity:0;top:0;left:0";
  document.body.appendChild(feld);
  feld.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  feld.remove();
  return ok;
}

function KopierKnopf({ text, beschriftung = t("Kopieren") }: { text: string; beschriftung?: string }) {
  const [zustand, setZustand] = useState<"" | "ok" | "fehler">("");
  return (
    <button
      type="button"
      className="knopf-zweit text-xs"
      onClick={() =>
        void kopieren(text).then((ok) => {
          setZustand(ok ? "ok" : "fehler");
          setTimeout(() => setZustand(""), 2000);
        })
      }
    >
      <Symbol name={zustand === "ok" ? "haken" : "kopieren"} className="size-3.5" />
      {zustand === "ok" ? t("Kopiert") : zustand === "fehler" ? t("Bitte von Hand markieren") : beschriftung}
    </button>
  );
}

/** Schlüssel zum Abtippen, falls der QR-Code nicht gescannt werden kann (z. B. auf demselben Handy) */
function SchluesselAnzeige({ geheimnis, uri, konto }: { geheimnis: string; uri: string; konto: string }) {
  const gruppiert = geheimnis.match(/.{1,4}/g)?.join(" ") ?? geheimnis;
  return (
    <div className="space-y-2 rounded-xl border border-rand bg-flaeche-2 p-3">
      <div className="text-xs font-medium text-text-2">{t("Ohne QR-Code: Schlüssel von Hand eingeben")}</div>
      <div className="select-all break-all font-mono text-base tracking-wide text-text">{gruppiert}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-text-3">
        <dt>{t("Konto")}</dt>
        <dd className="break-all">TillSplit ({konto})</dd>
        <dt>{t("Art")}</dt>
        <dd>{t("zeitbasiert (TOTP), 6 Ziffern, 30 Sekunden, SHA-1")}</dd>
      </dl>
      <div className="flex flex-wrap gap-2 pt-1">
        <KopierKnopf text={geheimnis} beschriftung={t("Schlüssel kopieren")} />
        {/* Auf dem Handy öffnet der Link direkt die Authenticator-App */}
        <a className="knopf-zweit text-xs" href={uri}>
          <Symbol name="link" className="size-3.5" /> {t("In Authenticator-App öffnen")}
        </a>
      </div>
    </div>
  );
}

function Codes({ codes, onFertig }: { codes: string[]; onFertig: () => void }) {
  const text = codes.join("\n");
  return (
    <div className="space-y-3 rounded-xl border border-warnung/40 bg-amber-500/10 p-4">
      <p className="text-sm font-medium">{t("Wiederherstellungscodes – jetzt sicher aufbewahren!")}</p>
      <p className="text-xs text-text-2">{t("Jeder Code funktioniert genau einmal, falls du keinen Zugriff auf deine Authenticator-App oder deinen Passkey hast. Sie werden nur jetzt angezeigt.")}</p>
      <div className="grid grid-cols-2 gap-1 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <KopierKnopf text={text} />
        <a className="knopf-zweit text-xs" href={`data:text/plain;charset=utf-8,${encodeURIComponent(t("TillSplit – Wiederherstellungscodes") + "\n\n" + text)}`} download={t("tillsplit-wiederherstellungscodes.txt")}>
          {t("Als Datei speichern")}
        </a>
        <button className="knopf-haupt text-xs" onClick={onFertig}>
          {t("Habe ich gesichert")}
        </button>
      </div>
    </div>
  );
}

export function Konto() {
  const { status, neuLaden: statusNeu, abmelden } = useSitzung();
  const { daten, fehler, neuLaden } = useDaten<KontoDaten>("/api/konto");
  const [meldung, setMeldung] = useState<{ text: string; art: "gut" | "fehler" } | null>(null);
  const [pw, setPw] = useState({ alt: "", neu: "", wiederholung: "" });
  const [totp, setTotp] = useState<{ qr: string; geheimnis: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [name, setName] = useState<string | null>(null);

  const ausfuehren = async (fn: () => Promise<unknown>, erfolg?: string) => {
    setMeldung(null);
    try {
      await fn();
      if (erfolg) setMeldung({ text: erfolg, art: "gut" });
      neuLaden();
      await statusNeu();
    } catch (e) {
      setMeldung({ text: (e as Error).message, art: "fehler" });
    }
  };

  if (fehler) return <Hinweis art="fehler">{fehler}</Hinweis>;
  if (!daten) return null;

  const passwortAendern = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.neu !== pw.wiederholung) return setMeldung({ text: t("Die neuen Passwörter stimmen nicht überein"), art: "fehler" });
    void ausfuehren(async () => {
      await api.put("/api/konto/passwort", { alt: pw.alt, neu: pw.neu });
      setPw({ alt: "", neu: "", wiederholung: "" });
    }, t("Passwort geändert – andere Geräte wurden abgemeldet."));
  };

  const passkeyAnlegen = () =>
    ausfuehren(async () => {
      const bezeichnung = window.prompt(t("Name für diesen Passkey (z. B. „Handy“ oder „Laptop“)"), geraetName(navigator.userAgent));
      if (bezeichnung === null) return;
      const optionen = await api.post<PublicKeyCredentialCreationOptionsJSON>("/api/konto/passkey/optionen");
      let antwort;
      try {
        antwort = await startRegistration({ optionsJSON: optionen });
      } catch (e) {
        const n = (e as Error).name;
        throw new Error(n === "NotAllowedError" ? t("Abgebrochen") : n === "InvalidStateError" ? t("Dieses Gerät ist schon als Passkey eingetragen") : (e as Error).message);
      }
      await api.post("/api/konto/passkey", { antwort, name: bezeichnung });
    }, t("Passkey angelegt – du kannst dich jetzt damit anmelden."));

  const passwortAbfragen = (zweck: string) => window.prompt(`${zweck}\n\n${t("Bitte zur Bestätigung dein Passwort eingeben:")}`) ?? null;

  return (
    <>
      <Kopf
        titel={t("Mein Konto")}
        unter={daten.email}
        rechts={
          <div className="flex gap-2">
            {status.nutzer?.admin && (
              <Link to="/admin" className="knopf-zweit">
                <Symbol name="schild" className="size-4" /> {t("Admin-Bereich")}
              </Link>
            )}
            <button className="knopf-zweit" onClick={() => void abmelden()}>
              <Symbol name="abmelden" className="size-4" /> {t("Abmelden")}
            </button>
          </div>
        }
      />
      {status.zweiFaktorEinrichten && (
        <div className="mb-4">
          <Hinweis art="warnung">{t("Bitte richte eine Zwei-Faktor-Anmeldung ein (Authenticator-App oder Passkey) – erst danach geht es weiter.")}</Hinweis>
        </div>
      )}
      {meldung && (
        <div className="mb-4">
          <Hinweis art={meldung.art}>{meldung.text}</Hinweis>
        </div>
      )}
      {codes && (
        <div className="mb-4">
          <Codes codes={codes} onFertig={() => setCodes(null)} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="karte space-y-3 p-5">
          <h2 className="font-semibold">{t("Profil")}</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name) void ausfuehren(() => api.put("/api/konto/name", { name }), t("Name gespeichert"));
            }}
          >
            <input className="eingabe" value={name ?? daten.name} onChange={(e) => setName(e.target.value)} />
            <button className="knopf-zweit" disabled={!name || name === daten.name}>
              {t("Speichern")}
            </button>
          </form>

          <h2 className="pt-2 font-semibold">{t("Sprache")}</h2>
          <div className="flex items-center gap-3">
            <SprachWahl angemeldet className="py-2 text-sm" />
            <span className="text-xs text-text-3">{t("Gilt für dieses Konto auf allen Geräten.")}</span>
          </div>

          <h2 className="pt-2 font-semibold">{t("Passwort ändern")}</h2>
          <form onSubmit={passwortAendern} className="space-y-2">
            <input className="eingabe" type="password" placeholder={t("Bisheriges Passwort")} autoComplete="current-password" value={pw.alt} onChange={(e) => setPw({ ...pw, alt: e.target.value })} />
            <input className="eingabe" type="password" placeholder={t("Neues Passwort (mind. 10 Zeichen)")} autoComplete="new-password" value={pw.neu} onChange={(e) => setPw({ ...pw, neu: e.target.value })} />
            <input className="eingabe" type="password" placeholder={t("Neues Passwort wiederholen")} autoComplete="new-password" value={pw.wiederholung} onChange={(e) => setPw({ ...pw, wiederholung: e.target.value })} />
            <button className="knopf-zweit" disabled={!pw.alt || !pw.neu}>
              {t("Passwort ändern")}
            </button>
          </form>
        </section>

        <section className="karte space-y-4 p-5">
          <div>
            <h2 className="font-semibold">{t("Zwei-Faktor-Anmeldung")}</h2>
            <p className="mt-1 text-sm text-text-2">{t("Schützt dein Konto, selbst wenn jemand dein Passwort kennt.")}</p>
          </div>

          {/* Passkeys */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t("Passkeys")}</h3>
              {browserSupportsWebAuthn() && (
                <button className="knopf-zweit text-xs" onClick={() => void passkeyAnlegen()}>
                  <Symbol name="plus" className="size-3.5" /> {t("Passkey hinzufügen")}
                </button>
              )}
            </div>
            <p className="text-xs text-text-3">{t("Anmeldung per Fingerabdruck, Gesichtserkennung oder Geräte-PIN – ganz ohne Passwort. Funktioniert nur über HTTPS.")}</p>
            {daten.passkeys.length === 0 && <p className="text-sm text-text-3">{t("Noch kein Passkey.")}</p>}
            {daten.passkeys.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-rand px-3 py-2 text-sm">
                <Symbol name="schluessel" className="size-4 text-text-3" />
                <span className="flex-1">{p.name}</span>
                <span className="text-xs text-text-3">{p.zuletzt ? t("zuletzt {datum}", { datum: p.zuletzt }) : t("seit {datum}", { datum: p.erstellt })}</span>
                <button
                  className="knopf-leise px-2 text-text-3 hover:text-fehler"
                  aria-label={t("Passkey entfernen")}
                  onClick={() => window.confirm(t("Passkey „{name}“ entfernen?", { name: p.name })) && void ausfuehren(() => api.delete(`/api/konto/passkey/${encodeURIComponent(p.id)}`), t("Passkey entfernt"))}
                >
                  <Symbol name="muell" className="size-4" />
                </button>
              </div>
            ))}
          </div>

          {/* TOTP */}
          <div className="space-y-2 border-t border-rand pt-3">
            <h3 className="text-sm font-medium">{t("Authenticator-App (TOTP)")}</h3>
            {daten.totp_aktiv ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gut">{t("✓ eingerichtet")}</span>
                <span className="text-xs text-text-3">· {t("{n} Wiederherstellungscode übrig|{n} Wiederherstellungscodes übrig", { n: daten.offeneCodes })}</span>
                <button
                  className="knopf-leise text-xs"
                  onClick={() => {
                    const passwort = passwortAbfragen(t("Neue Wiederherstellungscodes erzeugen (die alten werden ungültig)."));
                    if (passwort) void ausfuehren(async () => setCodes((await api.post<{ codes: string[] }>("/api/konto/wiederherstellungscodes", { passwort })).codes));
                  }}
                >
                  {t("Neue Codes")}
                </button>
                <button
                  className="knopf-leise text-xs text-fehler"
                  onClick={() => {
                    const passwort = passwortAbfragen(t("Authenticator-App entfernen."));
                    if (passwort) void ausfuehren(() => api.post("/api/konto/totp/aus", { passwort }), t("Authenticator-App entfernt"));
                  }}
                >
                  {t("Entfernen")}
                </button>
              </div>
            ) : totp ? (
              <div className="space-y-3">
                <p className="text-sm text-text-2">{t("QR-Code mit der Authenticator-App scannen (z. B. Aegis, 2FAS, Google Authenticator) und den angezeigten Code eingeben.")}</p>
                <img src={totp.qr} alt={t("QR-Code für die Authenticator-App")} className="size-44 rounded-lg bg-white p-1" />
                <SchluesselAnzeige geheimnis={totp.geheimnis} uri={totp.uri} konto={daten.email} />
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ausfuehren(async () => {
                      setCodes((await api.post<{ codes: string[] }>("/api/konto/totp/bestaetigen", { code: totpCode })).codes);
                      setTotp(null);
                      setTotpCode("");
                    }, t("Authenticator-App eingerichtet"));
                  }}
                >
                  <input className="eingabe w-36 text-center font-mono tracking-widest" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
                  <button className="knopf-haupt" disabled={totpCode.trim().length < 6}>
                    {t("Bestätigen")}
                  </button>
                </form>
              </div>
            ) : (
              <button className="knopf-zweit text-xs" onClick={() => void ausfuehren(async () => setTotp(await api.post("/api/konto/totp/start")))}>
                {t("Authenticator-App einrichten")}
              </button>
            )}
          </div>
        </section>

        {!status.zweiFaktorEinrichten && !status.passwortAendern && <BenachrichtigungEinstellungen />}
        {!status.zweiFaktorEinrichten && !status.passwortAendern && <DarstellungWahl />}

        <section className="karte space-y-3 p-5 lg:col-span-2">
          <h2 className="font-semibold">{t("Angemeldete Geräte")}</h2>
          <div className="divide-y divide-rand rounded-xl border border-rand">
            {daten.sitzungen.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {geraetName(s.geraet)} {s.diese && <span className="ml-1 rounded-full bg-akzent-hell px-2 py-0.5 text-[11px] text-akzent">{t("dieses Gerät")}</span>}
                  </div>
                  <div className="text-xs text-text-3">
                    {t("{ip} · angemeldet {erstellt} · zuletzt {zuletzt}", { ip: s.ip ?? "–", erstellt: s.erstellt, zuletzt: s.zuletzt })}
                  </div>
                </div>
                {!s.diese && (
                  <button className="knopf-leise text-xs" onClick={() => void ausfuehren(() => api.delete(`/api/konto/sitzungen/${s.id}`), t("Gerät abgemeldet"))}>
                    {t("Abmelden")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      <Fusszeile className="mt-6 md:hidden" />
    </>
  );
}
