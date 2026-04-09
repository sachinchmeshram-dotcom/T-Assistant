import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LiveTickChart } from "./live-tick-chart";

type Tab = "ticks" | "ohlc";

// Intraday-first timeframes — default opens on 1H
const TIMEFRAMES = [
  { label: "15m", value: "15" },
  { label: "1H",  value: "60" },
  { label: "4H",  value: "240" },
  { label: "1D",  value: "D" },
];

function buildChartUrl(interval: string): string {
  const params = new URLSearchParams({
    symbol:            "OANDA:XAUUSD",
    interval,
    timezone:          "Etc/UTC",
    theme:             "dark",
    style:             "1",
    locale:            "en",
    toolbar_bg:        "131722",
    backgroundColor:   "rgba(19,23,34,1)",
    gridColor:         "rgba(255,255,255,0.04)",
    enable_publishing: "false",
    hide_top_toolbar:  "false",
    hide_legend:       "false",
    save_image:        "false",
    allow_symbol_change: "false",
    withdateranges:    "true",
    hide_volume:       "false",
    no_referral_id:    "true",
    calendar:          "false",
    hide_market_status: "false",
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

export function ChartWidget() {
  // Default to OHLC at 1H for intraday trading
  const [tab, setTab]           = useState<Tab>("ohlc");
  const [interval, setInterval] = useState("60");
  const [iframeKey, setIframeKey] = useState(0);

  const handleTimeframe = useCallback((val: string) => {
    setInterval(val);
    setIframeKey(k => k + 1);
  }, []);

  return (
    <Card className="flex flex-col h-full overflow-hidden border-white/5 bg-card/50 backdrop-blur-sm">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/20 gap-3 flex-wrap">
        <h2 className="font-semibold text-foreground shrink-0">XAUUSD Live Chart</h2>

        <div className="flex items-center gap-3 ml-auto">
          {/* Tab switcher */}
          <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
            <button
              onClick={() => setTab("ticks")}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 flex items-center gap-1.5",
                tab === "ticks"
                  ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", tab === "ticks" ? "bg-black animate-pulse" : "bg-muted-foreground")} />
              LIVE TICKS
            </button>
            <button
              onClick={() => setTab("ohlc")}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200",
                tab === "ohlc"
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              OHLC
            </button>
          </div>

          {/* Timeframe buttons — only shown on OHLC tab */}
          {tab === "ohlc" && (
            <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => handleTimeframe(tf.value)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200",
                    interval === tf.value
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div className="flex-grow min-h-[480px] w-full relative bg-[#131722]">

        {/* Live Tick Chart — always mounted, hidden when on OHLC tab */}
        <div className={cn("absolute inset-0", tab === "ticks" ? "block" : "hidden")}>
          <LiveTickChart />
        </div>

        {/* TradingView OHLC — always mounted, hidden when on TICKS tab */}
        <div className={cn("absolute inset-0", tab === "ohlc" ? "block" : "hidden")}>
          <iframe
            key={iframeKey}
            src={buildChartUrl(interval)}
            className="w-full h-full border-0"
            title="XAUUSD OHLC Chart"
            allowFullScreen
            loading="eager"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

      </div>
    </Card>
  );
}
