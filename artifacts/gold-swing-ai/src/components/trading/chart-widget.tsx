import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TIMEFRAMES = [
  { label: "15m", value: "15" },
  { label: "1H", value: "60" },
  { label: "4H", value: "240" },
  { label: "1D", value: "D" },
];

export function ChartWidget() {
  const [interval, setInterval] = useState("60");
  const [iframeKey, setIframeKey] = useState(0);

  // Force iframe reload when interval changes
  useEffect(() => {
    setIframeKey(prev => prev + 1);
  }, [interval]);

  return (
    <Card className="flex flex-col h-full overflow-hidden border-white/5 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/20">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          XAUUSD Chart
        </h2>
        <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setInterval(tf.value)}
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
      <div className="flex-grow min-h-[500px] w-full relative bg-[#131722]">
        <iframe
          key={iframeKey}
          id="tradingview_chart"
          src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_chart&symbol=OANDA:XAUUSD&interval=${interval}&hidesidetoolbar=0&symboledit=0&saveimage=0&toolbarbg=131722&theme=dark&style=1&timezone=exchange&studies=[]&show_popup_button=0`}
          className="absolute inset-0 w-full h-full border-0"
          title="TradingView Chart"
          allowFullScreen
        />
      </div>
    </Card>
  );
}
