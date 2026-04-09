import { db, signalsTable } from "@workspace/db";
import { eq, or, desc } from "drizzle-orm";
import { getLSTMStatus as getMLStatus } from "./lstmModel.js";
import { logger } from "./logger.js";

export interface TradeRecord {
  id: number;
  signal: "LONG" | "SHORT";
  result: "WIN" | "LOSS";
  entryPrice: number;
  closedPrice: number;
  pnlPoints: number;
  timestamp: string;
  // SMC conditions at time of signal
  marketStructure?: string | null;
  bosPresent?: boolean | null;
  liquiditySweep?: boolean | null;
  inOrderBlock?: boolean | null;
  smcScore?: number | null;
}

// Per-condition accuracy: win rate when condition was present
export interface ConditionAccuracy {
  label: string;
  key: string;
  tradeCount: number;         // how many trades had this condition
  winRate: number;            // 0-100
  contribution: string;       // "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT"
}

// Adaptive weights for SMC confidence scoring
export interface AdaptiveWeights {
  structure: number;    // out of 25 base → adjusted
  bos: number;          // out of 25 base → adjusted
  liquidity: number;    // out of 20 base → adjusted
  orderBlock: number;   // out of 15 base → adjusted
  rsiMacd: number;      // out of 15 base → adjusted
  // meta
  dataPoints: number;
  adapted: boolean;     // true if enough data to adjust weights
}

export interface AnalyticsSummary {
  totalCompleted: number;
  wins: number;
  losses: number;
  winRate: number;
  lossRate: number;
  avgProfit: number;
  avgLoss: number;
  expectancy: number;
  last10: TradeRecord[];
  smartMode: boolean;
  smartModeStatus: string;
  learningStatus: string;
  sufficientData: boolean;
  conditionAccuracy: ConditionAccuracy[];
  adaptiveWeights: AdaptiveWeights;
  streak: number;
  recentTrend: "HOT" | "COLD" | "STABLE" | "LEARNING";
  // ML neural network model status
  mlModelStatus: "trained" | "training" | "untrained";
  mlTrainedOn:   number;
  mlAccuracy:    number;
}

// ── Base SMC weights ────────────────────────────────────────────────────────
const BASE_WEIGHTS: AdaptiveWeights = {
  structure:  25,
  bos:        25,
  liquidity:  20,
  orderBlock: 15,
  rsiMacd:    15,
  dataPoints: 0,
  adapted:    false,
};

const MIN_DATA_FOR_ADAPTATION = 5; // need ≥5 trades per condition to shift its weight
const MAX_WEIGHT_SHIFT = 8;        // max ±8 pts per condition

// Singleton cache for adaptive weights (updated whenever analytics refresh)
let _adaptiveWeights: AdaptiveWeights = { ...BASE_WEIGHTS };

const CACHE_TTL = 30_000;
let cachedAnalytics: AnalyticsSummary | null = null;
let lastAnalyticsTime = 0;
let smartModeEnabled = false;

export function isSmartMode(): boolean { return smartModeEnabled; }

export function setSmartMode(enabled: boolean) {
  smartModeEnabled = enabled;
  cachedAnalytics = null;
  logger.info({ smartMode: enabled }, "Smart Mode toggled");
}

export function getAdaptiveWeights(): AdaptiveWeights {
  return _adaptiveWeights;
}

// ── Adaptive weight calculation ────────────────────────────────────────────
function computeAdaptiveWeights(
  completed: Array<{
    tradeStatus: string | null;
    marketStructure: string | null | undefined;
    bosPresent: boolean | null | undefined;
    liquiditySweep: boolean | null | undefined;
    inOrderBlock: boolean | null | undefined;
  }>
): AdaptiveWeights {
  // Helper: win rate for a filtered subset
  function conditionWinRate(
    filter: (r: typeof completed[number]) => boolean
  ): { count: number; winRate: number } {
    const subset = completed.filter(filter);
    if (subset.length < MIN_DATA_FOR_ADAPTATION) return { count: subset.length, winRate: -1 };
    const wins = subset.filter(r => r.tradeStatus === "TARGET_HIT").length;
    return { count: subset.length, winRate: Math.round((wins / subset.length) * 100) };
  }

  const structureAligned = conditionWinRate(
    r => r.marketStructure === "UPTREND" || r.marketStructure === "DOWNTREND"
  );
  const bosData = conditionWinRate(r => r.bosPresent === true);
  const liqData = conditionWinRate(r => r.liquiditySweep === true);
  const obData  = conditionWinRate(r => r.inOrderBlock === true);

  // Need at least one condition with enough data to call this "adapted"
  const anySMCData = [structureAligned, bosData, liqData, obData].some(d => d.winRate >= 0);
  if (!anySMCData) {
    return { ...BASE_WEIGHTS, dataPoints: completed.length, adapted: false };
  }

  // Shift: for each condition, deviation from 50% neutral maps to ±MAX_WEIGHT_SHIFT
  function shift(winRate: number): number {
    if (winRate < 0) return 0; // insufficient data — no shift
    const deviation = (winRate - 50) / 50; // -1 to +1
    return Math.round(deviation * MAX_WEIGHT_SHIFT);
  }

  const sShift = shift(structureAligned.winRate);
  const bShift = shift(bosData.winRate);
  const lShift = shift(liqData.winRate);
  const oShift = shift(obData.winRate);

  const raw = {
    structure:  Math.max(5, BASE_WEIGHTS.structure  + sShift),
    bos:        Math.max(5, BASE_WEIGHTS.bos         + bShift),
    liquidity:  Math.max(5, BASE_WEIGHTS.liquidity   + lShift),
    orderBlock: Math.max(5, BASE_WEIGHTS.orderBlock  + oShift),
    rsiMacd:    BASE_WEIGHTS.rsiMacd,
  };

  // Normalise so all 5 sum to 100
  const total = raw.structure + raw.bos + raw.liquidity + raw.orderBlock + raw.rsiMacd;
  const scale = 100 / total;

  return {
    structure:  Math.round(raw.structure  * scale),
    bos:        Math.round(raw.bos        * scale),
    liquidity:  Math.round(raw.liquidity  * scale),
    orderBlock: Math.round(raw.orderBlock * scale),
    rsiMacd:    Math.round(raw.rsiMacd    * scale),
    dataPoints: completed.length,
    adapted:    true,
  };
}

