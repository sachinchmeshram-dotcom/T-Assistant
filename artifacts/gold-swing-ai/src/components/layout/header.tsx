import { useGetPrice } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, Activity, Radio } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";

export function Header() {
  const { data: priceData, isLoading, isError, dataUpdatedAt } = useGetPrice({
    query: { refetchInterval: 5000 } // Poll every 5 seconds
  });

  const [blinkOn, setBlinkOn] = useState(true);

  // Live dot blink effect
  useEffect(() => {
    const id = setInterval(() => setBlinkOn(v => !v), 800);
    return () => clearInterval(id);
  }, []);

  const isPositive = priceData ? priceData.change >= 0 : true;

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
            <Activity className="text-black w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground hidden sm:block">
              Gold Swing AI Pro
            </h1>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
              <Radio
                className="w-3 h-3"
                style={{ color: blinkOn ? "#22c55e" : "transparent", transition: "color 0.2s" }}
              />
              <span>XAUUSD · LIVE</span>
            </div>
          </div>
        </div>

        {/* Price display */}
        <div className="flex items-center gap-6">
          {isLoading ? (
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-36 bg-white/5" />
              <div className="hidden md:flex flex-col gap-1">
                <Skeleton className="h-4 w-24 bg-white/5" />
                <Skeleton className="h-4 w-24 bg-white/5" />
              </div>
            </div>
          ) : isError || !priceData ? (
            <div className="text-destructive font-mono text-sm">Price unavailable</div>
          ) : (
            <>
              <div className="flex flex-col items-end">
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-bold tracking-tighter font-mono tabular-nums">
                    {formatPrice(priceData.price)}
                  </span>
                  <span
                    className={`text-sm font-semibold flex items-center font-mono tabular-nums ${
                      isPositive ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {isPositive ? (
                      <TrendingUp className="w-4 h-4 mr-1" />
                    ) : (
                      <TrendingDown className="w-4 h-4 mr-1" />
                    )}
                    {priceData.change > 0 ? "+" : ""}
                    {priceData.change.toFixed(2)} ({priceData.changePercent.toFixed(2)}%)
                  </span>
                </div>
                {lastUpdated && (
                  <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    Updated {lastUpdated}
                  </span>
                )}
              </div>

              <div className="hidden md:flex flex-col text-xs font-mono text-muted-foreground gap-1 border-l border-white/10 pl-6">
                <div className="flex justify-between gap-4">
                  <span>24H HIGH</span>
                  <span className="text-foreground tabular-nums">{formatPrice(priceData.high24h)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>24H LOW</span>
                  <span className="text-foreground tabular-nums">{formatPrice(priceData.low24h)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
