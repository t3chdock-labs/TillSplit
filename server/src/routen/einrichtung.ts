import type { FastifyInstance } from "fastify";
import { actualEingerichtet, actualEinstellung, buchungsBudgets } from "../actual.js";
import { httpFehler, zugriff } from "../auth.js";
import { backupEinstellungen } from "../backup.js";
import { einstellungLesen, einstellungSchreiben, sql } from "../db.js";
import { kiEinstellung } from "../ki/index.js";
import { config } from "../config.js";
import { t } from "../i18n.js";

/** Fortschritt der Einrichtungstour je Haushalt: von Hand abgehakte Schritte und ob die Tour ausgeblendet ist */
type Fortschritt = { erledigt: string[]; ausgeblendet: boolean };

export type Schritt = {
  id: string;
  titel: string;
  text: string;
  /** Ziel in der Oberfläche */
  ziel: string;
  erledigt: boolean;
  optional: boolean;
  /** Nur Administratoren können diesen Schritt erledigen */
  nurAdmin: boolean;
  /** Stand wird nicht erkannt, sondern von Hand abgehakt */
  vonHand: boolean;
  hinweis?: string;
  /** Teilschritte mit eigenem Ziel (z. B. „Finanzen einrichten“) */
  unterpunkte?: { titel: string; ziel: string; erledigt: boolean }[];
};

// Schritte, die nur durch Abhaken als erledigt gelten
const VON_HAND = new Set(["gruppen", "ablage"]);

