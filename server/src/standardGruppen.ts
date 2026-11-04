import type { TransactionSql } from "postgres";
import { sql } from "./db.js";
import { standardSprache, t, type Sprache } from "./i18n.js";

// Startgruppen für neue Haushalte (in der Oberfläche frei änderbar); Namen werden in die Sprache des Haushalts übersetzt.
// Untergruppen-Namen müssen über alle Bereiche eindeutig sein (die KI ordnet nur über den Namen zu).
const STANDARD: { name: string; farbe: string; unter: [string, string][] }[] = [
  {
    name: "Lebensmittel",
    farbe: "#16a34a",
    unter: [
      ["Obst", "#84cc16"], ["Gemüse", "#22c55e"], ["Brot & Backwaren", "#d97706"], ["Milchprodukte & Eier", "#facc15"],
      ["Käse", "#fbbf24"], ["Fleisch & Wurst", "#dc2626"], ["Fisch", "#0ea5e9"], ["Tiefkühl", "#38bdf8"],
      ["Nudeln, Reis & Vorrat", "#a8a29e"], ["Konserven & Fertiggerichte", "#78716c"], ["Gewürze, Öl & Saucen", "#b45309"],
      ["Süßigkeiten & Snacks", "#ec4899"], ["Getränke", "#3b82f6"], ["Alkohol", "#9333ea"], ["Kaffee & Tee", "#92400e"], ["Pfand", "#94a3b8"],
    ],
  },
  {
    name: "Essen gehen",
    farbe: "#f59e0b",
    unter: [["Restaurant & Imbiss", "#fbbf24"], ["Bäckerei & Café", "#fcd34d"], ["Lieferdienst", "#fde68a"]],
  },
  {
    name: "Drogerie",
    farbe: "#db2777",
    unter: [
      ["Körperpflege", "#f472b6"], ["Zahnpflege", "#fbcfe8"], ["Haarpflege", "#f9a8d4"], ["Kosmetik", "#e879f9"],
      ["Hygiene & Papier", "#fda4af"], ["Gesundheit & Medikamente", "#f43f5e"],
    ],
  },
  {
    name: "Baby & Kind",
    farbe: "#fb7185",
    unter: [["Windeln & Babypflege", "#fecdd3"], ["Babynahrung", "#fda4af"], ["Kinderkleidung", "#f9a8d4"], ["Spielzeug", "#f472b6"]],
  },
  {
    name: "Schule & Büro",
    farbe: "#2563eb",
    unter: [["Schulbedarf", "#60a5fa"], ["Schreibwaren & Papier", "#93c5fd"], ["Bücher & Zeitschriften", "#3b82f6"]],
  },
  {
    name: "Haushalt",
    farbe: "#0891b2",
    unter: [
      ["Reinigung & Waschmittel", "#06b6d4"], ["Küche & Haushaltswaren", "#22d3ee"], ["Müllbeutel & Folien", "#a5f3fc"],
      ["Batterien & Leuchtmittel", "#0e7490"], ["Deko & Wohnen", "#67e8f9"],
    ],
  },
  {
    name: "Baumarkt",
    farbe: "#ea580c",
    unter: [
      ["Werkzeug", "#f97316"], ["Baumaterial", "#fb923c"], ["Farben & Lacke", "#fdba74"], ["Garten & Pflanzen", "#65a30d"],
      ["Elektro & Beleuchtung", "#c2410c"],
    ],
  },
  {
    name: "Haustier",
    farbe: "#a16207",
    unter: [
      ["Katzenfutter", "#ca8a04"], ["Hundefutter", "#eab308"], ["Kleintier- & Vogelfutter", "#facc15"], ["Katzenstreu", "#a8a29e"],
      ["Tierspielzeug", "#fde047"], ["Tierpflege & Zubehör", "#d97706"], ["Tierarzt & Medikamente", "#92400e"],
    ],
  },
  {
    name: "Auto",
    farbe: "#475569",
    unter: [
      ["Tanken", "#64748b"], ["Autowäsche & Pflege", "#94a3b8"], ["Öl & Betriebsmittel", "#334155"], ["Ersatzteile & Zubehör", "#cbd5e1"],
      ["Werkstatt & Service", "#1e293b"], ["Parken & Maut", "#7dd3fc"],
    ],
  },
  { name: "Kleidung", farbe: "#7c3aed", unter: [["Kleidung", "#8b5cf6"], ["Schuhe", "#a78bfa"], ["Accessoires & Taschen", "#c4b5fd"]] },
  {
    name: "Elektronik",
    farbe: "#0f766e",
    unter: [["Unterhaltungselektronik", "#14b8a6"], ["Computer & Zubehör", "#2dd4bf"], ["Handy & Zubehör", "#5eead4"], ["Haushaltsgeräte", "#99f6e4"]],
  },
  {
    name: "Freizeit",
    farbe: "#9333ea",
    unter: [["Sport & Outdoor", "#a855f7"], ["Hobby & Basteln", "#c084fc"], ["Geschenke", "#d8b4fe"], ["Ausflüge & Tickets", "#e9d5ff"]],
  },
  { name: "Sonstiges", farbe: "#64748b", unter: [["Sonstiges", "#94a3b8"]] },
];

