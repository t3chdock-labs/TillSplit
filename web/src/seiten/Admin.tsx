import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api";
import { Hinweis, Kopf, useDaten } from "../komponenten/Bausteine";
import { Symbol } from "../komponenten/Symbol";
import { useSitzung, type Rechte } from "../sitzung";
import { gebiet, sprache, t } from "../i18n";

type Mitgliedschaft = Rechte & { haushalt_id: number; haushalt: string };
type Benutzer = {
  id: number; email: string; name: string; ist_admin: boolean; aktiv: boolean; passwort_aendern: boolean;
  totp_aktiv: boolean; passkeys: number; gesperrt: boolean; letzte_anmeldung: string | null; mitgliedschaften: Mitgliedschaft[];
};
type Mitglied = Rechte & { benutzer_id: number; name: string; email: string };
type Haushalt = {
  id: number; name: string; ablage_pfad: string; actual_url: string | null; actual_sync_id: string | null;
  actual_passwort_gesetzt: boolean; actual_e2e_gesetzt: boolean; bons: number; mitglieder: Mitglied[];
};
type HaushaltDaten = { haushalte: Haushalt[]; bonVerzeichnis: string; ablageWurzeln: string[]; umgebungActual: boolean };

// Vorlagen für typische Rollen
const VORLAGEN: { name: string; rechte: Rechte }[] = [
  { name: t("Nur hochladen"), rechte: { bons_sehen: false, bons_bearbeiten: false, finanzen_sehen: false, verwalten: false } },
  { name: t("Leser"), rechte: { bons_sehen: true, bons_bearbeiten: false, finanzen_sehen: false, verwalten: false } },
  { name: t("Mitglied"), rechte: { bons_sehen: true, bons_bearbeiten: true, finanzen_sehen: false, verwalten: false } },
  { name: t("Mitglied mit Finanzen"), rechte: { bons_sehen: true, bons_bearbeiten: true, finanzen_sehen: true, verwalten: false } },
  { name: t("Verwalter"), rechte: { bons_sehen: true, bons_bearbeiten: true, finanzen_sehen: true, verwalten: true } },
];
const RECHTE: { k: keyof Rechte; text: string }[] = [
  { k: "bons_sehen", text: t("Alle Bons & Auswertung") },
  { k: "bons_bearbeiten", text: t("Bons prüfen & buchen") },
  { k: "finanzen_sehen", text: t("Finanzen") },
  { k: "verwalten", text: t("Haushalt verwalten") },
];
const EIGENE_RECHTE = t("Eigene Rechte");
const MITGLIED = VORLAGEN[2].name;
const vorlageVon = (r: Rechte) => VORLAGEN.find((v) => RECHTE.every(({ k }) => v.rechte[k] === r[k]))?.name ?? EIGENE_RECHTE;

/** Zufälliges Startpasswort (wird beim ersten Anmelden geändert) */
function startpasswort(): string {
  const z = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const zahlen = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(zahlen, (n) => z[n % z.length]).join("");
}

function useAktion(neuLaden: () => void) {
  const [meldung, setMeldung] = useState<{ text: string; art: "gut" | "fehler" } | null>(null);
  const ausfuehren = async (fn: () => Promise<unknown>, erfolg?: string) => {
    setMeldung(null);
    try {
      await fn();
      if (erfolg) setMeldung({ text: erfolg, art: "gut" });
      neuLaden();
    } catch (e) {
      setMeldung({ text: (e as Error).message, art: "fehler" });
    }
  };
  const anzeige = meldung && (
    <div className="mb-4">
      <Hinweis art={meldung.art}>{meldung.text}</Hinweis>
    </div>
  );
  return { ausfuehren, anzeige };
}