async function schritteErmitteln(haushaltId: number, benutzerId: number, admin: boolean): Promise<{ schritte: Schritt[]; fortschritt: Fortschritt }> {
  const fortschritt = await einstellungLesen<Fortschritt>("einrichtung", { erledigt: [], ausgeblendet: false }, haushaltId);
  const abgehakt = (id: string) => fortschritt.erledigt.includes(id);

  const [[b], [{ passkeys }], [{ mitglieder }], [{ bons }], ki, actual, actualGespeichert, finanzGespeichert] = await Promise.all([
    sql<{ totp_aktiv: boolean }[]>`select totp_aktiv from benutzer where id = ${benutzerId}`,
    sql<{ passkeys: number }[]>`select count(*)::int as passkeys from passkeys where benutzer_id = ${benutzerId}`,
    sql<{ mitglieder: number }[]>`select count(*)::int as mitglieder from mitglieder where haushalt_id = ${haushaltId}`,
    sql<{ bons: number }[]>`select count(*)::int as bons from bons where haushalt_id = ${haushaltId}`,
    kiEinstellung(),
    actualEingerichtet(haushaltId),
    einstellungLesen<unknown>("actual", null, haushaltId),
    einstellungLesen<unknown>("finanzen", null, haushaltId),
  ]);

  // Kategorien je Budget gelten als zugeordnet, wenn jeder Bereich in jedem Buchungs-Budget eine Kategorie hat
  // (oder dort eine Standard-Kategorie greift) – oder wenn „Warengruppen prüfen“ abgehakt ist
  const kategorienZugeordnet = async () => {
    if (!actual) return false;
    const [budgets, a] = await Promise.all([buchungsBudgets(haushaltId), actualEinstellung(haushaltId)]);
    for (const [i, b] of budgets.entries()) {
      if (i === 0 ? a.standardKategorie : a.standardKategorien[b]) continue;
      const [{ offen }] =
        i === 0
          ? await sql<{ offen: number }[]>`select count(*)::int as offen from gruppen where haushalt_id = ${haushaltId} and eltern_id is null and actual_kategorie_id is null`
          : await sql<{ offen: number }[]>`
              select count(*)::int as offen from gruppen g
               where g.haushalt_id = ${haushaltId} and g.eltern_id is null
                 and not exists (select 1 from gruppen_kategorien k where k.gruppe_id = g.id and k.sync_id = ${b})`;
      if (offen > 0) return false;
    }
    return budgets.length > 0;
  };
  const kategorienFertig = abgehakt("gruppen") || (await kategorienZugeordnet());

  const kiBereit = ki.anbieter === "claude" ? Boolean(process.env.ANTHROPIC_API_KEY) : ki.anbieter === "ollama" ? Boolean(ki.ollamaUrl) : true;
  const kiName = { claude: "Claude", ollama: "Ollama", tesseract: "Tesseract" }[ki.anbieter];
  const backup = await backupEinstellungen();

  const schritte: Schritt[] = [
    {
      id: "zweifaktor",
      titel: t("Konto absichern"),
      text: t("Richte eine Authenticator-App oder einen Passkey ein. Dann reicht ein gestohlenes Passwort nicht mehr für die Anmeldung."),
      ziel: "/konto",
      erledigt: b.totp_aktiv || passkeys > 0,
      optional: false,
      nurAdmin: false,
      vonHand: false,
    },
    {
      id: "ki",
      titel: t("Texterkennung wählen"),
      text: t("Lege fest, wer die Bons liest: Claude (genau, kostet etwa 0,1 Cent je Bon), Ollama (lokal) oder Tesseract mit Textmodell."),
      ziel: "/einstellungen?reiter=verbindungen",
      erledigt: kiBereit,
      optional: false,
      nurAdmin: true,
      vonHand: false,
      hinweis: kiBereit
        ? t("Aktuell: {name}", { name: kiName })
        : ki.anbieter === "claude"
          ? t("Claude ist gewählt, aber kein API-Schlüssel hinterlegt (ANTHROPIC_API_KEY bzw. Secret tillsplit_anthropic_key).")
          : t("Ollama ist gewählt, aber OLLAMA_URL fehlt."),
    },
    {
      id: "actual",
      titel: t("Actual Budget verbinden"),
      text: t("Adresse, Passwort und Sync-ID deines Actual-Servers eintragen. Ohne Actual funktioniert TillSplit auch – dann ohne Aufteilung der Buchungen."),
      ziel: "/admin?reiter=haushalte",
      erledigt: actual,
      optional: true,
      nurAdmin: true,
      vonHand: false,
    },
    {
      id: "actualKonten",
      titel: t("Konten und Bargeld festlegen"),
      text: t("Welche Konten nach Abbuchungen durchsucht werden, wie Barzahlungen gebucht werden und welche Kategorie als Standard dient."),
      ziel: "/einstellungen?reiter=verbindungen",
      erledigt: actualGespeichert != null,
      optional: !actual,
      nurAdmin: false,
      vonHand: false,
      hinweis: actual ? undefined : t("Erst nach dem Verbinden mit Actual möglich."),
    },
    {
      // mehrere Budgets auf demselben Server gehören in EINEN Haushalt – hier wird das sichtbar
      id: "finanzen",
      titel: t("Finanzen einrichten"),
      text: t("Liegen weitere Budgets auf demselben Actual-Server (z. B. ein Haushaltskonto), nimmst du sie hier dazu – kein zweiter Haushalt nötig."),
      ziel: "/einstellungen?reiter=verbindungen",
      erledigt: actualGespeichert != null && finanzGespeichert != null && kategorienFertig,
      optional: true,
      nurAdmin: false,
      vonHand: false,
      hinweis: actual ? undefined : t("Erst nach dem Verbinden mit Actual möglich."),
      unterpunkte: [
        { titel: t("Weitere Budgets zum Buchen wählen"), ziel: "/einstellungen?reiter=verbindungen", erledigt: actualGespeichert != null },
        { titel: t("Budgets fürs Finanz-Dashboard und Vermögenskonten festlegen"), ziel: "/einstellungen?reiter=finanzen", erledigt: finanzGespeichert != null },
        { titel: t("Kategorien je Budget zuordnen"), ziel: "/einstellungen?reiter=gruppen", erledigt: kategorienFertig },
      ],
    },
    {
      id: "gruppen",
      titel: t("Warengruppen prüfen"),
      text: t("Die Standard-Warengruppen passen für die meisten Haushalte. Benenne sie nach Bedarf um und ordne ihnen Actual-Kategorien zu."),
      ziel: "/einstellungen?reiter=gruppen",
      erledigt: abgehakt("gruppen"),
      optional: false,
      nurAdmin: false,
      vonHand: true,
    },
    {
      id: "ablage",
      titel: t("Ablage der Bon-Dateien"),
      text: t("Ordner- und Dateinamen per Drag & Drop zusammenstellen und bei Bedarf die Verschlüsselung der Dateien einschalten."),
      ziel: "/einstellungen?reiter=ablage",
      erledigt: abgehakt("ablage"),
      optional: false,
      nurAdmin: false,
      vonHand: true,
    },
    {
      id: "mitglieder",
      titel: t("Mitglieder einladen"),
      text: t("Weitere Personen anlegen und ihnen Rechte geben – zum Beispiel „Nur hochladen“ für Kinder, ohne Einblick in die Finanzen."),
      ziel: "/admin?reiter=benutzer",
      erledigt: mitglieder > 1,
      optional: true,
      nurAdmin: true,
      vonHand: false,
    },
    {
      id: "backup",
      titel: t("Backup einschalten"),
      text: t("Mit einem Backup-Passwort (BACKUP_PASSWORD bzw. Secret tillsplit_backup_password) sichert TillSplit Datenbank und Bons regelmäßig verschlüsselt."),
      ziel: "/admin?reiter=backups",
      erledigt: backup.passwortGesetzt,
      optional: false,
      nurAdmin: true,
      vonHand: false,
      hinweis: backup.passwortGesetzt ? t("Alle {stunden} Stunden, {behalten} Sicherungen werden behalten.", { stunden: backup.stunden, behalten: backup.behalten }) : undefined,
    },
    {
      id: "bon",
      titel: t("Ersten Bon hochladen"),
      text: t("Fotografiere einen Kassenbon oder lade eine PDF hoch und prüfe das Ergebnis der Erkennung."),
      ziel: "/bons",
      erledigt: bons > 0,
      optional: false,
      nurAdmin: false,
      vonHand: false,
    },
  ];
  // Nicht-Admins sehen nur, was sie selbst erledigen können
  return { schritte: admin ? schritte : schritte.filter((s) => !s.nurAdmin), fortschritt };
}

