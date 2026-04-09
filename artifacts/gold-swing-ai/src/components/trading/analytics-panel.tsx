import { useState } from "react";
import { useGetAnalytics, useSetSmartMode } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Brain, TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";

function WinDot({ result }: { result: "WIN" | "LOSS" }) {
  return (
    <div
      title={result}
      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
        result === "WIN"
          ? "bg-success/20 border-success text-success"
          : "bg-destructive/20 border-destructive text-destructive"
      }`}
    >
      {result === "WIN" ? "W" : "L"}
    </div>
  );
}

function StatBox({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center bg-black/30 rounded-xl p-3 gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
      <span className={`text-lg font-bold font-mono leading-tight ${color ?? "text-foreground"}`}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground font-mono">{sub}</span>}
    </div>
  );
}

export function AnalyticsPanel() {
  const { data, isLoading, refetch } = useGetAnalytics({
    query: { refetchInterval: 30000 },
  });
  const { mutate: toggleSmartMode, isPending } = useSetSmartMode();
  const [optimisticSmart, setOptimisticSmart] = useState<boolean | null>(null);

  const smartMode = optimisticSmart ?? data?.smartMode ?? false;

  function handleSmartToggle(checked: boolean) {
    setOptimisticSmart(checked);
    toggleSmartMode(
      { data: { enabled: checked } },
      {
        onSuccess: () => {
          refetch();
          setOptimisticSmart(null);
        },
        onError: () => setOptimisticSmart(null),
      }
    );
  }

  const winRate = data?.winRate ?? 0;
  const winRateColor =
    winRate >= 65 ? "text-success" :
    winRate >= 50 ? "text-yellow-400" :
    winRate > 0   ? "text-destructive" :
    "text-muted-foreground";

  const winRateBarColor =
    winRate >= 65 ? "bg-success" :
    winRate >= 50 ? "bg-yellow-400" :
    "bg-destructive";

  return (
    <Card className="border-white/5 bg-card/50 overflow-hidden h-full">
      <CardHeader className="pb-3 border-b border-white/5 bg-black/20">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="w-4 h-4 text-amber-400" />
          AI Learning
          <span className="ml-auto flex items-center gap-2 text-sm font-normal">
            <span className={`text-xs ${smartMode ? "text-amber-400" : "text-muted-foreground"}`}>
              Smart Mode
            </span>
            <Switch
              checked={smartMode}
              onCheckedChange={handleSmartToggle}
              disabled={isPending || isLoading}
              className="data-[state=checked]:bg-amber-500"
            />
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4 flex flex-col gap-4">
        {/* Learning Status */}
        <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2">
          <Zap className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
          <span className="text-xs text-amber-200/80 leading-snug">
            {isLoading ? "Loading…" : (data?.learningStatus ?? "Collecting data…")}
          </span>
        </div>

        {/* Smart Mode Status */}
        {smartMode && (
          <div className={`text-[11px] rounded-lg px-3 py-1.5 border leading-snug ${
            data?.sufficientData && winRate < 60
              ? "bg-destructive/10 border-destructive/30 text-destructive/90"
              : "bg-success/10 border-success/30 text-success/90"
          }`}>
            {data?.smartModeStatus ?? "Smart Mode ON"}
          </div>
        )}

        {/* Win Rate */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Win Rate</span>
            <span className={`text-2xl font-bold font-mono leading-none ${winRateColor}`}>
              {data?.totalCompleted ? `${winRate}%` : "—"}
            </span>
          </div>
          <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full transition-all duration-700 ${winRateBarColor}`}
              style={{ width: `${Math.max(winRate, 2)}%` }}
            />
          </div>
          {/* 60% target line marker */}
          <div className="relative h-0">
            <div
              className="absolute -top-4 w-px h-2.5 bg-white/30"
              style={{ left: "60%" }}
              title="60% target"
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatBox
            label="Total Trades"
            value={String(data?.totalCompleted ?? 0)}
          />
          <StatBox
            label="W / L"
            value={`${data?.wins ?? 0} / ${data?.losses ?? 0}`}
            color={winRate >= 50 ? "text-success" : "text-destructive"}
          />
          <StatBox
            label="Avg Profit"
            value={data?.avgProfit ? `+${data.avgProfit.toFixed(2)}` : "—"}
            sub="USD pts"
            color="text-success"
          />
          <StatBox
            label="Expectancy"
            value={
              data?.totalCompleted
                ? (data.expectancy >= 0 ? `+${data.expectancy.toFixed(2)}` : `${data.expectancy.toFixed(2)}`)
                : "—"
            }
            sub="per trade"
            color={(data?.expectancy ?? 0) >= 0 ? "text-success" : "text-destructive"}
          />
        </div>

        {/* Last 10 trades */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            Last {data?.last10?.length ?? 0} Trades
          </span>
          {!data?.last10?.length ? (
            <p className="text-xs text-muted-foreground italic">No completed trades yet</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.last10.map((t) => (
                <div key={t.id} className="flex flex-col items-center gap-0.5">
                  <WinDot result={t.result} />
                  <span className={`text-[9px] font-mono leading-none ${t.result === "WIN" ? "text-success/70" : "text-destructive/70"}`}>
                    {t.pnlPoints >= 0 ? "+" : ""}{t.pnlPoints.toFixed(1)}
                  </span>
                </div>
              ))}
              {/* Fill empty slots */}
              {Array.from({ length: Math.max(0, 10 - (data.last10?.length ?? 0)) }).map((_, i) => (
                <div key={`empty-${i}`} className="w-5 h-5 rounded-full border border-white/10 bg-white/3 flex-shrink-0" />
              ))}
            </div>
          )}
        </div>

        {/* Confidence breakdown legend */}
        <div className="border-t border-white/5 pt-3 flex flex-col gap-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            Signal Confidence Weights
          </span>
          {[
            { label: "Trend (15m/5m/1m)", pct: 40, color: "bg-amber-500" },
            { label: "RSI (5m)", pct: 30, color: "bg-blue-500" },
            { label: "MACD (5m)", pct: 30, color: "bg-purple-500" },
          ].map(w => (
            <div key={w.label} className="flex items-center gap-2">
              <div className="w-20 bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div className={`h-1.5 rounded-full ${w.color}`} style={{ width: `${w.pct}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">{w.pct}%</span>
              <span className="text-[10px] text-muted-foreground">{w.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
