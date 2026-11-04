import { useEffect, useRef } from "react";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, PieChart, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export type DiagrammOptionen = echarts.EChartsCoreOption;

/** Farben des aktuellen Themas für Achsen und Beschriftungen */
export function themaFarben() {
  const stil = getComputedStyle(document.documentElement);
  return {
    text: stil.getPropertyValue("--text-2").trim(),
    leise: stil.getPropertyValue("--text-3").trim(),
    rand: stil.getPropertyValue("--rand").trim(),
    flaeche: stil.getPropertyValue("--flaeche").trim(),
  };
}

export function Diagramm({
  optionen,
  hoehe = 280,
  onKlick,
}: {
  optionen: DiagrammOptionen;
  hoehe?: number;
  onKlick?: (name: string, serie?: string, index?: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const instanz = useRef<echarts.ECharts | null>(null);
  const klick = useRef(onKlick);
  klick.current = onKlick;

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    instanz.current = chart;
    const tooltipWeg = () => chart.dispatchAction({ type: "hideTip" });
    chart.on("click", (p: { name?: string; seriesName?: string; dataIndex?: number }) => {
      // Auf dem Handy bleibt das Tooltip sonst nach dem Antippen stehen – auch über einem geöffneten Fenster
      tooltipWeg();
      if (p.name) klick.current?.(p.name, p.seriesName, p.dataIndex);
    });
    // Antippen außerhalb des Diagramms oder Scrollen blendet das Tooltip ebenfalls aus
    const ausserhalb = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) tooltipWeg();
    };
    document.addEventListener("pointerdown", ausserhalb, true);
    document.addEventListener("scroll", tooltipWeg, true);
    const beobachter = new ResizeObserver(() => chart.resize());
    beobachter.observe(ref.current);
    return () => {
      document.removeEventListener("pointerdown", ausserhalb, true);
      document.removeEventListener("scroll", tooltipWeg, true);
      beobachter.disconnect();
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    const f = themaFarben();
    const eigenes = (optionen as { tooltip?: Record<string, unknown> }).tooltip;
    instanz.current?.setOption(
      {
        textStyle: { fontFamily: "inherit", color: f.text },
        animationDuration: 500,
        ...optionen,
        // Themenfarben auch dann, wenn das Diagramm eigene Tooltip-Optionen mitbringt (sonst weiße Box im Dunkelmodus)
        tooltip: {
          backgroundColor: f.flaeche,
          borderColor: f.rand,
          textStyle: { color: f.text, fontSize: 12 },
          extraCssText: "border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12)",
          confine: true,
          ...eigenes,
        },
      },
      { notMerge: true },
    );
  }, [optionen]);

  return <div ref={ref} style={{ height: hoehe, width: "100%" }} />;
}
