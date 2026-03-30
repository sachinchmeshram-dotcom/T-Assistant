import { fetchOHLC } from "./goldPrice.js";
import {
  calcEMA,
  calcRSI,
  calcMACD,
  calcATR,
  detectTrend,
  findSupportResistance,
} from "./technicalIndicators.js";
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
  indicators: {
    rsi: number;
    ema20: number;
    ema50: number;
    ema200: number;
    macdLine: number;
    macdSignal: number;
    macdHistogram: number;
    atr: number;
    // field names kept stable for API compat; values are scalping TFs
    trend1h:  "BULLISH" | "BEARISH" | "NEUTRAL"; // 15m context
    trend15m: "BULLISH" | "BEARISH" | "NEUTRAL"; // 5m confirmation
    trend5m:  "BULLISH" | "BEARISH" | "NEUTRAL"; // 1m entry
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

// Scalping settings
const SIGNAL_CACHE_TTL   = 60_000;  // Refresh signal every 60s
const COOLDOWN_MS        = 300_000; // 5-minute cooldown between signals
const MIN_PRICE_MOVE_PCT = 0.001;   // 0.1% price move breaks cooldown (scalping)
const MIN_CONFIDENCE     = 55;

// Weighted multi-timeframe score: 15m=±2 (context), 5m=±2 (confirm), 1m=±1 (entry)
function calcTrendScore(
  trend15m: "BULLISH" | "BEARISH" | "NEUTRAL",
  trend5m:  "BULLISH" | "BEARISH" | "NEUTRAL",
  trend1m:  "BULLISH" | "BEARISH" | "NEUTRAL",
): number {
  const w = (t: "BULLISH" | "BEARISH" | "NEUTRAL", pts: number) =>
    t === "BULLISH" ? pts : t === "BEARISH" ? -pts : 0;
  return w(trend15m, 2) + w(trend5m, 2) + w(trend1m, 1);
}

function scoreTrend(score: number): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (score >= 3) return "BULLISH";
  if (score <= -3) return "BEARISH";
  return "NEUTRAL";
}

