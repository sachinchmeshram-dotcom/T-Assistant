import { fetchOHLC } from "./goldPrice.js";
import {
  calcEMA,
  calcRSI,
  calcMACD,
  calcATR,
  detectTrend,
  findSupportResistance,
} from "./technicalIndicators.js";
import { getAnalyticsSummary, isSmartMode } from "./performanceAnalytics.js";
import { logger } from "./logger.js";

export interface SignalResult {
  signal: "LONG" | "SHORT" | "HOLD";
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  reason: string;
  timestamp: string;
  tradeDuration: string;
  cooldownRemaining: number;
  smartMode: boolean;
  indicators: {
    rsi: number;
    ema20: number;
    ema50: number;
    ema200: number;
    macdLine: number;
    macdSignal: number;
    macdHistogram: number;
    atr: number;
    trend1h:  "BULLISH" | "BEARISH" | "NEUTRAL";
    trend15m: "BULLISH" | "BEARISH" | "NEUTRAL";
    trend5m:  "BULLISH" | "BEARISH" | "NEUTRAL";
  };
}

interface LastSignalState {
  signal: "LONG" | "SHORT" | "HOLD";
  price: number;
  timestamp: number;
}

let lastSignalState: LastSignalState | null = null;
let cachedSignal: SignalResult | null = null;
let lastSignalTime = 0;

const SIGNAL_CACHE_TTL   = 60_000;
const COOLDOWN_MS        = 300_000;
const MIN_PRICE_MOVE_PCT = 0.001;

// ── Weighted confidence helpers (Trend 40%, RSI 30%, MACD 30%) ────────────
function trendConfScore(
  t15m: string, t5m: string, t1m: string,
  signal: "LONG" | "SHORT"
): number {
  const match = (t: string) =>
    (signal === "LONG" && t === "BULLISH") || (signal === "SHORT" && t === "BEARISH");
  const count = [t15m, t5m, t1m].filter(match).length;
  if (count === 3) return 100;
  if (count === 2) return 65;
  if (count === 1) return 30;
  return 0;
}

function rsiConfScore(rsi: number, signal: "LONG" | "SHORT"): number {
  if (signal === "LONG") {
    if (rsi < 30) return 85;                        // oversold bounce
    if (rsi >= 35 && rsi <= 55) return 95;          // ideal long zone
    if (rsi > 55 && rsi <= 63) return 65;           // ok but elevated
    if (rsi > 63) return 15;                        // overbought, risky long
    return 45;
  } else {
    if (rsi > 70) return 85;                        // overbought reversal
    if (rsi >= 45 && rsi <= 65) return 95;          // ideal short zone
    if (rsi >= 37 && rsi < 45) return 65;           // ok but low
    if (rsi < 37) return 15;                        // oversold, risky short
    return 45;
  }
}

function macdConfScore(
  macdBullCross: boolean, macdBearCross: boolean,
  macdBullish: boolean, macdBearish: boolean,
  signal: "LONG" | "SHORT"
): number {
  if (signal === "LONG") {
    if (macdBullCross) return 100;
    if (macdBullish)   return 75;
    return 25;
  } else {
    if (macdBearCross) return 100;
    if (macdBearish)   return 75;
    return 25;
  }
}

function overallTrend(
  t15: string, t5: string, t1: string,
): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const score =
    (t15 === "BULLISH" ? 1 : t15 === "BEARISH" ? -1 : 0) +
    (t5  === "BULLISH" ? 1 : t5  === "BEARISH" ? -1 : 0) +
    (t1  === "BULLISH" ? 1 : t1  === "BEARISH" ? -1 : 0);
  if (score >= 2) return "BULLISH";
  if (score <= -2) return "BEARISH";
  return "NEUTRAL";
}

