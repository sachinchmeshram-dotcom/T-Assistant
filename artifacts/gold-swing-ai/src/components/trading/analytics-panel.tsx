import { useState } from "react";
import { useGetAnalytics, useSetSmartMode } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Brain, Zap, BarChart3, Waves, BoxSelect, TrendingUp,
  Flame, Snowflake, Activity, Info, Cpu, RefreshCw,
} from "lucide-react";
import type { ConditionAccuracy, AdaptiveWeights, MLModelStatus } from "@workspace/api-client-react";

// Base weights for delta display
const BASE_WEIGHTS = { structure: 25, bos: 25, liquidity: 20, orderBlock: 15, rsiMacd: 15 };

function MLModelCard({ status, trainedOn, accuracy }: {
  status?: MLModelStatus;
  trainedOn?: number;
  accuracy?: number;
}) {
  const isTrained  = status === "trained";
  const isTraining = status === "training";

  return (
    <div className={`rounded-xl border p-3 flex items-center gap-3 transition-all ${
      isTrained  ? "border-violet-500/25 bg-violet-500/5" :
      isTraining ? "border-amber-500/25 bg-amber-500/5"  :
      "border-white/5 bg-black/20"
    }`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
        isTrained  ? "bg-violet-500/20" :
        isTraining ? "bg-amber-500/20"  :
        "bg-zinc-800"
      }`}>
        {isTraining
          ? <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
          : <Cpu className={`w-4 h-4 ${isTrained ? "text-violet-400" : "text-zinc-500"}`} />
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs font-semibold text-foreground">Neural Network</span>
          <span className={`text-[10px] font-mono font-bold ${
            isTrained  ? "text-violet-400" :
            isTraining ? "text-amber-400"  :
            "text-zinc-500"
          }`}>
            {isTrained ? "TRAINED" : isTraining ? "TRAINING…" : "COLD START"}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {isTrained
            ? `${trainedOn ?? 0} samples · ${accuracy ?? 0}% val accuracy`
            : isTraining
            ? "Training in progress…"
            : `Need 20 closed trades to train (have ${trainedOn ?? 0})`
          }
        </div>
      </div>
    </div>
  );
}

function WinDot({ result, pnl }: { result: "WIN" | "LOSS"; pnl: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div title={result} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
        result === "WIN"
          ? "bg-success/20 border-success text-success"
          : "bg-destructive/20 border-destructive text-destructive"
      }`}>
        {result === "WIN" ? "W" : "L"}
      </div>
      <span className={`text-[9px] font-mono leading-none ${result === "WIN" ? "text-success/70" : "text-destructive/70"}`}>
        {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}
      </span>
    </div>
  );
}

function StatBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center bg-black/30 rounded-xl p-3 gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
      <span className={`text-lg font-bold font-mono leading-tight ${color ?? "text-foreground"}`}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground font-mono">{sub}</span>}
    </div>
  );
}

const CONDITION_ICONS: Record<string, React.ElementType> = {
  structure:  BarChart3,
  bos:        Zap,
  liquidity:  Waves,
  orderBlock: BoxSelect,
};

function ConditionRow({ c }: { c: ConditionAccuracy }) {
  const Icon = CONDITION_ICONS[c.key] ?? Activity;
  const barColor =
    c.contribution === "HIGH"   ? "bg-emerald-500" :
    c.contribution === "MEDIUM" ? "bg-amber-500"   :
    c.contribution === "LOW"    ? "bg-red-500"      :
    "bg-zinc-600";

  const textColor =
    c.contribution === "HIGH"   ? "text-emerald-400" :
    c.contribution === "MEDIUM" ? "text-amber-400"   :
    c.contribution === "LOW"    ? "text-red-400"      :
    "text-zinc-500";

  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${textColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-0.5">
          <span className="text-[10px] text-muted-foreground truncate">{c.label}</span>
          <span className={`text-[10px] font-mono font-bold ml-1 flex-shrink-0 ${textColor}`}>
            {c.contribution === "INSUFFICIENT"
              ? `${c.tradeCount} trades`
              : `${c.winRate}%`
            }
          </span>
        </div>
        <div className="w-full bg-white/5 rounded-full h-1 overflow-hidden">
          {c.contribution !== "INSUFFICIENT" ? (
            <div
              className={`h-1 rounded-full transition-all duration-700 ${barColor}`}
              style={{ width: `${c.winRate}%` }}
            />
          ) : (
            <div className="h-1 rounded-full bg-zinc-700 w-1/3 opacity-50" />
          )}
        </div>
      </div>
    </div>
  );
}

