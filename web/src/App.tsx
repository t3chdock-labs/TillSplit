import { useEffect, useRef } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router";
import { Fusszeile } from "./komponenten/Fusszeile";
import { Glocke } from "./komponenten/Glocke";
import { HochladenAnbieter, useHochladen } from "./komponenten/Hochladen";
import { Symbol } from "./komponenten/Symbol";
import { Admin } from "./seiten/Admin";
import { Anmelden, Einrichten, PasswortAendern } from "./seiten/Anmelden";
import { Artikel } from "./seiten/Artikel";
import { BonDetail } from "./seiten/BonDetail";
import { Bons } from "./seiten/Bons";
import { Einrichtung, EinrichtungsHinweis } from "./seiten/Einrichtung";
import { Einstellungen } from "./seiten/Einstellungen";
import { Finanzen } from "./seiten/Finanzen";
import { Konto } from "./seiten/Konto";
import { Statistik } from "./seiten/Statistik";
import { Uebersicht } from "./seiten/Uebersicht";
import { SitzungAnbieter, useSitzung, type Rechte } from "./sitzung";
import { t } from "./i18n";

type Eintrag = { pfad: string; text: string; symbol: string; recht?: keyof Rechte; nurBreit?: boolean };
const navigation: Eintrag[] = [
  { pfad: "/", text: t("Übersicht"), symbol: "uebersicht", recht: "bons_sehen" },
  { pfad: "/bons", text: t("Bons"), symbol: "bons" },
  { pfad: "/finanzen", text: t("Finanzen"), symbol: "finanzen", recht: "finanzen_sehen" },
  { pfad: "/artikel", text: t("Artikel"), symbol: "artikel", recht: "bons_sehen" },
  // in der Handy-Leiste kein Platz mehr -> dort über die Einstellungen erreichbar
  { pfad: "/statistik", text: t("Statistik"), symbol: "statistik", recht: "verwalten", nurBreit: true },
  { pfad: "/einstellungen", text: t("Einstellungen"), symbol: "einstellungen", recht: "verwalten" },
];

function useNavigation() {
  const { darf } = useSitzung();
  return navigation.filter((n) => !n.recht || darf(n.recht));
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/icon.svg" alt="" className="size-8" />
      <span className="text-lg font-semibold tracking-tight">TillSplit</span>
    </div>
  );
}

/** Auswahl des Haushalts, falls der Benutzer zu mehreren gehört */
function HaushaltWahl({ klein = false }: { klein?: boolean }) {
  const { status, haushaltWechseln } = useSitzung();
  const liste = status.haushalte ?? [];
  if (liste.length < 2) return null;
  return (
    <select
      aria-label={t("Haushalt")}
      className={`eingabe ${klein ? "w-36 py-1 text-xs" : "py-1.5 text-[13px]"}`}
      value={status.haushaltId ?? ""}
      onChange={(e) => void haushaltWechseln(Number(e.target.value))}
    >
      {status.haushaltId == null && <option value="">{t("Haushalt wählen")}</option>}
      {liste.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  );
}

function Seitenleiste() {
  const { auswaehlen } = useHochladen();
  const { status, darf } = useSitzung();
  const eintraege = useNavigation();
  const link = (n: { pfad: string; text: string; symbol: string }) => (
    <NavLink
      key={n.pfad}
      to={n.pfad}
      end={n.pfad === "/"}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
          isActive ? "bg-akzent-hell text-akzent" : "text-text-2 hover:bg-flaeche-2 hover:text-text"
        }`
      }
    >
      <Symbol name={n.symbol} className="size-[18px]" />
      {n.text}
    </NavLink>
  );
  return (
    <aside className="hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-rand bg-flaeche px-4 py-6 md:flex">
      <div className="flex items-center justify-between">
        <Logo />
        <Glocke />
      </div>
      <div className="mt-5">
        <HaushaltWahl />
      </div>
      <button className="knopf-haupt mt-4 w-full py-2.5" onClick={() => auswaehlen()}>
        <Symbol name="hochladen" className="size-4" /> {t("Bons hochladen")}
      </button>
      <nav className="mt-6 flex flex-col gap-1">{eintraege.map(link)}</nav>
      <div className="mt-auto space-y-1">
        {darf("verwalten") && link({ pfad: "/einrichtung", text: t("Einrichtung"), symbol: "kompass" })}
        {status.nutzer?.admin && link({ pfad: "/admin", text: t("Admin-Bereich"), symbol: "schild" })}
        {link({ pfad: "/konto", text: status.nutzer?.name ?? t("Mein Konto"), symbol: "person" })}
        <Fusszeile className="px-3 pt-2" />
      </div>
    </aside>
  );
}

function TabLeiste() {
  const { auswaehlen } = useHochladen();
  const eintraege = useNavigation().filter((n) => !n.nurBreit);
  const eintrag = (n: Eintrag) => (
    <NavLink
      key={n.pfad}
      to={n.pfad}
      end={n.pfad === "/"}
      className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${isActive ? "text-akzent" : "text-text-3"}`}
    >
      <Symbol name={n.symbol} className="size-[22px]" />
      {n.text}
    </NavLink>
  );
  const links = eintraege.slice(0, Math.ceil(eintraege.length / 2));
  const rechts = eintraege.slice(Math.ceil(eintraege.length / 2));
  return (
    <nav className="unten-sicher relative z-40 shrink-0 border-t border-rand bg-flaeche md:hidden">
      <div className="flex items-end">
        {links.map(eintrag)}
        <div className="flex flex-1 justify-center">
          <button
            aria-label={t("Bon fotografieren")}
            onClick={() => auswaehlen(true)}
            onContextMenu={(e) => (e.preventDefault(), auswaehlen())}
            className="-mt-6 flex size-14 items-center justify-center rounded-full bg-akzent text-akzent-text shadow-lg shadow-akzent/30 active:scale-95"
          >
            <Symbol name="kamera" className="size-6" />
          </button>
        </div>
        {rechts.map(eintrag)}
      </div>
    </nav>
  );
}

