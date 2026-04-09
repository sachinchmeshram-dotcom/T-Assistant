import { useGetSignal } from "@workspace/api-client-react";
import type { MLModelStatus } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/utils";
import { format } from "date-fns";
import {
  AlertCircle, Target, ShieldX, ArrowRightCircle,
  TrendingUp, TrendingDown, Minus, Zap,
  Waves, BarChart3, BoxSelect, ArrowUpFromLine, ArrowDownFromLine,
  Brain, Cpu, RefreshCw, FlameKindling, Sparkles, Globe,
} from "lucide-react";
import { CooldownTimer } from "./cooldown-timer";
import { motion } from "framer-motion";

// ── Small helpers ─────────────────────────────────────────────────────────────
function MLStatusBadge({ status }: { status?: MLModelStatus }) {
  if (status === "trained")  return (
    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] py-0 px-1.5">
      <Cpu className="w-2.5 h-2.5 mr-0.5" /> TRAINED
    </Badge>
  );
  if (status === "training") return (
    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] py-0 px-1.5">
      <RefreshCw className="w-2.5 h-2.5 mr-0.5 animate-spin" /> TRAINING
    </Badge>
  );
  return (
    <Badge variant="outline" className="border-zinc-500/30 bg-zinc-500/10 text-zinc-400 text-[10px] py-0 px-1.5">
      COLD START
    </Badge>
  );
}

function ProbBar({ label, value, color, isWinner }: {
  label: string; value: number; color: string; isWinner: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-mono w-16 flex-shrink-0 ${isWinner ? "text-foreground font-bold" : "text-muted-foreground"}`}>
        {label}
      </span>
      <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
        <motion.div
          className={`h-1.5 rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <span className={`text-[10px] font-mono w-8 text-right flex-shrink-0 ${isWinner ? "text-foreground font-bold" : "text-muted-foreground"}`}>
        {value}%
      </span>
    </div>
  );
}

function SignalChip({
  label, signal, confidence, sub,
}: { label: string; signal: string; confidence?: number; sub?: string }) {
  const isLong  = signal === "LONG";
  const isShort = signal === "SHORT";

  return (
    <div className="flex flex-col items-center gap-1.5 flex-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      <div className={`px-3 py-1.5 rounded-lg font-bold text-sm border ${
        isLong  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" :
        isShort ? "bg-red-500/15 border-red-500/30 text-red-400" :
        "bg-zinc-500/10 border-zinc-500/20 text-zinc-400"
      }`}>
        {signal === "NO_TRADE" ? "HOLD" : signal}
      </div>
      {confidence !== undefined && (
        <span className={`text-[11px] font-mono font-semibold ${
          isLong ? "text-emerald-400/80" : isShort ? "text-red-400/80" : "text-zinc-500"
        }`}>
          {confidence}%
        </span>
      )}
      {sub && <span className="text-[10px] text-muted-foreground/50">{sub}</span>}
    </div>
  );
}

function StrengthBadge({ strength }: { strength: "STRONG" | "NORMAL" | null }) {
  if (strength === "STRONG") return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30">
      <FlameKindling className="w-3.5 h-3.5 text-amber-400" />
      <span className="text-xs font-bold text-amber-400 tracking-wide">STRONG SIGNAL</span>
    </div>
  );
  if (strength === "NORMAL") return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/30">
      <Sparkles className="w-3.5 h-3.5 text-blue-400" />
      <span className="text-xs font-bold text-blue-400 tracking-wide">NORMAL SIGNAL</span>
    </div>
  );
  return null;
}

// ── Session badge ─────────────────────────────────────────────────────────────
function SessionBadge({ active, asian }: { active?: string; asian?: boolean }) {
  if (!active) return null;
  const isAsian = asian;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold tracking-wide ${
      isAsian
        ? "bg-orange-500/10 border-orange-500/25 text-orange-400"
        : "bg-sky-500/10 border-sky-500/25 text-sky-400"
    }`}>
      <Globe className="w-3 h-3" />
      {active}
      {isAsian && <span className="text-orange-400/60">· Low liquidity</span>}
    </div>
  );
}

