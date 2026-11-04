import { useEffect, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { Hinweis, useDaten } from "./Bausteine";
import { Symbol } from "./Symbol";

type Art = "hochgeladen" | "erkannt" | "erinnerung";
type Kanal = "glocke" | "mail" | "telegram";
type Einstellung = {
  ereignisse: Record<Art, Record<Kanal, boolean>>;
  intervall: number;
  erinnerung: { tage: number; stunde: number };
};
type Daten = {
  einstellung: Einstellung;
  intervalle: number[];
  mail: { verfuegbar: boolean; adresse: string };
  telegram: { verfuegbar: boolean; verbunden: boolean; chats: { id: number; titel: string; gruppe: boolean }[] };
};

const ARTEN: { art: Art; titel: string; text: string }[] = [
  { art: "hochgeladen", titel: t("Neue Bons hochgeladen"), text: t("Wenn jemand anderes im Haushalt Bons hochlädt – ein Stapel ergibt eine Nachricht.") },
  { art: "erkannt", titel: t("Bons gelesen"), text: t("Wenn die Texterkennung fertig ist – ein Durchgang ergibt eine Nachricht.") },
  { art: "erinnerung", titel: t("Prüfung ausstehend"), text: t("Erinnerung an Bons, die noch geprüft werden müssen.") },
];

const intervallText = (minuten: number) =>
  minuten === 0
    ? t("Sofort (gesammelt je Minute)")
    : minuten < 60
      ? t("Alle {n} Minuten", { n: minuten })
      : minuten === 1440
        ? t("Einmal täglich")
        : t("Alle {n} Stunde|Alle {n} Stunden", { n: minuten / 60 });

/** Benachrichtigungen des eigenen Kontos: Ereignisse × Kanäle, Sammelintervall, Erinnerung, Telegram */
export function BenachrichtigungEinstellungen() {
  const { daten, neuLaden } = useDaten<Daten>("/api/benachrichtigungen/einstellungen");
  const [e, setE] = useState<Einstellung | null>(null);
  const [meldung, setMeldung] = useState<{ art: "gut" | "fehler"; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (daten) setE(daten.einstellung);
  }, [daten]);
  // beim Öffnen über die Glocke (#benachrichtigungen) hierher scrollen
  useEffect(() => {
    if (daten && window.location.hash === "#benachrichtigungen") document.getElementById("benachrichtigungen")?.scrollIntoView({ behavior: "smooth" });
  }, [daten]);

  if (!daten || !e) return null;

  const kanaele: { kanal: Kanal; name: string; moeglich: boolean }[] = [
    { kanal: "glocke", name: t("Glocke"), moeglich: true },
    { kanal: "mail", name: t("E-Mail"), moeglich: daten.mail.verfuegbar },
    { kanal: "telegram", name: "Telegram", moeglich: daten.telegram.verfuegbar && daten.telegram.verbunden },
  ];
  const ausfuehren = async (fn: () => Promise<unknown>, gut?: string) => {
    setMeldung(null);
    try {
      await fn();
      if (gut) setMeldung({ art: "gut", text: gut });
    } catch (fehler) {
      setMeldung({ art: "fehler", text: (fehler as Error).message });
    }
  };
  const geaendert = JSON.stringify(e) !== JSON.stringify(daten.einstellung);

  return (
    <section id="benachrichtigungen" className="karte space-y-4 p-5 lg:col-span-2">
      <div>
        <h2 className="font-semibold">{t("Benachrichtigungen")}</h2>
        <p className="mt-1 text-sm text-text-2">{t("Worüber und wie du informiert wirst. Die Glocke steht oben in der Seitenleiste bzw. am Handy oben rechts.")}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs text-text-3">
              <th className="pb-2 font-medium">{t("Ereignis")}</th>
              {kanaele.map((k) => (
                <th key={k.kanal} className="pb-2 text-center font-medium">
                  {k.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rand">
            {ARTEN.map((a) => (
              <tr key={a.art}>
                <td className="py-2 pr-3">
                  <div className="font-medium">{a.titel}</div>
                  <div className="text-xs text-text-3">{a.text}</div>
                </td>
                {kanaele.map((k) => (
                  <td key={k.kanal} className="text-center">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-akzent)]"
                      disabled={!k.moeglich}
                      checked={e.ereignisse[a.art][k.kanal] && k.moeglich}
                      onChange={(ev) => setE({ ...e, ereignisse: { ...e.ereignisse, [a.art]: { ...e.ereignisse[a.art], [k.kanal]: ev.target.checked } } })}
                      aria-label={`${a.titel}: ${k.name}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-text-2">
          {t("E-Mail und Telegram sammeln")}
          <select className="eingabe mt-1" value={e.intervall} onChange={(ev) => setE({ ...e, intervall: Number(ev.target.value) })}>
            {daten.intervalle.map((m) => (
              <option key={m} value={m}>
                {intervallText(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-text-2">
          {t("Erinnerung an offene Prüfungen")}
          <select className="eingabe mt-1" value={e.erinnerung.tage} onChange={(ev) => setE({ ...e, erinnerung: { ...e.erinnerung, tage: Number(ev.target.value) } })}>
            <option value={0}>{t("Aus")}</option>
            <option value={1}>{t("Täglich")}</option>
            <option value={2}>{t("Alle 2 Tage")}</option>
            <option value={7}>{t("Wöchentlich")}</option>
          </select>
        </label>
        <label className="block text-xs text-text-2">
          {t("Uhrzeit der Erinnerung")}
          <select
            className="eingabe mt-1"
            disabled={!e.erinnerung.tage}
            value={e.erinnerung.stunde}
            onChange={(ev) => setE({ ...e, erinnerung: { ...e.erinnerung, stunde: Number(ev.target.value) } })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-text-3">{t("Erinnert wird nur, wenn tatsächlich Bons auf die Prüfung warten.")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-rand p-3 text-sm">
          <div className="font-medium">{t("E-Mail")}</div>
          {daten.mail.verfuegbar ? (
            <p className="mt-1 text-xs text-text-2">{t("Geht an {adresse}.", { adresse: daten.mail.adresse })}</p>
          ) : (
            <p className="mt-1 text-xs text-text-3">{t("Nicht eingerichtet – der Administrator setzt dafür SMTP_HOST und SMTP_FROM.")}</p>
          )}
        </div>
        <div className="space-y-2 rounded-xl border border-rand p-3 text-sm">
          <div className="font-medium">Telegram</div>
          {!daten.telegram.verfuegbar ? (
            <p className="text-xs text-text-3">{t("Nicht eingerichtet – der Administrator setzt dafür TELEGRAM_BOT_TOKEN.")}</p>
          ) : link ? (
            <div className="space-y-2 text-xs">
              <p className="text-text-2">{t("Öffne den Bot und tippe auf „Starten“ – bei einer Gruppe wählst du zuerst die Gruppe aus. Der Link gilt 15 Minuten.")}</p>
              <div className="flex flex-wrap gap-2">
                <a className="knopf-haupt text-xs" href={link} target="_blank" rel="noopener noreferrer">
                  <Symbol name="link" className="size-3.5" /> {t("Bot öffnen")}
                </a>
                <button className="knopf-zweit text-xs" onClick={() => (setLink(null), neuLaden())}>
                  {t("Erledigt – neu prüfen")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {daten.telegram.chats.length > 0 && (
                <ul className="divide-y divide-rand rounded-lg border border-rand text-xs">
                  {daten.telegram.chats.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
                      <span className="text-gut">✓</span>
                      <span className="min-w-0 flex-1 truncate">{c.titel}</span>
                      <span className="text-text-3">{c.gruppe ? t("Gruppe") : t("eigener Chat")}</span>
                      <button
                        className="knopf-leise px-1.5 py-0.5 text-xs"
                        onClick={() => void ausfuehren(() => api.delete(`/api/benachrichtigungen/telegram/${c.id}`).then(neuLaden), t("Telegram getrennt"))}
                      >
                        {t("Trennen")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  className="knopf-zweit text-xs"
                  onClick={() => void ausfuehren(async () => setLink((await api.post<{ link: string }>("/api/benachrichtigungen/telegram", {})).link))}
                >
                  {daten.telegram.chats.some((c) => !c.gruppe) ? t("Weiteren Chat verbinden") : t("Eigenen Chat verbinden")}
                </button>
                <button
                  className="knopf-zweit text-xs"
                  onClick={() => void ausfuehren(async () => setLink((await api.post<{ link: string }>("/api/benachrichtigungen/telegram", { gruppe: true })).link))}
                >
                  {t("Gruppe verbinden")}
                </button>
              </div>
              <p className="text-[11px] text-text-3">
                {t("Gruppen (z. B. „Familie“) bekommen die Meldungen ohne Knöpfe zum Nachlesen – die gibt es nur in eigenen Chats. Weitere Personen mit eigenem TillSplit-Konto verbinden ihren Chat selbst unter Mein Konto.")}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="knopf-haupt"
          disabled={!geaendert}
          onClick={() => void ausfuehren(() => api.put("/api/benachrichtigungen/einstellungen", e).then(neuLaden), t("Gespeichert"))}
        >
          <Symbol name="haken" className="size-4" /> {t("Speichern")}
        </button>
        <button
          className="knopf-zweit"
          disabled={geaendert}
          title={geaendert ? t("Erst speichern") : undefined}
          onClick={() => void ausfuehren(async () => setMeldung({ art: "gut", text: (await api.post<{ text: string }>("/api/benachrichtigungen/test")).text }))}
        >
          {t("Testnachricht senden")}
        </button>
      </div>
      {meldung && <Hinweis art={meldung.art}>{meldung.text}</Hinweis>}
    </section>
  );
}
