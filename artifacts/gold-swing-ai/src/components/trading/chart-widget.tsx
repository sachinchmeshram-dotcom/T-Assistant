import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TIMEFRAMES = [
  { label: "15m", value: "15" },
  { label: "1H",  value: "60" },
  { label: "4H",  value: "240" },
  { label: "1D",  value: "D" },
];

// Build TradingView Advanced Chart embed URL
function buildChartUrl(interval: string): string {
  const studies = encodeURIComponent(
    JSON.stringify([
      { id: "MASimple@tv-basicstudies", inputs: { length: 20 } },
      { id: "MASimple@tv-basicstudies", inputs: { length: 50 } },
      { id: "RSI@tv-basicstudies" },
      { id: "MACD@tv-basicstudies" },
    ])
  );

  const params = new URLSearchParams({
    symbol: "OANDA:XAUUSD",
    interval,
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "en",
    toolbar_bg: "131722",
    backgroundColor: "rgba(19,23,34,1)",
    gridColor: "rgba(255,255,255,0.04)",
    enable_publishing: "false",
    hide_top_toolbar: "false",
    hide_legend: "false",
    save_image: "false",
    allow_symbol_change: "false",
    withdateranges: "true",
    hide_volume: "false",
    no_referral_id: "true",
    calendar: "false",
    hide_market_status: "false",
    utm_source: "goldswingai",
    utm_medium: "widget",
    utm_campaign: "chart",
  });

  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

export function ChartWidget() {
  const [interval, setIntervalVal] = useState("60");
  const [iframeKey, setIframeKey] = useState(0);

  const handleTimeframe = useCallback((val: string) => {
    setIntervalVal(val);
    setIframeKey(k => k + 1); // Force reload with new interval
  }, []);

  return (
    <Card className="flex flex-col h-full overflow-hidden border-white/5 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/20">
        <h2 className="font-semibold text-foreground">XAUUSD Live Chart</h2>
        <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => handleTimeframe(tf.value)}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-md transition-all duration-200",
                interval === tf.value
                  ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      {/* TradingView real-time embed */}
      <div className="flex-grow min-h-[500px] w-full relative bg-[#131722]">
        <iframe
          key={iframeKey}
          src={buildChartUrl(interval)}
          className="absolute inset-0 w-full h-full border-0"
          title="XAUUSD Live Chart"
          allowFullScreen
          loading="eager"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </Card>
  );
}
