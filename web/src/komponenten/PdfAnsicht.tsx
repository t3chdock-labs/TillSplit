import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

const MAX_SEITEN = 30;

/**
 * PDF selbst darstellen (pdf.js) statt im iframe: Chrome auf Android und viele
 * Handy-Browser zeigen PDFs im iframe gar nicht an, sondern bieten nur den Download.
 * Die Bibliothek wird erst geladen, wenn wirklich ein PDF angezeigt wird.
 */
export function PdfAnsicht({ quelle }: { quelle: string }) {
  const behaelter = useRef<HTMLDivElement>(null);
  const [gross, setGross] = useState(false);
  const [fehler, setFehler] = useState(false);
  const [seiten, setSeiten] = useState<number | null>(null);

  useEffect(() => {
    const ziel = behaelter.current;
    if (!ziel) return;
    let abgebrochen = false;
    let dokument: { destroy(): Promise<void> } | null = null;
    setFehler(false);
    setSeiten(null);
    ziel.replaceChildren();
    (async () => {
      const [pdfjs, { default: workerUrl }] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const laden = pdfjs.getDocument({ url: quelle, withCredentials: true });
      dokument = laden;
      const pdf = await laden.promise;
      if (abgebrochen) return;
      const anzahl = Math.min(pdf.numPages, MAX_SEITEN);
      setSeiten(pdf.numPages);
      // so scharf rendern, dass auch die vergrößerte Ansicht (180 %) nicht verschwimmt
      const zielBreite = Math.min(ziel.clientWidth * 1.8 * (window.devicePixelRatio || 1), 3000);
      for (let n = 1; n <= anzahl; n++) {
        const seite = await pdf.getPage(n);
        if (abgebrochen) return;
        const ansicht = seite.getViewport({ scale: zielBreite / seite.getViewport({ scale: 1 }).width });
        const leinwand = document.createElement("canvas");
        leinwand.width = Math.floor(ansicht.width);
        leinwand.height = Math.floor(ansicht.height);
        leinwand.className = "block w-full border-b border-rand last:border-b-0";
        leinwand.setAttribute("aria-label", t("Seite {n} von {gesamt}", { n, gesamt: pdf.numPages }));
        ziel.appendChild(leinwand);
        await seite.render({ canvas: leinwand, viewport: ansicht }).promise;
      }
    })().catch(() => !abgebrochen && setFehler(true));
    return () => {
      abgebrochen = true;
      void dokument?.destroy();
    };
  }, [quelle]);

  return (
    <div className="space-y-2">
      <div className={`overflow-auto rounded-xl border border-rand bg-white ${gross ? "max-h-[80dvh]" : "max-h-[75dvh]"}`}>
        {fehler ? (
          <div className="p-6 text-center text-sm text-text-2">{t("Das PDF lässt sich hier nicht anzeigen.")}</div>
        ) : (
          <>
            {seiten == null && <div className="p-6 text-center text-sm text-text-3">{t("PDF wird geladen …")}</div>}
            <div
              ref={behaelter}
              onClick={() => setGross(!gross)}
              className={gross ? "cursor-zoom-out" : "cursor-zoom-in"}
              style={gross ? { width: "180%" } : undefined}
            />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-3">
        <span>
          {seiten != null && seiten > MAX_SEITEN
            ? t("Die ersten {n} von {gesamt} Seiten", { n: MAX_SEITEN, gesamt: seiten })
            : seiten != null && seiten > 1
              ? t("{n} Seiten", { n: seiten })
              : ""}
        </span>
        <a href={quelle} target="_blank" rel="noopener" className="font-medium text-akzent hover:underline">
          {t("PDF öffnen")}
        </a>
      </div>
    </div>
  );
}
