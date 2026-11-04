import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { waehrungSetzen } from "./format";
import "./app.css";
import { anwenden, gespeichert } from "./darstellung";

// gewählte Farben sofort setzen, bevor etwas gezeichnet wird
anwenden(gespeichert(), false);

// Anzeigewährung der KI-Kosten vor dem ersten Zeichnen holen (höchstens kurz warten, sonst US-Dollar)
const info = fetch("/api/info")
  .then((r) => (r.ok ? r.json() : null))
  .then((i: { waehrung?: string; kurs?: number } | null) => i?.waehrung && i.kurs && waehrungSetzen(i.waehrung, i.kurs))
  .catch(() => undefined);

void Promise.race([info, new Promise((ok) => setTimeout(ok, 1500))]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  ),
);