function WeightBar({
  label, current, base, color,
}: { label: string; current: number; base: number; color: string }) {
  const delta = current - base;
  const deltaStr = delta === 0 ? "" : delta > 0 ? `+${delta}` : `${delta}`;
  const deltaColor = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-zinc-500";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-20 truncate">{label}</span>
      <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${current}%` }}
        />
      </div>
      <div className="flex items-center gap-1 w-14 justify-end">
        <span className="text-[10px] font-mono text-foreground">{current}%</span>
        {deltaStr && (
          <span className={`text-[9px] font-mono ${deltaColor}`}>{deltaStr}</span>
        )}
      </div>
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
        onSuccess: () => { refetch(); setOptimisticSmart(null); },
        onError:   () => setOptimisticSmart(null),
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

  const streak = data?.streak ?? 0;
  const streakAbs = Math.abs(streak);
  const recentTrend = data?.recentTrend ?? "LEARNING";

  const TrendIcon =
    recentTrend === "HOT"   ? Flame     :
    recentTrend === "COLD"  ? Snowflake :
    recentTrend === "STABLE"? TrendingUp:
    Activity;

  const trendColor =
    recentTrend === "HOT"   ? "text-orange-400" :
    recentTrend === "COLD"  ? "text-blue-400"   :
    recentTrend === "STABLE"? "text-emerald-400":
    "text-zinc-500";

  const aw: AdaptiveWeights = data?.adaptiveWeights ?? {
    structure: 25, bos: 25, liquidity: 20, orderBlock: 15, rsiMacd: 15,
    dataPoints: 0, adapted: false,
  };

  return (
    <Card className="border-white/5 bg-card/50 overflow-hidden h-full">
      <CardHeader className="pb-3 border-b border-white/5 bg-black/20">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="w-4 h-4 text-amber-400" />
          AI Learning Engine
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

        {/* ML Neural Network Model Status */}
        <MLModelCard
          status={data?.mlModelStatus}
          trainedOn={data?.mlTrainedOn}
          accuracy={data?.mlAccuracy}
        />

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

        {/* Win Rate + Streak */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Win Rate</span>
            <div className="flex items-center gap-2">
              {streakAbs >= 2 && (
                <span className={`text-xs font-mono font-bold ${streak > 0 ? "text-orange-400" : "text-blue-400"}`}>
                  {streak > 0 ? `🔥${streakAbs}W` : `❄️${streakAbs}L`}
                </span>
              )}
              <span className={`text-2xl font-bold font-mono leading-none ${winRateColor}`}>
                {data?.totalCompleted ? `${winRate}%` : "—"}
              </span>
            </div>
          </div>
          <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden relative">
            <div
              className={`h-2 rounded-full transition-all duration-700 ${winRateBarColor}`}
              style={{ width: `${Math.max(winRate, 2)}%` }}
            />
            {/* 55% threshold line */}
            <div className="absolute top-0 h-full w-px bg-white/40 opacity-60" style={{ left: "55%" }} />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground/50">
            <span>0%</span>
            <span className="flex items-center gap-0.5">
              <span className="w-px h-2 bg-white/30 inline-block" />55% threshold
            </span>
            <span>100%</span>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatBox label="Total Trades" value={String(data?.totalCompleted ?? 0)} />
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
            value={data?.totalCompleted
              ? (data.expectancy >= 0 ? `+${data.expectancy.toFixed(2)}` : `${data.expectancy.toFixed(2)}`)
              : "—"
            }
            sub="per trade"
            color={(data?.expectancy ?? 0) >= 0 ? "text-success" : "text-destructive"}
          />
        </div>

        {/* Recent trend badge */}
        {data?.totalCompleted && data.totalCompleted >= 3 ? (
          <div className="flex items-center gap-2">
            <TrendIcon className={`w-3.5 h-3.5 ${trendColor}`} />
            <span className={`text-xs font-semibold ${trendColor}`}>
              {recentTrend === "HOT"    ? "Hot streak — signals firing well"    :
               recentTrend === "COLD"   ? "Cold streak — consider reducing size" :
               recentTrend === "STABLE" ? "Stable performance"                  :
               "Gathering data…"}
            </span>
          </div>
        ) : null}

        {/* Last 10 trades */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            Last {data?.last10?.length ?? 0} Trades
          </span>
          {!data?.last10?.length ? (
            <p className="text-xs text-muted-foreground italic">No completed trades yet</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.last10.map(t => (
                <WinDot key={t.id} result={t.result} pnl={t.pnlPoints} />
              ))}
              {Array.from({ length: Math.max(0, 10 - (data.last10?.length ?? 0)) }).map((_, i) => (
                <div key={`empty-${i}`} className="w-5 h-5 rounded-full border border-white/10 bg-white/3 flex-shrink-0" />
              ))}
            </div>
          )}
        </div>

        {/* SMC Condition Accuracy */}
        <div className="border-t border-white/5 pt-3 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              Condition Accuracy
            </span>
            <Info className="w-3 h-3 text-muted-foreground/40" />
          </div>

          {!data?.conditionAccuracy?.length || data.conditionAccuracy.every(c => c.contribution === "INSUFFICIENT") ? (
            <p className="text-xs text-muted-foreground/60 italic">
              Accumulating data — need {5} trades per condition
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {(data.conditionAccuracy ?? []).map(c => (
                <ConditionRow key={c.key} c={c} />
              ))}
            </div>
          )}
        </div>

        {/* Adaptive Weights */}
        <div className="border-t border-white/5 pt-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              Adaptive Weights
            </span>
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
              aw.adapted
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : "bg-zinc-500/10 border border-zinc-500/20 text-zinc-500"
            }`}>
              {aw.adapted ? "ADAPTED" : "BASE"}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <WeightBar label="Structure"   current={aw.structure}  base={BASE_WEIGHTS.structure}  color="bg-amber-500" />
            <WeightBar label="BOS"         current={aw.bos}        base={BASE_WEIGHTS.bos}        color="bg-purple-500" />
            <WeightBar label="Liq. Sweep"  current={aw.liquidity}  base={BASE_WEIGHTS.liquidity}  color="bg-cyan-500" />
            <WeightBar label="Order Block" current={aw.orderBlock} base={BASE_WEIGHTS.orderBlock} color="bg-emerald-500" />
            <WeightBar label="RSI + MACD"  current={aw.rsiMacd}   base={BASE_WEIGHTS.rsiMacd}    color="bg-blue-500" />
          </div>

          {aw.adapted && (
            <p className="text-[9px] text-muted-foreground/50 leading-tight">
              Weights shift ±8 pts based on each condition's win rate.
              Δ shows change vs. base.
            </p>
          )}
        </div>

      </CardContent>
    </Card>
  );
}
