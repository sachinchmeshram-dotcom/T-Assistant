import { useEffect, useRef } from "react";
import { createChart, AreaSeries, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { usePriceStream } from "@/hooks/usePriceStream";

const MAX_TICKS = 500;

interface TickPoint {
  time: Time;
  value: number;
  ms: number;
}

export function LiveTickChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<"Area"> | null>(null);
  const ticksRef     = useRef<TickPoint[]>([]);
  const lastMsRef    = useRef<number>(0);

  const { data, connected, tickCount } = usePriceStream();

  // ── Init chart once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#9ca3af",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: true,
        fixLeftEdge: false,
        fixRightEdge: true,
        rightOffset: 5,
      },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#f59e0b",
      topColor: "rgba(245,158,11,0.25)",
      bottomColor: "rgba(245,158,11,0.0)",
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: "#f59e0b",
      priceLineWidth: 1,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#f59e0b",
      crosshairMarkerBackgroundColor: "#1c1c2e",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  // ── Push each tick into chart ──────────────────────────────────────────────
  useEffect(() => {
    if (!data || !seriesRef.current) return;

    const ms = data.ms ?? Date.now();
    if (ms === lastMsRef.current) return; // dedupe exact-same tick
    lastMsRef.current = ms;

    // Lightweight Charts needs whole-second Time; use ms-based workaround:
    // We offset by an incrementing counter to guarantee unique time values.
    const tArr = ticksRef.current;
    let timeSec = Math.floor(ms / 1000) as Time;

    // If same second as last tick, advance by 1 so chart accepts it
    if (tArr.length > 0) {
      const lastTime = tArr[tArr.length - 1].time as number;
      if ((timeSec as number) <= lastTime) {
        timeSec = (lastTime + 1) as Time;
      }
    }

    const point: TickPoint = { time: timeSec, value: data.price, ms };
    tArr.push(point);
    if (tArr.length > MAX_TICKS) tArr.shift();

    try {
      seriesRef.current.update({ time: timeSec, value: data.price });
    } catch {
      // If chart was disposed during hot-reload, ignore
    }
  }, [tickCount]); // fire on every tick increment

  // ── Overlay when no data ────────────────────────────────────────────────────
  const noData = !connected || !data;

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Live badge */}
      {connected && data && (
        <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 border border-white/10 pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-widest">
            LIVE · {ticksRef.current.length} ticks
          </span>
        </div>
      )}

      {/* Tick counter badge */}
      {connected && data && (
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 border border-white/10 pointer-events-none">
          <span className="font-mono text-[11px] font-bold text-foreground">
            {data.direction === "up"   ? "▲ " : data.direction === "down" ? "▼ " : "  "}
            <span className={data.direction === "up" ? "text-green-400" : data.direction === "down" ? "text-red-400" : "text-muted-foreground"}>
              {data.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </span>
        </div>
      )}

      {/* Connecting overlay */}
      {noData && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#131722]/80 backdrop-blur-sm rounded">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground font-mono">Connecting to live feed…</p>
          </div>
        </div>
      )}
    </div>
  );
}