// ── Condition accuracy summary ─────────────────────────────────────────────
function buildConditionAccuracy(
  completed: Array<{
    tradeStatus: string | null;
    marketStructure: string | null | undefined;
    bosPresent: boolean | null | undefined;
    liquiditySweep: boolean | null | undefined;
    inOrderBlock: boolean | null | undefined;
  }>
): ConditionAccuracy[] {
  function calc(
    label: string,
    key: string,
    filter: (r: typeof completed[number]) => boolean
  ): ConditionAccuracy {
    const subset = completed.filter(filter);
    const count = subset.length;
    if (count < MIN_DATA_FOR_ADAPTATION) {
      return { label, key, tradeCount: count, winRate: 0, contribution: "INSUFFICIENT" };
    }
    const wins = subset.filter(r => r.tradeStatus === "TARGET_HIT").length;
    const wr = Math.round((wins / count) * 100);
    const contribution =
      wr >= 65 ? "HIGH" :
      wr >= 50 ? "MEDIUM" :
      "LOW";
    return { label, key, tradeCount: count, winRate: wr, contribution };
  }

  return [
    calc("Market Structure", "structure",
      r => r.marketStructure === "UPTREND" || r.marketStructure === "DOWNTREND"),
    calc("Break of Structure", "bos",
      r => r.bosPresent === true),
    calc("Liquidity Sweep", "liquidity",
      r => r.liquiditySweep === true),
    calc("Order Block", "orderBlock",
      r => r.inOrderBlock === true),
  ];
}

// ── Streak calculation ─────────────────────────────────────────────────────
function calcStreak(last10: TradeRecord[]): number {
  if (last10.length === 0) return 0;
  const first = last10[0].result; // most recent
  let streak = 0;
  for (const t of last10) {
    if (t.result === first) streak++;
    else break;
  }
  return first === "WIN" ? streak : -streak;
}