export async function generateSignal(currentPrice: number): Promise<SignalResult> {
  const now = Date.now();
  const sinceLastSignal = now - lastSignalTime;
  const cooldownRemaining = Math.max(0, Math.ceil((COOLDOWN_MS - sinceLastSignal) / 1000));
  const smartMode = isSmartMode();

  if (cachedSignal && sinceLastSignal < SIGNAL_CACHE_TTL) {
    return { ...cachedSignal, cooldownRemaining, smartMode };
  }

  // Fetch analytics for smart mode gating
  const analytics = await getAnalyticsSummary();

  // Dynamic thresholds
  let MIN_SIGNAL_POINTS = 6;
  let MIN_CONFIDENCE    = 52;
  let MIN_SEPARATION    = 2;

  if (smartMode && analytics.sufficientData && analytics.winRate < 60) {
    // Strict mode: recent performance is poor — demand stronger signals
    MIN_SIGNAL_POINTS = 9;
    MIN_CONFIDENCE    = 68;
    MIN_SEPARATION    = 3;
  } else if (smartMode && analytics.sufficientData && analytics.winRate >= 60) {
    // Performing well — slightly looser
    MIN_SIGNAL_POINTS = 5;
    MIN_CONFIDENCE    = 48;
    MIN_SEPARATION    = 2;
  }

  try {
    const [candles15m, candles5m, candles1m] = await Promise.all([
      fetchOHLC("15m"),
      fetchOHLC("5m"),
      fetchOHLC("1m"),
    ]);

    const closes15m = candles15m.map(c => c.close);
    const closes5m  = candles5m.map(c => c.close);
    const closes1m  = candles1m.map(c => c.close);

    // EMAs
    const ema9_1m   = calcEMA(closes1m, 9);
    const ema21_1m  = calcEMA(closes1m, 21);
    const ema20_5m  = calcEMA(closes5m, 20);
    const ema50_5m  = calcEMA(closes5m, 50);
    const ema20_15m = calcEMA(closes15m, 20);
    const ema50_15m = calcEMA(closes15m, 50);

    const ema9   = ema9_1m[ema9_1m.length - 1]   ?? currentPrice;
    const ema21  = ema21_1m[ema21_1m.length - 1]  ?? currentPrice;
    const ema20  = ema20_5m[ema20_5m.length - 1]  ?? currentPrice;
    const ema50  = ema50_5m[ema50_5m.length - 1]  ?? currentPrice;
    const ema200 = ema20_15m[ema20_15m.length - 1] ?? currentPrice;

    // Trends
    const trend15m = detectTrend(ema20_15m, ema50_15m);
    const trend5m  = detectTrend(ema20_5m, ema50_5m);
    const trend1m  = detectTrend(ema9_1m, ema21_1m);
    const htTrend  = overallTrend(trend15m, trend5m, trend1m);

    // RSI
    const rsi5mArr   = calcRSI(closes5m, 14);
    const rsi        = rsi5mArr[rsi5mArr.length - 1] ?? 50;
    const rsiPrev    = rsi5mArr[rsi5mArr.length - 2] ?? 50;
    const rsiPrev2   = rsi5mArr[rsi5mArr.length - 3] ?? 50;
    const rsiRising  = rsi > rsiPrev;
    const rsiFalling = rsi < rsiPrev;
    const rsiWasRising = rsiPrev > rsiPrev2;

    const rsi1mArr   = calcRSI(closes1m, 9);
    const rsi1m      = rsi1mArr[rsi1mArr.length - 1] ?? 50;
    const rsi1mPrev  = rsi1mArr[rsi1mArr.length - 2] ?? 50;
    const rsi1mRising  = rsi1m > rsi1mPrev;
    const rsi1mFalling = rsi1m < rsi1mPrev;

    // MACD
    const { macdLine, signalLine, histogram } = calcMACD(closes5m);
    const macdVal      = macdLine[macdLine.length - 1] ?? 0;
    const macdSig      = signalLine[signalLine.length - 1] ?? 0;
    const macdHist     = histogram[histogram.length - 1] ?? 0;
    const macdPrevHist = histogram[histogram.length - 2] ?? 0;

    const macdBullCross = macdPrevHist < 0 && macdHist >= 0;
    const macdBearCross = macdPrevHist > 0 && macdHist <= 0;
    const macdBullish   = macdHist > 0 && macdHist > macdPrevHist;
    const macdBearish   = macdHist < 0 && macdHist < macdPrevHist;
    const macdImproving = macdHist > macdPrevHist;
    const macdWeakening = macdHist < macdPrevHist;

    // ATR
    const atrArr = calcATR(candles1m, 14);
    const atr    = atrArr[atrArr.length - 1] ?? 3;

    // S/R
    const { support, resistance } = findSupportResistance(candles5m, 20);
    const nearSupport    = currentPrice <= support * 1.004;
    const nearResistance = currentPrice >= resistance * 0.996;
    const atResistance   = currentPrice >= resistance * 0.999;
    const atSupport      = currentPrice <= support * 1.001;

    // Extension
    const distFromEma20pct = ((currentPrice - ema20) / ema20) * 100;
    const priceExtendedUp  = distFromEma20pct > 0.4;
    const priceExtendedDn  = distFromEma20pct < -0.4;

    // ═══ SCORING ═══════════════════════════════════════════════════════════
    const longPoints:  Array<{ reason: string; pts: number }> = [];
    const shortPoints: Array<{ reason: string; pts: number }> = [];

    // 1. 15m trend (context)
    if (trend15m === "BULLISH") longPoints.push({ reason: "15m bullish (context)", pts: 1 });
    if (trend15m === "BEARISH") shortPoints.push({ reason: "15m bearish (context)", pts: 1 });

    // 2. 5m trend (primary)
    if (trend5m === "BULLISH") longPoints.push({ reason: "5m trend bullish", pts: 2 });
    if (trend5m === "BEARISH") shortPoints.push({ reason: "5m trend bearish", pts: 2 });

    // 3. 1m EMA crossover (entry timing)
    if (ema9 > ema21) longPoints.push({ reason: "1m EMA9>EMA21 crossover", pts: 2 });
    if (ema9 < ema21) shortPoints.push({ reason: "1m EMA9<EMA21 crossover", pts: 2 });

    // 4. RSI 5m trend-following
    if (rsi >= 40 && rsi <= 62 && rsiRising)   longPoints.push({ reason: `5m RSI ${rsi.toFixed(0)} rising`, pts: 2 });
    else if (rsi < 40 && rsi >= 30 && rsiRising) longPoints.push({ reason: `5m RSI ${rsi.toFixed(0)} rising from OS`, pts: 2 });
    else if (rsi > 50 && rsiRising)              longPoints.push({ reason: `5m RSI ${rsi.toFixed(0)} >50 rising`, pts: 1 });

    if (rsi >= 38 && rsi <= 60 && rsiFalling)   shortPoints.push({ reason: `5m RSI ${rsi.toFixed(0)} falling`, pts: 2 });
    else if (rsi > 60 && rsi <= 70 && rsiFalling) shortPoints.push({ reason: `5m RSI ${rsi.toFixed(0)} falling from high`, pts: 2 });
    else if (rsi < 50 && rsiFalling)              shortPoints.push({ reason: `5m RSI ${rsi.toFixed(0)} <50 falling`, pts: 1 });

    // 5. RSI extreme reversals
    if (rsi >= 72) shortPoints.push({ reason: `5m RSI OB ${rsi.toFixed(0)} – reversal`, pts: rsi >= 78 ? 4 : 3 });
    if (rsi <= 28) longPoints.push({ reason: `5m RSI OS ${rsi.toFixed(0)} – reversal`, pts: rsi <= 22 ? 4 : 3 });

    // 6. RSI peak/trough
    if (rsi < rsiPrev && rsiWasRising && rsi >= 60)  shortPoints.push({ reason: `RSI peaked at ${rsiPrev.toFixed(0)}`, pts: 2 });
    if (rsi > rsiPrev && !rsiWasRising && rsi <= 40) longPoints.push({ reason: `RSI troughed at ${rsiPrev.toFixed(0)}`, pts: 2 });

    // 7. 1m RSI momentum
    if (rsi1mRising)  longPoints.push({ reason: `1m RSI up (${rsi1m.toFixed(0)})`, pts: 1 });
    if (rsi1mFalling) shortPoints.push({ reason: `1m RSI down (${rsi1m.toFixed(0)})`, pts: 1 });

    // 8. MACD
    if (macdBullCross)      longPoints.push({ reason: "5m MACD zero-line bull cross", pts: 3 });
    else if (macdBullish)   longPoints.push({ reason: "5m MACD bullish & growing", pts: 2 });
    else if (macdImproving && macdVal > 0) longPoints.push({ reason: "5m MACD positive improving", pts: 1 });

    if (macdBearCross)      shortPoints.push({ reason: "5m MACD zero-line bear cross", pts: 3 });
    else if (macdBearish)   shortPoints.push({ reason: "5m MACD bearish & deepening", pts: 2 });
    else if (macdWeakening && macdVal < 0) shortPoints.push({ reason: "5m MACD negative weakening", pts: 1 });

    // 9. EMA price structure
    if (ema20 > ema50 && currentPrice > ema20)       longPoints.push({ reason: "price above 5m EMA20>EMA50", pts: 1 });
    else if (ema20 > ema50)                           longPoints.push({ reason: "5m EMA20>EMA50 structure", pts: 1 });
    if (ema20 < ema50 && currentPrice < ema20)       shortPoints.push({ reason: "price below 5m EMA20<EMA50", pts: 1 });
    else if (ema20 < ema50)                           shortPoints.push({ reason: "5m EMA20<EMA50 structure", pts: 1 });

    // 10. S/R
    if (atSupport)       longPoints.push({ reason: "at support", pts: 2 });
    else if (nearSupport) longPoints.push({ reason: "near support", pts: 1 });
    if (atResistance)       shortPoints.push({ reason: "at resistance", pts: 2 });
    else if (nearResistance) shortPoints.push({ reason: "near resistance", pts: 1 });

    // 11. Mean-reversion
    if (priceExtendedUp && (rsi > 65 || macdWeakening)) shortPoints.push({ reason: `+${distFromEma20pct.toFixed(2)}% extended above EMA`, pts: 2 });
    if (priceExtendedDn && (rsi < 35 || macdImproving))  longPoints.push({ reason: `${distFromEma20pct.toFixed(2)}% extended below EMA`, pts: 2 });

    const longTotal  = longPoints.reduce((s, p) => s + p.pts, 0);
    const shortTotal = shortPoints.reduce((s, p) => s + p.pts, 0);

    let rawSignal: "LONG" | "SHORT" | "HOLD" = "HOLD";
    if (longTotal >= MIN_SIGNAL_POINTS && longTotal > shortTotal + MIN_SEPARATION) rawSignal = "LONG";
    else if (shortTotal >= MIN_SIGNAL_POINTS && shortTotal > longTotal + MIN_SEPARATION) rawSignal = "SHORT";

    // Cooldown guard
    const inCooldown     = sinceLastSignal < COOLDOWN_MS;
    const priceMoved     = lastSignalState
      ? Math.abs(currentPrice - lastSignalState.price) / lastSignalState.price >= MIN_PRICE_MOVE_PCT
      : true;
    const oppositeSignal = lastSignalState && rawSignal !== "HOLD" && rawSignal !== lastSignalState.signal;

    let finalSignal: "LONG" | "SHORT" | "HOLD" = rawSignal;
    if (rawSignal !== "HOLD" && inCooldown && !priceMoved && !oppositeSignal) {
      finalSignal = "HOLD";
    }

    // ═══ WEIGHTED CONFIDENCE: Trend 40% + RSI 30% + MACD 30% ═══════════
    let confidence = 0;
    if (finalSignal !== "HOLD") {
      const tScore = trendConfScore(trend15m, trend5m, trend1m, finalSignal) * 0.40;
      const rScore = rsiConfScore(rsi, finalSignal) * 0.30;
      const mScore = macdConfScore(macdBullCross, macdBearCross, macdBullish, macdBearish, finalSignal) * 0.30;
      confidence = Math.round(Math.min(100, tScore + rScore + mScore));
    } else {
      // For HOLD, show the highest potential confidence
      const bestSide = longTotal >= shortTotal ? "LONG" : "SHORT";
      const tScore = trendConfScore(trend15m, trend5m, trend1m, bestSide) * 0.40;
      const rScore = rsiConfScore(rsi, bestSide) * 0.30;
      const mScore = macdConfScore(macdBullCross, macdBearCross, macdBullish, macdBearish, bestSide) * 0.30;
      confidence = Math.round(Math.min(100, tScore + rScore + mScore));
    }

    // Confidence gate
    if (confidence < MIN_CONFIDENCE && finalSignal !== "HOLD") {
      finalSignal = "HOLD";
    }

    // SL / TP
    const slDist = Math.max(atr * 1.0, 2);
    let stopLoss: number;
    let takeProfit: number;

    if (finalSignal === "LONG") {
      stopLoss   = +(Math.min(currentPrice - slDist, support - 0.25)).toFixed(2);
      takeProfit = +(currentPrice + slDist * 1.5).toFixed(2);
    } else if (finalSignal === "SHORT") {
      stopLoss   = +(Math.max(currentPrice + slDist, resistance + 0.25)).toFixed(2);
      takeProfit = +(currentPrice - slDist * 1.5).toFixed(2);
    } else {
      stopLoss   = +(currentPrice - slDist).toFixed(2);
      takeProfit = +(currentPrice + slDist * 1.5).toFixed(2);
    }

    // Reason
    let reason: string;
    if (finalSignal === "LONG") {
      const top = longPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `LONG scalp: ${top.join("; ")}`;
    } else if (finalSignal === "SHORT") {
      const top = shortPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `SHORT scalp: ${top.join("; ")}`;
    } else if (rawSignal !== "HOLD" && inCooldown) {
      reason = `HOLD – cooldown (${Math.ceil(cooldownRemaining / 60)}m). Wait for price confirmation.`;
    } else if (smartMode && analytics.sufficientData && analytics.winRate < 60) {
      reason = `HOLD – Smart Mode STRICT: win rate ${analytics.winRate}% <60%, signals suppressed until confluence improves (long:${longTotal}, short:${shortTotal}, need ≥${MIN_SIGNAL_POINTS})`;
    } else {
      reason = `HOLD – signals mixed (long:${longTotal}, short:${shortTotal}, need ≥${MIN_SIGNAL_POINTS} pts with ${MIN_SEPARATION}+ gap)`;
    }

    if (finalSignal !== "HOLD") {
      lastSignalState = { signal: finalSignal, price: currentPrice, timestamp: now };
      lastSignalTime  = now;
    }

    const result: SignalResult = {
      signal: finalSignal,
      confidence,
      entryPrice:  +currentPrice.toFixed(2),
      stopLoss,
      takeProfit,
      trend: htTrend,
      reason,
      timestamp:     new Date().toISOString(),
      tradeDuration: "5-15 minutes",
      cooldownRemaining: finalSignal !== "HOLD" ? 0 : cooldownRemaining,
      smartMode,
      indicators: {
        rsi:           +rsi.toFixed(2),
        ema20:         +ema20.toFixed(2),
        ema50:         +ema50.toFixed(2),
        ema200:        +ema200.toFixed(2),
        macdLine:      +macdVal.toFixed(4),
        macdSignal:    +macdSig.toFixed(4),
        macdHistogram: +macdHist.toFixed(4),
        atr:           +atr.toFixed(2),
        trend1h:  trend15m,
        trend15m: trend5m,
        trend5m:  trend1m,
      },
    };

    cachedSignal = result;
    return result;

  } catch (err) {
    logger.error({ err }, "Signal generation error");
    const slDist = 4;
    return {
      signal: "HOLD",
      confidence: 0,
      entryPrice: +currentPrice.toFixed(2),
      stopLoss: +(currentPrice - slDist).toFixed(2),
      takeProfit: +(currentPrice + slDist * 1.5).toFixed(2),
      trend: "NEUTRAL",
      reason: "HOLD – market data unavailable",
      timestamp: new Date().toISOString(),
      tradeDuration: "5-15 minutes",
      cooldownRemaining,
      smartMode,
      indicators: {
        rsi: 50, ema20: currentPrice, ema50: currentPrice, ema200: currentPrice,
        macdLine: 0, macdSignal: 0, macdHistogram: 0, atr: 3,
        trend1h: "NEUTRAL", trend15m: "NEUTRAL", trend5m: "NEUTRAL",
      },
    };
  }
}