// ── Pivot points row ──────────────────────────────────────────────────────────
function PivotRow({
  pivots, currentPrice,
}: {
  pivots: { pivot: number; r1: number; r2: number; s1: number; s2: number } | null | undefined;
  currentPrice: number;
}) {
  if (!pivots) return null;
  const levels = [
    { label: "R2", value: pivots.r2, color: "text-red-400/70" },
    { label: "R1", value: pivots.r1, color: "text-red-400/90" },
    { label: "PP", value: pivots.pivot, color: "text-amber-400" },
    { label: "S1", value: pivots.s1, color: "text-emerald-400/90" },
    { label: "S2", value: pivots.s2, color: "text-emerald-400/70" },
  ];
  return (
    <div className="bg-black/30 border border-white/5 rounded-xl p-3">
      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">Daily Pivot Points</p>
      <div className="flex items-center justify-between gap-1">
        {levels.map(l => (
          <div key={l.label} className={`flex flex-col items-center gap-0.5 flex-1 ${
            Math.abs(currentPrice - l.value) < 2 ? "ring-1 ring-amber-400/30 rounded-lg bg-amber-500/5 p-1" : ""
          }`}>
            <span className="text-[9px] text-muted-foreground/50 font-mono">{l.label}</span>
            <span className={`text-[11px] font-mono font-bold ${l.color}`}>{l.value.toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Colour helpers
const structureColor = (s?: string) =>
  s === "UPTREND" ? "text-emerald-400" : s === "DOWNTREND" ? "text-red-400" : "text-zinc-400";
const structureBg = (s?: string) =>
  s === "UPTREND"   ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
  s === "DOWNTREND" ? "border-red-500/30 bg-red-500/10 text-red-400" :
  "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";
const bosColor   = (on?: boolean) => on ? "text-amber-400" : "text-zinc-600";
const sweepColor = (on?: boolean) => on ? "text-cyan-400"  : "text-zinc-600";

// ── Main Component ────────────────────────────────────────────────────────────
export function SignalPanel() {
  const { data: signalData, isLoading, isError } = useGetSignal({
    query: {
      refetchInterval: 300000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
      staleTime: 240000,
    }
  });

  if (isLoading) {
    return (
      <Card className="h-full bg-card/50">
        <CardContent className="p-6 flex flex-col gap-6">
          <Skeleton className="h-24 w-full bg-white/5 rounded-2xl" />
          <Skeleton className="h-16 w-full bg-white/5 rounded-xl" />
          <Skeleton className="h-8 w-3/4 bg-white/5" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-20 w-full bg-white/5" />
            <Skeleton className="h-20 w-full bg-white/5" />
            <Skeleton className="h-20 w-full bg-white/5" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !signalData) {
    return (
      <Card className="h-full flex items-center justify-center border-destructive/20 bg-destructive/5">
        <div className="text-center text-destructive flex flex-col items-center gap-2">
          <AlertCircle className="w-8 h-8" />
          <p>Failed to load AI signal</p>
        </div>
      </Card>
    );
  }

  const {
    signal, confidence, entryPrice, stopLoss, takeProfit,
    trend, reason, timestamp, tradeDuration, cooldownRemaining,
    marketStructure, bos, bosLevel, liquiditySweep, liquiditySweepType,
    orderBlock, inOrderBlock, smcScore,
    mlSignal, mlConfidence, mlPLong, mlPShort, mlPNoTrade,
    mlModelStatus, mlTrainedOn, mlAccuracy,
    smcSignal, smcConfidence, signalStrength, hybridConfidence,
  } = signalData;

  const session = (signalData as any).session as { london: boolean; newYork: boolean; asian: boolean; active: string } | undefined;
  const pivots  = (signalData as any).pivots  as { pivot: number; r1: number; r2: number; s1: number; s2: number } | null | undefined;

  const mlWinner = mlPLong >= mlPShort && mlPLong >= mlPNoTrade ? "LONG"
    : mlPShort >= mlPLong  && mlPShort >= mlPNoTrade ? "SHORT" : "NO_TRADE";

  const signalColors = {
    LONG:  "bg-success text-success-foreground shadow-[0_0_40px_rgba(34,197,94,0.25)] border-success/50",
    SHORT: "bg-destructive text-destructive-foreground shadow-[0_0_40px_rgba(239,68,68,0.25)] border-destructive/50",
    HOLD:  "bg-warning text-warning-foreground shadow-[0_0_20px_rgba(234,179,8,0.15)] border-warning/50",
  };

  const TrendIcon = trend === "BULLISH" ? TrendingUp : trend === "BEARISH" ? TrendingDown : Minus;
  const trendColor = trend === "BULLISH" ? "text-success" : trend === "BEARISH" ? "text-destructive" : "text-muted-foreground";

  const hybridBarColor =
    hybridConfidence >= 80 ? "bg-amber-400" :
    hybridConfidence >= 65 ? "bg-emerald-500" :
    hybridConfidence >= 50 ? "bg-blue-500" :
    "bg-zinc-500";

  const smcAgrees = smcSignal !== "HOLD" && smcSignal === signal;
  const mlAgrees  = mlSignal  !== "NO_TRADE" && mlSignal === signal;

  return (
    <Card className="relative overflow-hidden border-white/10 bg-gradient-to-b from-card to-background shadow-2xl">
      <div className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-10 pointer-events-none
        ${signal === "LONG" ? "bg-success" : signal === "SHORT" ? "bg-destructive" : "bg-warning"}`} />

      <CardContent className="p-6 lg:p-8 flex flex-col gap-5 relative z-10">

        {/* ── Session + Final Signal + Hybrid Confidence ────────────────── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
                Intraday AI Signal
              </h2>
              <SessionBadge active={session?.active} asian={session?.asian} />
            </div>
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                key={signal}
                className={`px-8 py-3 rounded-xl font-black text-3xl tracking-tight border ${signalColors[signal]}`}
              >
                {signal}
              </motion.div>
              <div className="flex flex-col gap-1.5">
                {signalStrength && <StrengthBadge strength={signalStrength} />}
                {cooldownRemaining > 0 && <CooldownTimer initialSeconds={cooldownRemaining} />}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end w-full md:w-auto gap-1.5">
            <div className="flex justify-between w-full md:w-52 gap-2">
              <span className="text-xs text-muted-foreground">Hybrid Confidence</span>
              <span className={`text-xs font-bold font-mono ${
                hybridConfidence >= 80 ? "text-amber-400" :
                hybridConfidence >= 65 ? "text-emerald-400" :
                hybridConfidence >= 50 ? "text-blue-400" :
                "text-zinc-400"
              }`}>
                {hybridConfidence}%
              </span>
            </div>
            <div className="w-full md:w-52 h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
              <motion.div
                className={`h-full rounded-full ${hybridBarColor}`}
                initial={{ width: 0 }}
                animate={{ width: `${hybridConfidence}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 text-right">60% SMC (1H/4H) · 40% LSTM</p>
          </div>
        </div>

        {/* ── Pivot Points ──────────────────────────────────────────────── */}
        <PivotRow pivots={pivots} currentPrice={entryPrice} />

        {/* ── Three-Signal Display ──────────────────────────────────────── */}
        <div className="rounded-2xl border border-white/8 bg-black/25 p-4">
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-3 text-center">Signal Breakdown</p>
          <div className="flex items-stretch gap-2">
            <SignalChip
              label="SMC Signal"
              signal={smcSignal}
              confidence={smcConfidence}
              sub="1H/4H SMC"
            />
            <div className="flex flex-col items-center justify-center px-1 pt-4">
              <div className="text-lg text-muted-foreground/30">+</div>
            </div>
            <SignalChip
              label="LSTM Signal"
              signal={mlModelStatus === "trained" ? mlSignal : "NO_TRADE"}
              confidence={mlModelStatus === "trained" ? mlConfidence : undefined}
              sub={mlModelStatus === "trained" ? "LSTM 1H" : "Not trained"}
            />
            <div className="flex flex-col items-center justify-center px-1 pt-4">
              <div className="text-lg text-muted-foreground/30">=</div>
            </div>
            <SignalChip
              label="Final Signal"
              signal={signal}
              confidence={hybridConfidence}
              sub={
                signalStrength === "STRONG" ? "SMC+LSTM Agree" :
                signalStrength === "NORMAL" ? "SMC ≥80%" :
                "Waiting"
              }
            />
          </div>

          <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${smcAgrees ? "bg-emerald-400" : signal === "HOLD" ? "bg-zinc-600" : "bg-red-500/60"}`} />
              <span className="text-[10px] text-muted-foreground">
                SMC {smcAgrees ? "confirms" : signal !== "HOLD" ? "disagrees" : "no signal"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${
                mlModelStatus !== "trained" ? "bg-zinc-600" :
                mlAgrees ? "bg-emerald-400" : signal === "HOLD" ? "bg-zinc-600" : "bg-amber-400"
              }`} />
              <span className="text-[10px] text-muted-foreground">
                LSTM {mlModelStatus !== "trained" ? "untrained" : mlAgrees ? "confirms" : signal !== "HOLD" ? "disagrees" : "no signal"}
              </span>
            </div>
          </div>
        </div>

        {/* ── ML Neural Network Details ─────────────────────────────────── */}
        <div className={`rounded-2xl border p-4 flex flex-col gap-3 transition-all duration-300 ${
          signalStrength === "STRONG"
            ? "border-amber-500/25 bg-amber-500/5"
            : mlModelStatus === "trained"
            ? "border-white/10 bg-black/20"
            : "border-white/5 bg-black/10"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className={`w-4 h-4 ${signalStrength === "STRONG" ? "text-amber-400" : "text-muted-foreground"}`} />
              <span className="text-sm font-semibold text-foreground">LSTM Model</span>
              {signalStrength === "STRONG" && (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-300 text-[10px] py-0 px-1.5">
                  CONFIRMS SIGNAL
                </Badge>
              )}
            </div>
            <MLStatusBadge status={mlModelStatus} />
          </div>

          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
            <span>{mlTrainedOn ?? 0} training samples</span>
            {mlAccuracy > 0 && (
              <>
                <span className="text-white/10">·</span>
                <span className={mlAccuracy >= 60 ? "text-emerald-400/70" : "text-amber-400/70"}>
                  {mlAccuracy}% val accuracy
                </span>
              </>
            )}
            {mlModelStatus !== "trained" && (
              <span className="italic">Need 15+ completed trades to train LSTM</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <ProbBar label="LONG"     value={mlPLong    ?? 34} color="bg-emerald-500" isWinner={mlWinner === "LONG"} />
            <ProbBar label="SHORT"    value={mlPShort   ?? 33} color="bg-red-500"     isWinner={mlWinner === "SHORT"} />
            <ProbBar label="NO TRADE" value={mlPNoTrade ?? 33} color="bg-zinc-500"    isWinner={mlWinner === "NO_TRADE"} />
          </div>

          {mlModelStatus === "trained" && (
            <div className="flex items-center justify-between pt-1 border-t border-white/5">
              <span className="text-[10px] text-muted-foreground">ML Confidence</span>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold font-mono ${
                  mlConfidence >= 80 ? "text-emerald-400" :
                  mlConfidence >= 65 ? "text-amber-400"   :
                  "text-zinc-400"
                }`}>{mlConfidence}%</span>
                <span className="text-[10px] text-muted-foreground/50">
                  {mlConfidence >= 65 ? "threshold ✓" : "below threshold"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── SMC Confluence Grid ───────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <BarChart3 className="w-3.5 h-3.5" /> Market Structure
            </div>
            <div className={`flex items-center gap-1.5 font-bold text-sm ${structureColor(marketStructure)}`}>
              {marketStructure === "UPTREND"   && <ArrowUpFromLine   className="w-4 h-4" />}
              {marketStructure === "DOWNTREND" && <ArrowDownFromLine className="w-4 h-4" />}
              {marketStructure === "RANGING"   && <Minus             className="w-4 h-4" />}
              {marketStructure}
            </div>
            <Badge variant="outline" className={`self-start text-xs py-0 px-1.5 mt-0.5 ${structureBg(marketStructure)}`}>
              {marketStructure === "UPTREND" ? "HH · HL" : marketStructure === "DOWNTREND" ? "LH · LL" : "NO TREND"}
            </Badge>
          </div>

          <div className={`bg-black/30 border rounded-xl p-3 flex flex-col gap-1 transition-all
            ${bos ? "border-amber-500/30 bg-amber-500/5" : "border-white/5"}`}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Zap className="w-3.5 h-3.5" /> Break of Structure
            </div>
            <div className={`font-bold text-sm ${bosColor(bos)}`}>
              {bos ? "✓ CONFIRMED" : "─ PENDING"}
            </div>
            {bos && bosLevel && (
              <span className="text-xs text-amber-400/70 font-mono">@ {formatPrice(bosLevel)}</span>
            )}
          </div>

          <div className={`bg-black/30 border rounded-xl p-3 flex flex-col gap-1 transition-all
            ${liquiditySweep ? "border-cyan-500/30 bg-cyan-500/5" : "border-white/5"}`}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Waves className="w-3.5 h-3.5" /> Liquidity Sweep
            </div>
            <div className={`font-bold text-sm ${sweepColor(liquiditySweep)}`}>
              {liquiditySweep ? "✓ SWEPT" : "─ NOT SWEPT"}
            </div>
            {liquiditySweep && liquiditySweepType && (
              <Badge variant="outline" className="self-start text-xs py-0 px-1.5 border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                {liquiditySweepType === "equal_low" ? "Equal Lows" : "Equal Highs"}
              </Badge>
            )}
          </div>

          <div className={`bg-black/30 border rounded-xl p-3 flex flex-col gap-1 transition-all
            ${orderBlock
              ? orderBlock.type === "bullish"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-red-500/30 bg-red-500/5"
              : "border-white/5"}`}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <BoxSelect className="w-3.5 h-3.5" /> Order Block
            </div>
            {orderBlock ? (
              <>
                <div className={`font-bold text-sm ${orderBlock.type === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
                  {inOrderBlock ? "✓ PRICE IN OB" : `${orderBlock.type.toUpperCase()} OB`}
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  {formatPrice(orderBlock.low)} – {formatPrice(orderBlock.high)}
                </span>
              </>
            ) : (
              <div className="font-bold text-sm text-zinc-600">─ NOT FOUND</div>
            )}
          </div>
        </div>

        {/* ── Reason / Signal Reasoning ────────────────────────────────── */}
        <div className="bg-black/30 border border-white/5 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">Signal Reasoning</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{reason}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/5">
            <div>
              <span className="text-xs text-muted-foreground block mb-1">Market Trend</span>
              <div className={`flex items-center gap-1.5 font-semibold text-sm ${trendColor}`}>
                <TrendIcon className="w-4 h-4" /> {trend}
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block mb-1">Target Duration</span>
              <div className="font-semibold text-sm text-foreground">{tradeDuration}</div>
            </div>
          </div>
        </div>

        {/* ── Entry / SL / TP ──────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-white/5 rounded-xl p-4 shadow-inner flex flex-col items-center justify-center text-center">
            <ArrowRightCircle className="w-5 h-5 text-primary mb-2 opacity-70" />
            <span className="text-xs text-muted-foreground mb-1">Entry Price</span>
            <span className="text-xl font-bold font-mono text-foreground">{formatPrice(entryPrice)}</span>
          </div>

          <div className="bg-destructive/5 border border-destructive/10 rounded-xl p-4 shadow-inner flex flex-col items-center justify-center text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-destructive/50 to-transparent" />
            <ShieldX className="w-5 h-5 text-destructive mb-2 opacity-70" />
            <span className="text-xs text-destructive/80 mb-1">Stop Loss</span>
            <span className="text-xl font-bold font-mono text-destructive">{formatPrice(stopLoss)}</span>
          </div>

          <div className="bg-success/5 border border-success/10 rounded-xl p-4 shadow-inner flex flex-col items-center justify-center text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-success/50 to-transparent" />
            <Target className="w-5 h-5 text-success mb-2 opacity-70" />
            <span className="text-xs text-success/80 mb-1">Take Profit</span>
            <span className="text-xl font-bold font-mono text-success">{formatPrice(takeProfit)}</span>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div className="text-xs text-muted-foreground/50 text-right font-mono flex justify-end items-center gap-2">
          <span>Generated: {format(new Date(timestamp), "HH:mm:ss 'UTC'")}</span>
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}
