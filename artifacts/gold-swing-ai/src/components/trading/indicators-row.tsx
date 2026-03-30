import { useGetSignal } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function IndicatorsRow() {
  const { data: signalData, isLoading } = useGetSignal({
    query: { refetchInterval: 60000 }
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full bg-white/5 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!signalData) return null;

  const { indicators } = signalData;

  // trend1h / trend15m / trend5m fields now carry scalping TF data:
  // trend1h  → 15m context
  // trend15m → 5m confirmation
  // trend5m  → 1m entry
  const ctx15m  = indicators.trend1h;
  const conf5m  = indicators.trend15m;
  const entry1m = indicators.trend5m;

  const trendColor = (t: string) =>
    t === "BULLISH" ? "text-success" : t === "BEARISH" ? "text-destructive" : "text-muted-foreground";

  const statCards = [
    {
      label: "RSI (14)",
      sublabel: "5m",
      value: indicators.rsi.toFixed(2),
      color: indicators.rsi > 65 ? "text-destructive" : indicators.rsi < 35 ? "text-success" : "text-foreground",
    },
    {
      label: "MACD",
      sublabel: "5m",
      value: indicators.macdHistogram > 0 ? "BULLISH" : "BEARISH",
      color: indicators.macdHistogram > 0 ? "text-success" : "text-destructive",
    },
    {
      label: "ATR",
      sublabel: "1m",
      value: indicators.atr.toFixed(2),
      color: "text-foreground",
    },
    {
      label: "EMA 9/21",
      sublabel: "1m entry",
      value: indicators.ema20 > indicators.ema50 ? "BULLISH" : "BEARISH",
      color: indicators.ema20 > indicators.ema50 ? "text-success" : "text-destructive",
    },
    {
      label: "15m Trend",
      sublabel: "context",
      value: ctx15m,
      color: trendColor(ctx15m),
    },
    {
      label: "5m Trend",
      sublabel: "confirm",
      value: conf5m,
      color: trendColor(conf5m),
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
      {statCards.map((stat, i) => (
        <Card key={i} className="bg-black/20 border-white/5 overflow-hidden hover:bg-white/5 transition-colors duration-300">
          <div className="p-4 flex flex-col items-center justify-center text-center h-full">
            <span className="text-xs text-muted-foreground font-medium mb-0.5">{stat.label}</span>
            {stat.sublabel && (
              <span className="text-[10px] text-muted-foreground/50 mb-1 font-mono">{stat.sublabel}</span>
            )}
            <span className={`text-sm font-bold font-mono tracking-tight ${stat.color}`}>
              {stat.value}
            </span>
          </div>
        </Card>
      ))}
    </div>
  );
}
