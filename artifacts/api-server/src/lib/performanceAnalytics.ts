import { db, signalsTable } from "@workspace/db";
import { eq, or, desc } from "drizzle-orm";
import { logger } from "./logger.js";

export interface TradeRecord {
  id: number;
  signal: "LONG" | "SHORT";
  result: "WIN" | "LOSS";
  entryPrice: number;
  closedPrice: number;
  pnlPoints: number;
  timestamp: string;
  indicators?: { rsi?: number; macdBull?: boolean; trend5m?: string };
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
}

const CACHE_TTL = 30_000; // 30 seconds
let cachedAnalytics: AnalyticsSummary | null = null;
let lastAnalyticsTime = 0;
let smartModeEnabled = false;

export function isSmartMode(): boolean {
  return smartModeEnabled;
}

export function setSmartMode(enabled: boolean) {
  smartModeEnabled = enabled;
  cachedAnalytics = null; // invalidate cache so status updates immediately
  logger.info({ smartMode: enabled }, "Smart Mode toggled");
}

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
    const losses  = completed.filter(r => r.tradeStatus === "STOP_HIT").length;
    const winRate  = totalCompleted > 0 ? Math.round((wins / totalCompleted) * 100) : 0;
    const lossRate = totalCompleted > 0 ? Math.round((losses / totalCompleted) * 100) : 0;

    const winPnls  = completed.filter(r => r.tradeStatus === "TARGET_HIT").map(r => r.pnlPoints ?? 0);
    const lossPnls = completed.filter(r => r.tradeStatus === "STOP_HIT").map(r => r.pnlPoints ?? 0);

    const avgProfit = winPnls.length > 0 ? winPnls.reduce((s, v) => s + v, 0) / winPnls.length : 0;
    const avgLoss   = lossPnls.length > 0 ? Math.abs(lossPnls.reduce((s, v) => s + v, 0) / lossPnls.length) : 0;
    const expectancy = totalCompleted > 0
      ? (winRate / 100) * avgProfit - (lossRate / 100) * avgLoss
      : 0;

    const last10: TradeRecord[] = completed.slice(0, 10).map(r => ({
      id: r.id,
      signal: r.signal as "LONG" | "SHORT",
      result: r.tradeStatus === "TARGET_HIT" ? "WIN" : "LOSS",
      entryPrice: r.entryPrice,
      closedPrice: r.closedPrice ?? r.entryPrice,
      pnlPoints: r.pnlPoints ?? 0,
      timestamp: r.createdAt.toISOString(),
    }));

    const sufficientData = totalCompleted >= 10;

    // Smart Mode status message
    let smartModeStatus = "OFF – all signals shown";
    if (smartModeEnabled && !sufficientData) {
      smartModeStatus = "ON – building history (need 10+ trades)";
    } else if (smartModeEnabled && winRate >= 60) {
      smartModeStatus = `ON – win rate ${winRate}% ✓ (above 60% threshold)`;
    } else if (smartModeEnabled && winRate < 60) {
      smartModeStatus = `ON – STRICT (win rate ${winRate}% < 60%, raising thresholds)`;
    }

    // Learning status
    let learningStatus: string;
    if (totalCompleted === 0) {
      learningStatus = "Collecting first trades…";
    } else if (totalCompleted < 5) {
      learningStatus = `Early learning (${totalCompleted} trades)`;
    } else if (totalCompleted < 10) {
      learningStatus = `Learning (${totalCompleted} trades, need 10 for full analysis)`;
    } else {
      const trend = last10.filter(t => t.result === "WIN").length;
      const trendLabel = trend >= 7 ? "🔥 Hot streak" : trend <= 3 ? "⚠️ Cold streak" : "Stable";
      learningStatus = `Active – ${totalCompleted} trades, recent: ${trendLabel}`;
    }

    const result: AnalyticsSummary = {
      totalCompleted,
      wins,
      losses,
      winRate,
      lossRate,
      avgProfit: +avgProfit.toFixed(2),
      avgLoss: +avgLoss.toFixed(2),
      expectancy: +expectancy.toFixed(2),
      last10,
      smartMode: smartModeEnabled,
      smartModeStatus,
      learningStatus,
      sufficientData,
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
    };
  }
}
