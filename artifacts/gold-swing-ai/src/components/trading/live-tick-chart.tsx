import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
} from "lightweight-charts";
import { usePriceStream } from "@/hooks/usePriceStream";
import { cn } from "@/lib/utils";

// ── Candle resolution options ──────────────────────────────────────────────
const RESOLUTIONS = [
  { label: "5S",  secs: 5 },
  { label: "10S", secs: 10 },
  { label: "30S", secs: 30 },
  { label: "1M",  secs: 60 },
];

interface LiveCandle {
  bucket: number; // integer: Math.floor(epochMs / (res * 1000))
  time:   Time;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
}

export function LiveTickChart() {
  const containerRef  = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<IChartApi | null>(null);
  const seriesRef     = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const candlesRef    = useRef<LiveCandle[]>([]);
  const currentRef    = useRef<LiveCandle | null>(null);
  const resRef        = useRef(5); // seconds per candle

  const [resSecs, setResSecs] = useState(10);
  const [candleCount, setCandleCount] = useState(0);

  const { data, history, connected, tickCount } = usePriceStream();
  const historyLoadedRef = useRef(false);

  // ── Create / recreate chart when resolution changes ────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    // Tear down old chart
    chartRef.current?.remove();
    chartRef.current  = null;
    seriesRef.current = null;
    candlesRef.current  = [];
    currentRef.current  = null;
    resRef.current = resSecs;
    setCandleCount(0);

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
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: true,
        fixRightEdge: true,
        rightOffset: 8,
      },
      crosshair: { mode: 1 },
      handleScroll: true,
      handleScale: true,
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor:          "#22c55e",
      downColor:        "#ef4444",
      borderUpColor:    "#22c55e",
      borderDownColor:  "#ef4444",
      wickUpColor:      "#22c55e",
      wickDownColor:    "#ef4444",
      priceLineVisible: true,
      priceLineColor:   "#f59e0b",
      priceLineWidth:   1,
      lastValueVisible: true,
    });

    chartRef.current  = chart;
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
  }, [resSecs]);

  // ── Load full tick history on connect (pre-populates chart) ────────────────
  useEffect(() => {
    if (!seriesRef.current || history.length === 0 || historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    const res = resRef.current;
    const candleMap = new Map<number, LiveCandle>();

    for (const tick of history) {
      const ms     = tick.ms ?? Date.now();
      const bucket = Math.floor(ms / (res * 1000));
      const time   = (bucket * res) as Time;
      const price  = tick.price;

      if (candleMap.has(bucket)) {
        const c = candleMap.get(bucket)!;
        c.high  = Math.max(c.high, price);
        c.low   = Math.min(c.low, price);
        c.close = price;
      } else {
        candleMap.set(bucket, { bucket, time, open: price, high: price, low: price, close: price });
      }
    }

    const sorted = [...candleMap.values()].sort((a, b) => (a.bucket) - (b.bucket));
    candlesRef.current = sorted;
    currentRef.current = sorted[sorted.length - 1] ?? null;

    try {
      seriesRef.current.setData(
        sorted.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
      );
    } catch { /* ignore */ }

    setCandleCount(sorted.length);
  }, [history]);

  // Reset history flag on resolution change
  useEffect(() => {
    historyLoadedRef.current = false;
  }, [resSecs]);

  // ── Ingest each tick → build live candles ─────────────────────────────────
  useEffect(() => {
    if (!data || !seriesRef.current) return;

    const res    = resRef.current;
    const price  = data.price;
    const ms     = data.ms ?? Date.now();
    const bucket = Math.floor(ms / (res * 1000));
    const time   = (bucket * res) as Time;

    const prev = currentRef.current;

    if (!prev || bucket !== prev.bucket) {
      // Start a new candle
      const newCandle: LiveCandle = {
        bucket,
        time,
        open:  price,
        high:  price,
        low:   price,
        close: price,
      };
      currentRef.current = newCandle;
      candlesRef.current.push(newCandle);
      if (candlesRef.current.length > 500) candlesRef.current.shift();

      // Set full history on first few candles so the library accepts ordering
      const chartData: CandlestickData[] = candlesRef.current.map(c => ({
        time:  c.time,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }));
      try { seriesRef.current.setData(chartData); } catch { /* ignore */ }
      setCandleCount(c => c + 1);
    } else {
      // Update existing candle
      prev.high  = Math.max(prev.high, price);
      prev.low   = Math.min(prev.low,  price);
      prev.close = price;

      try {
        seriesRef.current.update({
          time:  prev.time,
          open:  prev.open,
          high:  prev.high,
          low:   prev.low,
          close: prev.close,
        });
      } catch { /* ignore */ }
    }
  }, [tickCount]);

  const noData = !connected || !data;
  const lastCandle = currentRef.current;
  const isUp = lastCandle ? lastCandle.close >= lastCandle.open : true;

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Resolution selector */}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 border-b border-white/5">
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mr-1">Candle</span>
        {RESOLUTIONS.map(r => (
          <button
            key={r.secs}
            onClick={() => setResSecs(r.secs)}
            className={cn(
              "px-2.5 py-0.5 text-[10px] font-bold rounded font-mono transition-all",
              resSecs === r.secs
                ? "bg-amber-500 text-black"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            {r.label}
          </button>
        ))}

        {/* Live badge */}
        {connected && data && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[10px] font-mono text-amber-400 uppercase tracking-widest">
              LIVE · {candleCount} candles
            </span>
            <span className={cn(
              "ml-2 font-mono text-[11px] font-bold",
              isUp ? "text-green-400" : "text-red-400"
            )}>
              {isUp ? "▲" : "▼"} {data.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
      </div>

      {/* Chart area */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="w-full h-full" />

        {/* Connecting overlay */}
        {noData && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#131722]/80 backdrop-blur-sm">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground font-mono">Waiting for live ticks…</p>
            </div>
          </div>
        )}

        {/* Warming up message (connected but few candles) */}
        {connected && data && candleCount < 2 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-sm border border-white/10 rounded-full px-4 py-1.5">
            <span className="text-[11px] font-mono text-muted-foreground animate-pulse">
              Building candles from live ticks…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