// ── Main analytics query ───────────────────────────────────────────────────
export async function getAnalyticsSummary(forceRefresh = false): Promise<AnalyticsSummary> {
  const now = Date.now();
  if (!forceRefresh && cachedAnalytics && (now - lastAnalyticsTime) < CACHE_TTL) {
    return cachedAnalytics;
  }

  try {
    const closedRows = await db
      .select()
      .from(signalsTable)
      .where(or(
        eq(signalsTable.tradeStatus, "TARGET_HIT"),
        eq(signalsTable.tradeStatus, "STOP_HIT"),
      ))
      .orderBy(desc(signalsTable.createdAt))
      .limit(200);

    const completed = closedRows.filter(r =>
      (r.signal === "LONG" || r.signal === "SHORT") &&
      r.pnlPoints !== null && r.closedPrice !== null
    );

    const totalCompleted = completed.length;
    const wins   = completed.filter(r => r.tradeStatus === "TARGET_HIT").length;
    const losses = completed.filter(r => r.tradeStatus === "STOP_HIT").length;
    const winRate  = totalCompleted > 0 ? Math.round((wins / totalCompleted) * 100) : 0;
    const lossRate = totalCompleted > 0 ? Math.round((losses / totalCompleted) * 100) : 0;

    const winPnls  = completed.filter(r => r.tradeStatus === "TARGET_HIT").map(r => r.pnlPoints ?? 0);
    const lossPnls = completed.filter(r => r.tradeStatus === "STOP_HIT").map(r => r.pnlPoints ?? 0);

    const avgProfit = winPnls.length > 0
      ? winPnls.reduce((s, v) => s + v, 0) / winPnls.length : 0;
    const avgLoss = lossPnls.length > 0
      ? Math.abs(lossPnls.reduce((s, v) => s + v, 0) / lossPnls.length) : 0;
    const expectancy = totalCompleted > 0
      ? (winRate / 100) * avgProfit - (lossRate / 100) * avgLoss : 0;

    const last10: TradeRecord[] = completed.slice(0, 10).map(r => ({
      id: r.id,
      signal: r.signal as "LONG" | "SHORT",
      result: r.tradeStatus === "TARGET_HIT" ? "WIN" : "LOSS",
      entryPrice:      r.entryPrice,
      closedPrice:     r.closedPrice ?? r.entryPrice,
      pnlPoints:       r.pnlPoints ?? 0,
      timestamp:       r.createdAt.toISOString(),
      marketStructure: r.marketStructure,
      bosPresent:      r.bosPresent,
      liquiditySweep:  r.liquiditySweep,
      inOrderBlock:    r.inOrderBlock,
      smcScore:        r.smcScore,
    }));

    const sufficientData = totalCompleted >= 10;

    // ── Condition accuracy ─────────────────────────────────────────────────
    const conditionAccuracy = buildConditionAccuracy(completed);

    // ── Adaptive weights ───────────────────────────────────────────────────
    const adaptiveWeights = computeAdaptiveWeights(completed);
    _adaptiveWeights = adaptiveWeights; // update singleton for signal engine

    // ── Streak ─────────────────────────────────────────────────────────────
    const streak = calcStreak(last10);

    // ── Recent trend ───────────────────────────────────────────────────────
    const recentWins = last10.slice(0, Math.min(5, last10.length))
      .filter(t => t.result === "WIN").length;
    const recentTotal = Math.min(5, last10.length);
    let recentTrend: AnalyticsSummary["recentTrend"] = "LEARNING";
    if (recentTotal >= 3) {
      const recentWR = recentWins / recentTotal;
      recentTrend = recentWR >= 0.67 ? "HOT" : recentWR <= 0.33 ? "COLD" : "STABLE";
    }

    // ── Status messages ────────────────────────────────────────────────────
    let smartModeStatus = "OFF – all signals shown";
    if (smartModeEnabled && !sufficientData) {
      smartModeStatus = `ON – building history (${totalCompleted}/10 trades needed)`;
    } else if (smartModeEnabled && winRate >= 60) {
      smartModeStatus = `ON – win rate ${winRate}% ✓ (above 60% threshold)`;
    } else if (smartModeEnabled && winRate < 60) {
      smartModeStatus = `ON – STRICT (win rate ${winRate}% < 60%, raising thresholds)`;
    }

    let learningStatus: string;
    if (totalCompleted === 0) {
      learningStatus = "Collecting first trades…";
    } else if (totalCompleted < 5) {
      learningStatus = `Early phase (${totalCompleted} trades) — observing patterns`;
    } else if (totalCompleted < 10) {
      learningStatus = `Learning (${totalCompleted}/10 trades) — weights not yet adapted`;
    } else if (adaptiveWeights.adapted) {
      const highConditions = conditionAccuracy.filter(c => c.contribution === "HIGH").map(c => c.label);
      const lowConditions  = conditionAccuracy.filter(c => c.contribution === "LOW").map(c => c.label);
      let msg = `Adapting weights (${totalCompleted} trades)`;
      if (highConditions.length) msg += ` · High: ${highConditions.join(", ")}`;
      if (lowConditions.length)  msg += ` · Low: ${lowConditions.join(", ")}`;
      learningStatus = msg;
    } else {
      learningStatus = `Active (${totalCompleted} trades) — collecting more data`;
    }

    const result: AnalyticsSummary = {
      totalCompleted,
      wins,
      losses,
      winRate,
      lossRate,
      avgProfit: +avgProfit.toFixed(2),
      avgLoss:   +avgLoss.toFixed(2),
      expectancy: +expectancy.toFixed(2),
      last10,
      smartMode: smartModeEnabled,
      smartModeStatus,
      learningStatus,
      sufficientData,
      conditionAccuracy,
      adaptiveWeights,
      streak,
      recentTrend,
      ...getMLStatus(),
    };

    cachedAnalytics = result;
    lastAnalyticsTime = now;
    return result;

  } catch (err) {
    logger.warn({ err }, "Analytics query failed");
    return {
      totalCompleted: 0, wins: 0, losses: 0,
      winRate: 0, lossRate: 0, avgProfit: 0, avgLoss: 0, expectancy: 0,
      last10: [], smartMode: smartModeEnabled,
      smartModeStatus: "unavailable", learningStatus: "Unavailable",
      sufficientData: false,
      conditionAccuracy: [],
      adaptiveWeights: { ...BASE_WEIGHTS },
      streak: 0,
      recentTrend: "LEARNING",
      ...getMLStatus(),
    };
  }
}