// Übersetzungsschlüssel der Gruppennamen (für werkzeuge/texte-pruefen.mjs, das nur t("…") findet)
void (() => [
  t("Lebensmittel"), t("Obst"), t("Gemüse"), t("Brot & Backwaren"), t("Milchprodukte & Eier"), t("Käse"), t("Fleisch & Wurst"), t("Fisch"),
  t("Tiefkühl"), t("Nudeln, Reis & Vorrat"), t("Konserven & Fertiggerichte"), t("Gewürze, Öl & Saucen"), t("Süßigkeiten & Snacks"),
  t("Getränke"), t("Alkohol"), t("Kaffee & Tee"), t("Pfand"),
  t("Essen gehen"), t("Restaurant & Imbiss"), t("Bäckerei & Café"), t("Lieferdienst"),
  t("Drogerie"), t("Körperpflege"), t("Zahnpflege"), t("Haarpflege"), t("Kosmetik"), t("Hygiene & Papier"), t("Gesundheit & Medikamente"),
  t("Baby & Kind"), t("Windeln & Babypflege"), t("Babynahrung"), t("Kinderkleidung"), t("Spielzeug"),
  t("Schule & Büro"), t("Schulbedarf"), t("Schreibwaren & Papier"), t("Bücher & Zeitschriften"),
  t("Haushalt"), t("Reinigung & Waschmittel"), t("Küche & Haushaltswaren"), t("Müllbeutel & Folien"), t("Batterien & Leuchtmittel"), t("Deko & Wohnen"),
  t("Baumarkt"), t("Werkzeug"), t("Baumaterial"), t("Farben & Lacke"), t("Garten & Pflanzen"), t("Elektro & Beleuchtung"),
  t("Haustier"), t("Katzenfutter"), t("Hundefutter"), t("Kleintier- & Vogelfutter"), t("Katzenstreu"), t("Tierspielzeug"),
  t("Tierpflege & Zubehör"), t("Tierarzt & Medikamente"),
  t("Auto"), t("Tanken"), t("Autowäsche & Pflege"), t("Öl & Betriebsmittel"), t("Ersatzteile & Zubehör"), t("Werkstatt & Service"), t("Parken & Maut"),
  t("Kleidung"), t("Schuhe"), t("Accessoires & Taschen"),
  t("Elektronik"), t("Unterhaltungselektronik"), t("Computer & Zubehör"), t("Handy & Zubehör"), t("Haushaltsgeräte"),
  t("Freizeit"), t("Sport & Outdoor"), t("Hobby & Basteln"), t("Geschenke"), t("Ausflüge & Tickets"),
  t("Sonstiges"),
]);

export async function standardGruppenAnlegen(tx: TransactionSql, haushaltId: number, sprache: Sprache = standardSprache()): Promise<void> {
  for (const [i, h] of STANDARD.entries()) {
    const [neu] = await tx<{ id: number }[]>`
      insert into gruppen (haushalt_id, name, farbe, sortierung) values (${haushaltId}, ${t(h.name, undefined, sprache)}, ${h.farbe}, ${i + 1}) returning id`;
    for (const [j, [name, farbe]] of h.unter.entries()) {
      // gleiche Namen von Bereich und Untergruppe (z. B. „Sonstiges“) sind erlaubt
      await tx`insert into gruppen (haushalt_id, name, eltern_id, farbe, sortierung) values (${haushaltId}, ${t(name, undefined, sprache)}, ${neu.id}, ${farbe}, ${j + 1})`;
    }
  }
}

/**
 * Startgruppen eines Haushalts in einer anderen Sprache neu anlegen – nur solange noch keine Position
 * und keine gelernte Regel darauf zeigt (also direkt nach der Einrichtung).
 */
export async function standardGruppenUebersetzen(haushaltId: number, sprache: Sprache): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [{ belegt }] = await tx<{ belegt: boolean }[]>`
      select exists (select 1 from positionen p join gruppen g on g.id = p.gruppe_id where g.haushalt_id = ${haushaltId})
          or exists (select 1 from regeln r join gruppen g on g.id = r.gruppe_id where g.haushalt_id = ${haushaltId}) as belegt`;
    if (belegt) return false;
    await tx`delete from gruppen where haushalt_id = ${haushaltId} and eltern_id is not null`;
    await tx`delete from gruppen where haushalt_id = ${haushaltId}`;
    await standardGruppenAnlegen(tx, haushaltId, sprache);
    return true;
  });
}