function BenutzerVerwaltung() {
  const { status } = useSitzung();
  const { daten, neuLaden } = useDaten<Benutzer[]>("/api/admin/benutzer");
  const { ausfuehren, anzeige } = useAktion(neuLaden);
  const [neu, setNeu] = useState({ name: "", email: "", passwort: startpasswort(), admin: false });

  return (
    <div className="space-y-4">
      {anzeige}
      <section className="karte space-y-3 p-5">
        <h2 className="font-semibold">{t("Neuer Benutzer")}</h2>
        <form
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            void ausfuehren(async () => {
              await api.post("/api/admin/benutzer", neu);
              setNeu({ name: "", email: "", passwort: startpasswort(), admin: false });
            }, t("Benutzer angelegt. Startpasswort: {passwort} – bitte weitergeben; es muss bei der ersten Anmeldung geändert werden.", { passwort: neu.passwort }));
          }}
        >
          <input className="eingabe" placeholder={t("Name")} value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} />
          <input className="eingabe" type="email" placeholder={t("E-Mail")} value={neu.email} onChange={(e) => setNeu({ ...neu, email: e.target.value })} />
          <input className="eingabe font-mono" placeholder={t("Startpasswort")} value={neu.passwort} onChange={(e) => setNeu({ ...neu, passwort: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={neu.admin} onChange={(e) => setNeu({ ...neu, admin: e.target.checked })} /> {t("Administrator")}
          </label>
          <button className="knopf-haupt" disabled={!neu.name || !neu.email || neu.passwort.length < 10}>
            <Symbol name="plus" className="size-4" /> {t("Anlegen")}
          </button>
        </form>
        <p className="text-xs text-text-3">{t("Danach unter „Haushalte“ dem passenden Haushalt mit den gewünschten Rechten zuordnen.")}</p>
      </section>

      <div className="karte divide-y divide-rand overflow-hidden">
        {daten?.map((b) => (
          <div key={b.id} className={`space-y-2 px-5 py-4 ${b.aktiv ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{b.name}</span>
              <span className="text-sm text-text-3">{b.email}</span>
              {b.ist_admin && <span className="rounded-full bg-akzent-hell px-2 py-0.5 text-[11px] text-akzent">{t("Admin")}</span>}
              {!b.aktiv && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-fehler">{t("deaktiviert")}</span>}
              {b.gesperrt && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-fehler">{t("gesperrt")}</span>}
              {b.passwort_aendern && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-warnung">{t("Startpasswort")}</span>}
              <span className="text-xs text-text-3">
                {b.totp_aktiv || b.passkeys ? `2FA: ${[b.totp_aktiv && t("App"), b.passkeys && t("{n} Passkey|{n} Passkeys", { n: b.passkeys })].filter(Boolean).join(", ")}` : t("ohne 2FA")}
                {b.letzte_anmeldung && ` · ${t("zuletzt {datum}", { datum: b.letzte_anmeldung })}`}
              </span>
            </div>
            <div className="text-xs text-text-2">
              {b.mitgliedschaften.length ? b.mitgliedschaften.map((m) => `${m.haushalt} (${vorlageVon(m)})`).join(" · ") : t("Keinem Haushalt zugeordnet")}
            </div>
            {b.id !== status.nutzer?.id && (
              <div className="flex flex-wrap gap-1.5">
                <button className="chip text-xs" onClick={() => void ausfuehren(() => api.put(`/api/admin/benutzer/${b.id}`, { admin: !b.ist_admin }), t("Gespeichert"))}>
                  {b.ist_admin ? t("Admin-Rechte entziehen") : t("Zum Admin machen")}
                </button>
                <button className="chip text-xs" onClick={() => void ausfuehren(() => api.put(`/api/admin/benutzer/${b.id}`, { aktiv: !b.aktiv }), t("Gespeichert"))}>
                  {b.aktiv ? t("Deaktivieren") : t("Aktivieren")}
                </button>
                <button
                  className="chip text-xs"
                  onClick={() => {
                    const pw = startpasswort();
                    if (window.confirm(t("Passwort von {name} zurücksetzen? Neues Startpasswort: {passwort}", { name: b.name, passwort: pw }))) {
                      void ausfuehren(() => api.put(`/api/admin/benutzer/${b.id}`, { passwort: pw }), t("Neues Startpasswort für {name}: {passwort}", { name: b.name, passwort: pw }));
                    }
                  }}
                >
                  {t("Passwort zurücksetzen")}
                </button>
                {(b.totp_aktiv || b.passkeys > 0) && (
                  <button
                    className="chip text-xs"
                    onClick={() => window.confirm(t("Zwei-Faktor-Anmeldung von {name} entfernen (z. B. Handy verloren)?", { name: b.name })) && void ausfuehren(() => api.put(`/api/admin/benutzer/${b.id}`, { zweiFaktorZuruecksetzen: true }), t("Zwei-Faktor entfernt"))}
                  >
                    {t("2FA zurücksetzen")}
                  </button>
                )}
                {b.gesperrt && (
                  <button className="chip text-xs" onClick={() => void ausfuehren(() => api.put(`/api/admin/benutzer/${b.id}`, { entsperren: true }), t("Entsperrt"))}>
                    {t("Entsperren")}
                  </button>
                )}
                <button
                  className="chip text-xs text-fehler"
                  onClick={() => window.confirm(t("{name} endgültig löschen? Hochgeladene Bons bleiben erhalten.", { name: b.name })) && void ausfuehren(() => api.delete(`/api/admin/benutzer/${b.id}`), t("Gelöscht"))}
                >
                  {t("Löschen")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HaushaltKarte({ h, benutzer, info, ausfuehren }: { h: Haushalt; benutzer: Benutzer[]; info: HaushaltDaten; ausfuehren: (fn: () => Promise<unknown>, erfolg?: string) => Promise<void> }) {
  const [f, setF] = useState({ name: h.name, ablage_pfad: h.ablage_pfad, actual_url: h.actual_url ?? "", actual_sync_id: h.actual_sync_id ?? "", actual_passwort: "", actual_e2e: "" });
  const [neuesMitglied, setNeuesMitglied] = useState({ benutzer: "", vorlage: MITGLIED });
  const frei = benutzer.filter((b) => !h.mitglieder.some((m) => m.benutzer_id === b.id));
  const geaendert =
    f.name !== h.name || f.ablage_pfad !== h.ablage_pfad || f.actual_url !== (h.actual_url ?? "") || f.actual_sync_id !== (h.actual_sync_id ?? "") || f.actual_passwort || f.actual_e2e;

  const speichern = () =>
    ausfuehren(async () => {
      const daten: Record<string, string> = { name: f.name, ablage_pfad: f.ablage_pfad, actual_url: f.actual_url, actual_sync_id: f.actual_sync_id };
      if (f.actual_passwort) daten.actual_passwort = f.actual_passwort;
      if (f.actual_e2e) daten.actual_e2e = f.actual_e2e;
      await api.put(`/api/admin/haushalte/${h.id}`, daten);
      setF({ ...f, actual_passwort: "", actual_e2e: "" });
    }, t("{name} gespeichert", { name: f.name }));

  return (
    <section className="karte space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Symbol name="haus" className="size-4" /> {h.name}
        </h2>
        <span className="text-xs text-text-3">{t("{n} Bon|{n} Bons", { n: h.bons })}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs text-text-2">
          {t("Name")}
          <input className="eingabe mt-1" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="text-xs text-text-2">
          {t("Bon-Ablage")}
          <input className="eingabe mt-1 font-mono text-[13px]" placeholder={t("(RECEIPT_DIR selbst)")} value={f.ablage_pfad} onChange={(e) => setF({ ...f, ablage_pfad: e.target.value })} />
          <span className="mt-1 block text-[11px] text-text-3">
            {info.ablageWurzeln.length > 0
              ? t("Unterordner von {verzeichnis} oder absoluter Pfad in {wurzeln}. Bereits abgelegte Bons werden nicht verschoben.", { verzeichnis: info.bonVerzeichnis, wurzeln: info.ablageWurzeln.join(", ") })
              : t("Unterordner von {verzeichnis}. Bereits abgelegte Bons werden nicht verschoben.", { verzeichnis: info.bonVerzeichnis })}
          </span>
        </label>
        <label className="text-xs text-text-2">
          {t("Actual-Server")}
          <input className="eingabe mt-1" placeholder={h.id === 1 && info.umgebungActual ? t("aus der Konfiguration (ACTUAL_SERVER_URL)") : "https://actual.example.com"} value={f.actual_url} onChange={(e) => setF({ ...f, actual_url: e.target.value })} />
        </label>
        <label className="text-xs text-text-2">
          {t("Sync-ID des Budgets")}
          <input className="eingabe mt-1 font-mono text-[13px]" value={f.actual_sync_id} onChange={(e) => setF({ ...f, actual_sync_id: e.target.value })} />
        </label>
        <label className="text-xs text-text-2">
          {t("Actual-Passwort")}
          <input
            className="eingabe mt-1"
            type="password"
            autoComplete="off"
            placeholder={h.actual_passwort_gesetzt ? t("gespeichert – leer lassen zum Beibehalten") : t("nicht gesetzt")}
            value={f.actual_passwort}
            onChange={(e) => setF({ ...f, actual_passwort: e.target.value })}
          />
        </label>
        <label className="text-xs text-text-2">
          {t("Passwort der Ende-zu-Ende-Verschlüsselung (falls genutzt)")}
          <input
            className="eingabe mt-1"
            type="password"
            autoComplete="off"
            placeholder={h.actual_e2e_gesetzt ? t("gespeichert") : t("nicht gesetzt")}
            value={f.actual_e2e}
            onChange={(e) => setF({ ...f, actual_e2e: e.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="knopf-haupt" disabled={!geaendert} onClick={() => void speichern()}>
          {t("Speichern")}
        </button>
        {h.bons === 0 && (
          <button className="knopf-leise text-fehler" onClick={() => window.confirm(t("Haushalt „{name}“ löschen?", { name: h.name })) && void ausfuehren(() => api.delete(`/api/admin/haushalte/${h.id}`), t("Haushalt gelöscht"))}>
            {t("Haushalt löschen")}
          </button>
        )}
      </div>

      <div className="space-y-2 border-t border-rand pt-4">
        <h3 className="text-sm font-medium">{t("Mitglieder & Rechte")}</h3>
        <p className="text-xs text-text-3">{t("Bons hochladen darf jedes Mitglied. „Nur hochladen“ eignet sich z. B. für Kinder: Sie sehen nur ihre eigenen Bons, keine Auswertung und keine Finanzen.")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-text-3">
                <th className="py-1.5 font-medium">{t("Mitglied")}</th>
                <th className="font-medium">{t("Vorlage")}</th>
                {RECHTE.map((r) => (
                  <th key={r.k} className="text-center font-medium">{r.text}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-rand">
              {h.mitglieder.map((m) => (
                <tr key={m.benutzer_id}>
                  <td className="py-2">
                    <div className="font-medium">{m.name}</div>
                    <div className="text-xs text-text-3">{m.email}</div>
                  </td>
                  <td>
                    <select
                      className="eingabe w-auto py-1 text-[13px]"
                      value={vorlageVon(m)}
                      onChange={(e) => {
                        const v = VORLAGEN.find((x) => x.name === e.target.value);
                        if (v) void ausfuehren(() => api.put(`/api/admin/haushalte/${h.id}/mitglieder/${m.benutzer_id}`, v.rechte));
                      }}
                    >
                      {VORLAGEN.map((v) => (
                        <option key={v.name}>{v.name}</option>
                      ))}
                      {vorlageVon(m) === EIGENE_RECHTE && <option>{EIGENE_RECHTE}</option>}
                    </select>
                  </td>
                  {RECHTE.map((r) => (
                    <td key={r.k} className="text-center">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={m[r.k]}
                        onChange={(e) => void ausfuehren(() => api.put(`/api/admin/haushalte/${h.id}/mitglieder/${m.benutzer_id}`, { ...pickRechte(m), [r.k]: e.target.checked }))}
                      />
                    </td>
                  ))}
                  <td className="text-right">
                    <button
                      className="knopf-leise px-2 text-text-3 hover:text-fehler"
                      aria-label={t("Aus dem Haushalt entfernen")}
                      onClick={() => window.confirm(t("{name} aus „{haushalt}“ entfernen?", { name: m.name, haushalt: h.name })) && void ausfuehren(() => api.delete(`/api/admin/haushalte/${h.id}/mitglieder/${m.benutzer_id}`))}
                    >
                      <Symbol name="muell" className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {frei.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <select className="eingabe w-56" value={neuesMitglied.benutzer} onChange={(e) => setNeuesMitglied({ ...neuesMitglied, benutzer: e.target.value })}>
              <option value="">{t("Benutzer hinzufügen …")}</option>
              {frei.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.email})
                </option>
              ))}
            </select>
            <select className="eingabe w-52" value={neuesMitglied.vorlage} onChange={(e) => setNeuesMitglied({ ...neuesMitglied, vorlage: e.target.value })}>
              {VORLAGEN.map((v) => (
                <option key={v.name}>{v.name}</option>
              ))}
            </select>
            <button
              className="knopf-zweit"
              disabled={!neuesMitglied.benutzer}
              onClick={() => {
                const v = VORLAGEN.find((x) => x.name === neuesMitglied.vorlage)!;
                void ausfuehren(() => api.put(`/api/admin/haushalte/${h.id}/mitglieder/${neuesMitglied.benutzer}`, v.rechte), t("Mitglied hinzugefügt")).then(() =>
                  setNeuesMitglied({ benutzer: "", vorlage: MITGLIED }),
                );
              }}
            >
              {t("Hinzufügen")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

const pickRechte = (r: Rechte): Rechte => ({ bons_sehen: r.bons_sehen, bons_bearbeiten: r.bons_bearbeiten, finanzen_sehen: r.finanzen_sehen, verwalten: r.verwalten });

function HaushaltVerwaltung() {
  const { daten, neuLaden } = useDaten<HaushaltDaten>("/api/admin/haushalte");
  const { daten: benutzer } = useDaten<Benutzer[]>("/api/admin/benutzer");
  const { ausfuehren, anzeige } = useAktion(neuLaden);
  const [neu, setNeu] = useState({ name: "", ablage_pfad: "" });
  if (!daten || !benutzer) return null;
  return (
    <div className="space-y-4">
      {anzeige}
      {daten.haushalte.map((h) => (
        <HaushaltKarte key={`${h.id}-${h.name}-${h.mitglieder.length}`} h={h} benutzer={benutzer} info={daten} ausfuehren={ausfuehren} />
      ))}
      <section className="karte space-y-3 p-5">
        <h2 className="font-semibold">{t("Neuer Haushalt")}</h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ausfuehren(() => api.post("/api/admin/haushalte", { ...neu, sprache: sprache() }), t("Haushalt „{name}“ angelegt – mit den Standard-Warengruppen", { name: neu.name })).then(() => setNeu({ name: "", ablage_pfad: "" }));
          }}
        >
          <input className="eingabe w-56" placeholder={t("Name, z. B. Familie Muster")} value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} />
          <input className="eingabe w-64 font-mono text-[13px]" placeholder={t("Ablage-Ordner (optional)")} value={neu.ablage_pfad} onChange={(e) => setNeu({ ...neu, ablage_pfad: e.target.value })} />
          <button className="knopf-haupt" disabled={!neu.name}>
            <Symbol name="plus" className="size-4" /> {t("Anlegen")}
          </button>
        </form>
      </section>
    </div>
  );
}

type Eintrag = { id: number; am: string; aktion: string; details: Record<string, unknown> | null; ip: string | null; benutzer: string | null; email: string | null; haushalt: string | null };

const aktionText: Record<string, string> = {
  ersteinrichtung: t("Ersteinrichtung"),
  anmeldung: t("Anmeldung"),
  anmeldung_fehlgeschlagen: t("Anmeldung fehlgeschlagen"),
  passwort_geaendert: t("Passwort geändert"),
  totp_eingerichtet: t("Authenticator-App eingerichtet"),
  totp_entfernt: t("Authenticator-App entfernt"),
  wiederherstellungscode_benutzt: t("Wiederherstellungscode benutzt"),
  wiederherstellungscodes_neu: t("Neue Wiederherstellungscodes"),
  passkey_angelegt: t("Passkey angelegt"),
  passkey_entfernt: t("Passkey entfernt"),
  benutzer_angelegt: t("Benutzer angelegt"),
  benutzer_geaendert: t("Benutzer geändert"),
  benutzer_geloescht: t("Benutzer gelöscht"),
  haushalt_angelegt: t("Haushalt angelegt"),
  haushalt_geaendert: t("Haushalt geändert"),
  haushalt_geloescht: t("Haushalt gelöscht"),
  rechte_geaendert: t("Rechte geändert"),
  ablage_geaendert: t("Ablage geändert"),
  backup_gestartet: t("Backup gestartet"),
  backup_heruntergeladen: t("Backup heruntergeladen"),
  backup_geloescht: t("Backup gelöscht"),
  backup_geaendert: t("Backup-Zeitplan geändert"),
  mitglied_entfernt: t("Mitglied entfernt"),
};

function Protokoll() {
  const [seite, setSeite] = useState(1);
  const { daten } = useDaten<Eintrag[]>(`/api/admin/protokoll?seite=${seite}`);
  return (
    <div className="space-y-3">
      <div className="karte overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-rand text-left text-xs text-text-3">
              <th className="px-4 py-2 font-medium">{t("Zeit")}</th>
              <th className="font-medium">{t("Person")}</th>
              <th className="font-medium">{t("Ereignis")}</th>
              <th className="font-medium">{t("Details")}</th>
              <th className="pr-4 font-medium">{t("IP")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rand">
            {daten?.map((e) => (
              <tr key={e.id} className={e.aktion.includes("fehlgeschlagen") ? "text-fehler" : ""}>
                <td className="whitespace-nowrap px-4 py-2 text-xs">{e.am}</td>
                <td>{e.benutzer ?? "–"}</td>
                <td>{aktionText[e.aktion] ?? e.aktion}</td>
                <td className="max-w-xs truncate text-xs text-text-3">{e.details && Object.keys(e.details).length ? JSON.stringify(e.details) : ""}</td>
                <td className="pr-4 font-mono text-xs">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button className="knopf-zweit" disabled={seite === 1} onClick={() => setSeite(seite - 1)}>
          {t("Neuere")}
        </button>
        <button className="knopf-zweit" disabled={(daten?.length ?? 0) < 100} onClick={() => setSeite(seite + 1)}>
          {t("Ältere")}
        </button>
      </div>
    </div>
  );
}

type BackupDaten = {
  einstellungen: { verzeichnis: string; stunden: number; behalten: number; passwortGesetzt: boolean; mitBons: boolean };
  status: { laeuft: boolean; letzterFehler: string | null };
  liste: { name: string; groesse: number; erstellt: string }[];
};

const groesse = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);

function Backups() {
  const { daten, neuLaden } = useDaten<BackupDaten>("/api/admin/backups");
  const { ausfuehren, anzeige } = useAktion(neuLaden);
  // während ein Backup läuft, regelmäßig nachsehen
  useEffect(() => {
    if (!daten?.status.laeuft) return;
    const zeit = setInterval(neuLaden, 3000);
    return () => clearInterval(zeit);
  }, [daten?.status.laeuft, neuLaden]);
  if (!daten) return null;
  const e = daten.einstellungen;
  return (
    <div className="space-y-4">
      {anzeige}
      {!e.passwortGesetzt && (
        <Hinweis art="warnung">
          <b>BACKUP_PASSWORD</b> {t("ist nicht gesetzt – ohne Passwort erstellt TillSplit keine Backups. Das Passwort verschlüsselt das Backup; ohne es lässt sich ein Backup nicht wiederherstellen.")}
        </Hinweis>
      )}
      {daten.status.letzterFehler && <Hinweis art="fehler">{t("Letztes Backup fehlgeschlagen: {fehler}", { fehler: daten.status.letzterFehler })}</Hinweis>}
      <section className="karte space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t("Backups")}</h2>
            <p className="mt-1 text-sm text-text-2">
              {e.mitBons
                ? t("Datenbank, alle Bon-Ablagen und der Schlüssel für gespeicherte Zugangsdaten – verschlüsselt mit BACKUP_PASSWORD.")
                : t("Datenbank (ohne Bon-Dateien) und der Schlüssel für gespeicherte Zugangsdaten – verschlüsselt mit BACKUP_PASSWORD.")}{" "}
              {e.stunden
                ? t("Automatisch alle {stunden} Stunden, die letzten {behalten} werden behalten.", { stunden: e.stunden, behalten: e.behalten })
                : t("Nur von Hand, die letzten {behalten} werden behalten.", { behalten: e.behalten })}{" "}
              {t("Ablage:")} <code>{e.verzeichnis}</code>
            </p>
          </div>
          <button className="knopf-haupt" disabled={!e.passwortGesetzt || daten.status.laeuft} onClick={() => void ausfuehren(() => api.post("/api/admin/backups"), t("Backup gestartet"))}>
            <Symbol name="aktualisieren" className={`size-4 ${daten.status.laeuft ? "animate-spin" : ""}`} /> {daten.status.laeuft ? t("Läuft …") : t("Jetzt sichern")}
          </button>
        </div>
        <div className="divide-y divide-rand rounded-xl border border-rand">
          {daten.liste.length === 0 && <p className="p-4 text-center text-sm text-text-3">{t("Noch keine Backups.")}</p>}
          {daten.liste.map((b) => (
            <div key={b.name} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{b.name}</span>
              <span className="text-xs text-text-3">{new Date(b.erstellt).toLocaleString(gebiet())}</span>
              <span className="w-20 text-right text-xs text-text-3">{groesse(b.groesse)}</span>
              <a className="knopf-leise text-xs" href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download>
                {t("Herunterladen")}
              </a>
              <button
                className="knopf-leise px-2 text-text-3 hover:text-fehler"
                aria-label={t("Backup löschen")}
                onClick={() => window.confirm(t("Backup {name} löschen?", { name: b.name })) && void ausfuehren(() => api.delete(`/api/admin/backups/${encodeURIComponent(b.name)}`), t("Backup gelöscht"))}
              >
                <Symbol name="muell" className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-3">{t("Wiederherstellen: siehe README, Abschnitt „Backup und Wiederherstellung“.")}</p>
      </section>
      <BackupPlan einstellungen={e} ausfuehren={ausfuehren} />
    </div>
  );
}

function BackupPlan({ einstellungen, ausfuehren }: { einstellungen: BackupDaten["einstellungen"]; ausfuehren: (aktion: () => Promise<unknown>, meldung: string) => Promise<void> }) {
  const [plan, setPlan] = useState({ stunden: einstellungen.stunden, behalten: einstellungen.behalten, mitBons: einstellungen.mitBons });
  useEffect(() => setPlan({ stunden: einstellungen.stunden, behalten: einstellungen.behalten, mitBons: einstellungen.mitBons }), [einstellungen.stunden, einstellungen.behalten, einstellungen.mitBons]);
  return (
    <section className="karte space-y-3 p-5">
      <h2 className="font-semibold">{t("Zeitplan")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-text-2">
          {t("Automatisch sichern")}
          <select className="eingabe mt-1" value={plan.stunden} onChange={(ev) => setPlan({ ...plan, stunden: Number(ev.target.value) })}>
            {[...new Set([0, 6, 12, 24, 48, 168, plan.stunden])]
              .sort((a, b) => a - b)
              .map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? t("Nur von Hand") : h === 24 ? t("Täglich") : h === 168 ? t("Wöchentlich") : t("Alle {stunden} Stunden", { stunden: h })}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-xs text-text-2">
          {t("Anzahl behalten")}
          <input
            type="number"
            min={1}
            max={365}
            className="eingabe mt-1"
            value={plan.behalten}
            onChange={(ev) => setPlan({ ...plan, behalten: Number(ev.target.value) })}
          />
        </label>
      </div>
      <label className="flex items-start gap-2 text-xs text-text-2">
        <input type="checkbox" className="mt-0.5" checked={plan.mitBons} onChange={(ev) => setPlan({ ...plan, mitBons: ev.target.checked })} />
        <span>{t("Bon-Dateien mitsichern (ohne Haken nur Datenbank und Schlüssel – deutlich kleiner, die Bilder müssen dann anders gesichert werden)")}</span>
      </label>
      <p className="text-[11px] text-text-3">
        {t("Ablageort und Backup-Passwort werden beim Start des Containers festgelegt (BACKUP_DIR, BACKUP_PASSWORD) und lassen sich hier bewusst nicht ändern.")}
      </p>
      <button className="knopf-haupt" onClick={() => void ausfuehren(() => api.put("/api/admin/backups/einstellungen", plan), t("Gespeichert"))}>
        {t("Speichern")}
      </button>
    </section>
  );
}

const reiter = [
  { schluessel: "benutzer", text: t("Benutzer") },
  { schluessel: "haushalte", text: t("Haushalte") },
  { schluessel: "backups", text: t("Backups") },
  { schluessel: "protokoll", text: t("Protokoll") },
] as const;

export function Admin() {
  const { status } = useSitzung();
  const [suche] = useSearchParams();
  const [aktiv, setAktiv] = useState<(typeof reiter)[number]["schluessel"]>(
    reiter.find((r) => r.schluessel === suche.get("reiter"))?.schluessel ?? "benutzer",
  );
  if (!status.nutzer?.admin) return <Hinweis art="fehler">{t("Nur für Administratoren.")}</Hinweis>;
  return (
    <>
      <Kopf titel={t("Admin-Bereich")} unter={t("Benutzer, Haushalte, Rechte und Protokoll")} />
      <div className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-rand">
        {reiter.map((r) => (
          <button
            key={r.schluessel}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${aktiv === r.schluessel ? "border-akzent text-akzent" : "border-transparent text-text-2 hover:text-text"}`}
            onClick={() => setAktiv(r.schluessel)}
          >
            {r.text}
          </button>
        ))}
      </div>
      {aktiv === "benutzer" && <BenutzerVerwaltung />}
      {aktiv === "haushalte" && <HaushaltVerwaltung />}
      {aktiv === "backups" && <Backups />}
      {aktiv === "protokoll" && <Protokoll />}
    </>
  );
}