export async function generateSignal(currentPrice: number): Promise<SignalResult> {
  const now = Date.now();
  const sinceLastSignal = now - lastSignalTime;
  const cooldownRemaining = Math.max(0, Math.ceil((COOLDOWN_MS - sinceLastSignal) / 1000));

  if (cachedSignal && sinceLastSignal < SIGNAL_CACHE_TTL) {
    return { ...cachedSignal, cooldownRemaining };
  }

  try {
    // Scalping timeframes: 15m (context), 5m (confirmation), 1m (entry)
    const [candles15m, candles5m, candles1m] = await Promise.all([
      fetchOHLC("15m"),
      fetchOHLC("5m"),
      fetchOHLC("1m"),
    ]);

    const closes15m = candles15m.map(c => c.close);
    const closes5m  = candles5m.map(c => c.close);
    const closes1m  = candles1m.map(c => c.close);

    // EMAs per timeframe
    const ema9_1m   = calcEMA(closes1m, 9);
    const ema21_1m  = calcEMA(closes1m, 21);
    const ema20_5m  = calcEMA(closes5m, 20);
    const ema50_5m  = calcEMA(closes5m, 50);
    const ema20_15m = calcEMA(closes15m, 20);
    const ema50_15m = calcEMA(closes15m, 50);

    // Trend per timeframe
    const trend15m = detectTrend(ema20_15m, ema50_15m);
    const trend5m  = detectTrend(ema20_5m, ema50_5m);
    const trend1m  = detectTrend(ema9_1m, ema21_1m);

    const trendScore = calcTrendScore(trend15m, trend5m, trend1m);
    const htTrend    = scoreTrend(trendScore);

    // RSI on 5m (fast oscillator for scalping)
    const rsiArr5m = calcRSI(closes5m, 14);
    const rsi      = rsiArr5m[rsiArr5m.length - 1] ?? 50;
    const rsiPrev  = rsiArr5m[rsiArr5m.length - 2] ?? 50;
    const rsiPrev2 = rsiArr5m[rsiArr5m.length - 3] ?? 50;
    const rsiRising  = rsi > rsiPrev && rsiPrev >= rsiPrev2;
    const rsiFalling = rsi < rsiPrev && rsiPrev <= rsiPrev2;

    // Stochastic-like RSI momentum (1m for fast entry)
    const rsiArr1m  = calcRSI(closes1m, 9);
    const rsi1m     = rsiArr1m[rsiArr1m.length - 1] ?? 50;
    const rsi1mPrev = rsiArr1m[rsiArr1m.length - 2] ?? 50;
    const rsi1mRising  = rsi1m > rsi1mPrev;
    const rsi1mFalling = rsi1m < rsi1mPrev;

    // MACD on 5m
    const { macdLine, signalLine, histogram } = calcMACD(closes5m);
    const macdVal      = macdLine[macdLine.length - 1] ?? 0;
    const macdSig      = signalLine[signalLine.length - 1] ?? 0;
    const macdHist     = histogram[histogram.length - 1] ?? 0;
    const macdPrevHist = histogram[histogram.length - 2] ?? 0;
    const macdBullish  = (macdHist > 0 && macdHist > macdPrevHist) || (macdVal > macdSig && macdPrevHist <= 0 && macdHist > 0);
    const macdBearish  = (macdHist < 0 && macdHist < macdPrevHist) || (macdVal < macdSig && macdPrevHist >= 0 && macdHist < 0);
    const macdImproving = macdHist > macdPrevHist;
    const macdWeakening = macdHist < macdPrevHist;

    // ATR on 1m (scalping SL/TP basis)
    const atrArr1m = calcATR(candles1m, 14);
    const atr = atrArr1m[atrArr1m.length - 1] ?? 3;

    // Support/Resistance on 5m (scalping levels — tighter window)
    const { support, resistance } = findSupportResistance(candles5m, 15);
    const nearSupport    = currentPrice <= support * 1.003;
    const nearResistance = currentPrice >= resistance * 0.997;

    // Current EMA values for display (5m context)
    const ema20  = ema20_5m[ema20_5m.length - 1]   ?? currentPrice;
    const ema50  = ema50_5m[ema50_5m.length - 1]   ?? currentPrice;
    const ema200 = ema50_15m[ema50_15m.length - 1] ?? currentPrice; // Use 15m EMA50 as proxy for 200

    // ─── LONG scoring ──────────────────────────────────────────────────────
    const longPoints:  Array<{ reason: string; pts: number }> = [];
    const shortPoints: Array<{ reason: string; pts: number }> = [];

    // Multi-TF trend
    if (trendScore >= 3) {
      longPoints.push({ reason: "all scalping TFs aligned bullish (15m+5m+1m)", pts: 4 });
    } else if (trendScore === 2) {
      longPoints.push({ reason: "15m+5m bullish (scalp context ok)", pts: 2 });
    } else if (trendScore === 1) {
      longPoints.push({ reason: "majority TFs slightly bullish", pts: 1 });
    } else if (trendScore === -1) {
      shortPoints.push({ reason: "majority TFs slightly bearish", pts: 1 });
    } else if (trendScore === -2) {
      shortPoints.push({ reason: "15m+5m bearish (scalp context ok)", pts: 2 });
    } else if (trendScore <= -3) {
      shortPoints.push({ reason: "all scalping TFs aligned bearish (15m+5m+1m)", pts: 4 });
    }

    // RSI 5m – LONG
    if (rsi > 45 && rsi < 68 && rsiRising) {
      longPoints.push({ reason: `5m RSI rising (${rsi.toFixed(1)})`, pts: 2 });
    } else if (rsi < 35) {
      longPoints.push({ reason: `5m RSI oversold at ${rsi.toFixed(1)} – reversal`, pts: 2 });
    } else if (rsi > 50 && rsiRising) {
      longPoints.push({ reason: `5m RSI above 50 rising (${rsi.toFixed(1)})`, pts: 1 });
    }

    // RSI 5m – SHORT
    if (rsi < 55 && rsi > 32 && rsiFalling) {
      shortPoints.push({ reason: `5m RSI falling (${rsi.toFixed(1)})`, pts: 2 });
    } else if (rsi > 65) {
      shortPoints.push({ reason: `5m RSI overbought at ${rsi.toFixed(1)} – reversal`, pts: 2 });
    } else if (rsi < 50 && rsiFalling) {
      shortPoints.push({ reason: `5m RSI below 50 falling (${rsi.toFixed(1)})`, pts: 1 });
    }

    // 1m RSI momentum filter (entry timing)
    if (rsi1mRising)  longPoints.push({ reason:  `1m RSI momentum up (${rsi1m.toFixed(1)})`, pts: 1 });
    if (rsi1mFalling) shortPoints.push({ reason: `1m RSI momentum down (${rsi1m.toFixed(1)})`, pts: 1 });

    // EMA structure (5m)
    if (ema20 > ema50 && currentPrice > ema20) {
      longPoints.push({ reason: "5m EMA20>EMA50, price above EMA20", pts: 2 });
    } else if (ema20 > ema50) {
      longPoints.push({ reason: "5m EMA20>EMA50 bullish structure", pts: 1 });
    }

    if (ema20 < ema50 && currentPrice < ema20) {
      shortPoints.push({ reason: "5m EMA20<EMA50, price below EMA20", pts: 2 });
    } else if (ema20 < ema50) {
      shortPoints.push({ reason: "5m EMA20<EMA50 bearish structure", pts: 1 });
    }

    // 1m EMA crossover (fast entry signal)
    const ema9  = ema9_1m[ema9_1m.length - 1]  ?? currentPrice;
    const ema21 = ema21_1m[ema21_1m.length - 1] ?? currentPrice;
    if (ema9 > ema21) longPoints.push({ reason:  "1m EMA9>EMA21 crossover (long entry)", pts: 2 });
    if (ema9 < ema21) shortPoints.push({ reason: "1m EMA9<EMA21 crossover (short entry)", pts: 2 });

    // MACD (5m)
    if (macdBullish) {
      longPoints.push({ reason: "5m MACD bullish cross / momentum up", pts: 2 });
    } else if (macdImproving && macdVal > 0) {
      longPoints.push({ reason: "5m MACD positive and improving", pts: 1 });
    }

    if (macdBearish) {
      shortPoints.push({ reason: "5m MACD bearish cross / momentum down", pts: 2 });
    } else if (macdWeakening && macdVal < 0) {
      shortPoints.push({ reason: "5m MACD negative and weakening", pts: 1 });
    }

    // S/R (tight scalping zones)
    if (nearSupport)    longPoints.push({ reason:  "price at scalping support zone", pts: 1 });
    if (nearResistance) shortPoints.push({ reason: "price at scalping resistance zone", pts: 1 });

    const longTotal  = longPoints.reduce((s, p) => s + p.pts, 0);
    const shortTotal = shortPoints.reduce((s, p) => s + p.pts, 0);

    // Scalping requires strong confluence — higher minimum
    const MIN_SIGNAL_POINTS = 7;

    let rawSignal: "LONG" | "SHORT" | "HOLD" = "HOLD";
    if (longTotal >= MIN_SIGNAL_POINTS && longTotal > shortTotal + 2) {
      rawSignal = "LONG";
    } else if (shortTotal >= MIN_SIGNAL_POINTS && shortTotal > longTotal + 2) {
      rawSignal = "SHORT";
    }

    // ─── Cooldown guard ────────────────────────────────────────────────────
    const inCooldown     = sinceLastSignal < COOLDOWN_MS;
    const priceMoved     = lastSignalState
      ? Math.abs(currentPrice - lastSignalState.price) / lastSignalState.price >= MIN_PRICE_MOVE_PCT
      : true;
    const oppositeSignal = lastSignalState && rawSignal !== "HOLD" && rawSignal !== lastSignalState.signal;

    let finalSignal: "LONG" | "SHORT" | "HOLD" = rawSignal;
    if (rawSignal !== "HOLD" && inCooldown && !priceMoved && !oppositeSignal) {
      finalSignal = "HOLD";
    }

    // ─── Confidence ────────────────────────────────────────────────────────
    const absScore      = Math.abs(trendScore);
    const trendConf     = Math.min(30, (absScore / 5) * 30);  // max score = 5

    const activeTotal   = finalSignal === "LONG" ? longTotal : finalSignal === "SHORT" ? shortTotal : Math.max(longTotal, shortTotal);
    const indicatorConf = Math.min(25, (activeTotal / 14) * 25);

    const rsiDev        = Math.abs(rsi - 50);
    const momentumConf  = Math.min(20, (rsiDev / 25) * 20);

    // ATR healthy range for 1m gold
    const atrAvg   = 3;
    const atrRatio = atr / atrAvg;
    const volConf  = atrRatio >= 0.4 && atrRatio <= 2.5 ? 15 : 5;

    const srConf = (nearSupport && finalSignal === "LONG") ||
                   (nearResistance && finalSignal === "SHORT") ? 10 : 5;

    const confidence = Math.round(Math.min(100, trendConf + indicatorConf + momentumConf + volConf + srConf));

    if (confidence < MIN_CONFIDENCE && finalSignal !== "HOLD") {
      finalSignal = "HOLD";
    }

    // ─── Stop Loss / Take Profit (scalping — very tight) ─────────────────
    // SL = ATR × 1.0, TP = ATR × 1.5 → 1:1.5 RR
    const slDist = Math.max(atr * 1.0, 2); // minimum $2 SL for scalping

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

    // ─── Reason ────────────────────────────────────────────────────────────
    let reason: string;
    if (finalSignal === "LONG") {
      const top = longPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `LONG scalp because: ${top.join("; ")}`;
    } else if (finalSignal === "SHORT") {
      const top = shortPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `SHORT scalp because: ${top.join("; ")}`;
    } else if (rawSignal !== "HOLD" && inCooldown) {
      reason = `HOLD – scalping cooldown (${Math.ceil(cooldownRemaining / 60)}m remaining), price move insufficient`;
    } else {
      reason = `HOLD – confluence insufficient for scalping (long: ${longTotal}, short: ${shortTotal}). Need ≥7 pts with 2+ separation.`;
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
      indicators: {
        rsi:           +rsi.toFixed(2),
        ema20:         +ema20.toFixed(2),
        ema50:         +ema50.toFixed(2),
        ema200:        +ema200.toFixed(2),
        macdLine:      +macdVal.toFixed(4),
        macdSignal:    +macdSig.toFixed(4),
        macdHistogram: +macdHist.toFixed(4),
        atr:           +atr.toFixed(2),
        // API field names kept stable; values now represent scalping TFs
        trend1h:  trend15m, // 15m context
        trend15m: trend5m,  // 5m confirmation
        trend5m:  trend1m,  // 1m entry timing
      },
    };

    cachedSignal = result;
    return result;

  } catch (err) {
    logger.error({ err }, "Scalping signal generation error");
    const slDist = 4;
    return {
      signal: "HOLD",
      confidence: 0,
      entryPrice:  +currentPrice.toFixed(2),
      stopLoss:    +(currentPrice - slDist).toFixed(2),
      takeProfit:  +(currentPrice + slDist * 1.5).toFixed(2),
      trend: "NEUTRAL",
      reason: "HOLD – unable to fetch market data. Please retry.",
      timestamp: new Date().toISOString(),
      tradeDuration: "5-15 minutes",
      cooldownRemaining,
      indicators: {
        rsi: 50, ema20: currentPrice, ema50: currentPrice, ema200: currentPrice,
        macdLine: 0, macdSignal: 0, macdHistogram: 0, atr: 3,
        trend1h: "NEUTRAL", trend15m: "NEUTRAL", trend5m: "NEUTRAL",
      },
    };
  }
}