function Hauptbereich() {
  const { status, darf } = useSitzung();
  // Der Inhalt scrollt in einem eigenen Bereich -> bei Seitenwechsel wieder nach oben
  const inhalt = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // in geschweiften Klammern: neuere Browser geben bei scrollTo ein Promise zurück, React hielte es für die Aufräumfunktion
  useEffect(() => {
    inhalt.current?.scrollTo(0, 0);
  }, [pathname]);
  const start = darf("bons_sehen") ? <Uebersicht /> : <Navigate to="/bons" replace />;
  const geschuetzt = (recht: keyof Rechte, seite: React.ReactNode) => (darf(recht) ? seite : <Navigate to="/bons" replace />);

  // Pflicht: zweiten Faktor einrichten -> nur das Konto
  if (status.zweiFaktorEinrichten) {
    return (
      <main className="mx-auto min-w-0 max-w-5xl flex-1 px-4 py-8">
        <Konto />
      </main>
    );
  }
  if (status.haushaltId == null || !status.rechte) {
    return (
      <div className="flex min-h-dvh flex-1 flex-col">
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {(status.haushalte?.length ?? 0) > 0 ? (
            <div className="karte space-y-3 p-6">
              <p>{t("Bitte wähle einen Haushalt:")}</p>
              <HaushaltWahl />
            </div>
          ) : status.nutzer?.admin ? (
            <Admin />
          ) : (
            <div className="karte p-6 text-sm text-text-2">{t("Du bist noch keinem Haushalt zugeordnet. Bitte wende dich an den Administrator.")}</div>
          )}
        </main>
      </div>
    );
  }

  return (
    <HochladenAnbieter>
      {/* App-Rahmen: nur der Inhalt scrollt, die Leiste unten (Handy) bzw. links bleibt immer stehen */}
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <Seitenleiste />
        <main ref={inhalt} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-10 pt-5 md:px-8 md:pt-8">
          <div className="mb-5 flex items-center justify-between gap-2 md:hidden">
            <Logo />
            <div className="flex items-center gap-2">
              <HaushaltWahl klein />
              <Glocke klein />
              <NavLink to="/konto" aria-label={t("Mein Konto")} className="flex size-9 items-center justify-center rounded-full border border-rand text-text-2">
                <Symbol name="person" className="size-5" />
              </NavLink>
            </div>
          </div>
          <div className="mx-auto max-w-7xl">
            {darf("verwalten") && <EinrichtungsHinweis />}
            <Routes>
              <Route path="/einrichtung" element={geschuetzt("verwalten", <Einrichtung />)} />
              <Route path="/statistik" element={geschuetzt("verwalten", <Statistik />)} />
              <Route path="/" element={start} />
              <Route path="/bons" element={<Bons />} />
              <Route path="/bons/:id" element={<BonDetail />} />
              <Route path="/finanzen" element={geschuetzt("finanzen_sehen", <Finanzen />)} />
              <Route path="/artikel" element={geschuetzt("bons_sehen", <Artikel />)} />
              <Route path="/einstellungen" element={geschuetzt("verwalten", <Einstellungen />)} />
              <Route path="/konto" element={<Konto />} />
              <Route path="/admin" element={status.nutzer?.admin ? <Admin /> : <Navigate to="/" replace />} />
              <Route path="*" element={start} />
            </Routes>
          </div>
        </main>
        <TabLeiste />
      </div>
    </HochladenAnbieter>
  );
}

export function App() {
  return (
    <SitzungAnbieter>
      {(status) => <Inhalt einrichtung={Boolean(status.einrichtung)} angemeldet={status.angemeldet} passwortAendern={Boolean(status.passwortAendern)} />}
    </SitzungAnbieter>
  );
}

function Inhalt({ einrichtung, angemeldet, passwortAendern }: { einrichtung: boolean; angemeldet: boolean; passwortAendern: boolean }) {
  const { status, neuLaden, abmelden } = useSitzung();
  if (einrichtung) return <Einrichten onFertig={() => void neuLaden()} />;
  if (!angemeldet) return <Anmelden status={status} onAngemeldet={() => void neuLaden()} />;
  if (passwortAendern) return <PasswortAendern onFertig={() => void neuLaden()} onAbmelden={() => void abmelden()} />;
  return <Hauptbereich />;
}