export async function einrichtungRouten(app: FastifyInstance) {
  app.get("/api/einrichtung", async (req) => {
    const h = zugriff(req, "verwalten");
    const n = req.nutzer!;
    const { schritte, fortschritt } = await schritteErmitteln(h, n.id, n.admin);
    const pflichtOffen = schritte.filter((s) => !s.erledigt && !s.optional).length;
    return { schritte, ausgeblendet: fortschritt.ausgeblendet, pflichtOffen };
  });

  app.put<{ Body: { schritt?: string; erledigt?: boolean; ausgeblendet?: boolean } }>("/api/einrichtung", async (req) => {
    const h = zugriff(req, "verwalten");
    const b = req.body ?? {};
    const f = await einstellungLesen<Fortschritt>("einrichtung", { erledigt: [], ausgeblendet: false }, h);
    if (b.schritt !== undefined) {
      if (!VON_HAND.has(b.schritt)) throw httpFehler(400, "Dieser Schritt wird automatisch erkannt");
      const rest = f.erledigt.filter((s) => s !== b.schritt);
      f.erledigt = b.erledigt ? [...rest, b.schritt] : rest;
    }
    if (typeof b.ausgeblendet === "boolean") f.ausgeblendet = b.ausgeblendet;
    await einstellungSchreiben("einrichtung", f, h);
    return { ok: true };
  });
}
