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
    trend1h: "BULLISH" | "BEARISH" | "NEUTRAL";
    trend15m: "BULLISH" | "BEARISH" | "NEUTRAL";
    trend5m: "BULLISH" | "BEARISH" | "NEUTRAL";
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

const SIGNAL_CACHE_TTL = 120_000;   // 2 minutes (faster refresh for intraday)
const COOLDOWN_MS = 900_000;        // 15 minutes cooldown (intraday)
const MIN_PRICE_MOVE_PCT = 0.003;   // 0.3% price move breaks cooldown (tighter for intraday)
const MIN_CONFIDENCE = 55;          // Below this → HOLD

// Weighted multi-timeframe trend score for intraday: 1H=±2, 15m=±1, 5m=±1
function calcTrendScore(
  trend1h:  "BULLISH" | "BEARISH" | "NEUTRAL",
  trend15m: "BULLISH" | "BEARISH" | "NEUTRAL",
  trend5m:  "BULLISH" | "BEARISH" | "NEUTRAL",
): number {
  const weight = (t: "BULLISH" | "BEARISH" | "NEUTRAL", w: number) =>
    t === "BULLISH" ? w : t === "BEARISH" ? -w : 0;
  return weight(trend1h, 2) + weight(trend15m, 1) + weight(trend5m, 1);
}

function scoreTrend(score: number): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (score >= 2) return "BULLISH";
  if (score <= -2) return "BEARISH";
  return "NEUTRAL";
}

export async function generateSignal(currentPrice: number): Promise<SignalResult> {
  const now = Date.now();
  const sinceLastSignal = now - lastSignalTime;
  const cooldownRemaining = Math.max(0, Math.ceil((COOLDOWN_MS - sinceLastSignal) / 1000));

  // Return cached signal if still fresh
  if (cachedSignal && sinceLastSignal < SIGNAL_CACHE_TTL) {
    return { ...cachedSignal, cooldownRemaining };
  }

  try {
    // Intraday timeframes: 1H (trend), 15m (confirmation), 5m (entry)
    const [candles1h, candles15m, candles5m] = await Promise.all([
      fetchOHLC("1h"),
      fetchOHLC("15m"),
      fetchOHLC("5m"),
    ]);

    const closes1h  = candles1h.map(c => c.close);
    const closes15m = candles15m.map(c => c.close);
    const closes5m  = candles5m.map(c => c.close);

    // EMAs per timeframe
    const ema50_1h  = calcEMA(closes1h, 50);
    const ema200_1h = calcEMA(closes1h, 200);
    const ema20_15m = calcEMA(closes15m, 20);
    const ema50_15m = calcEMA(closes15m, 50);
    const ema20_5m  = calcEMA(closes5m, 20);
    const ema50_5m  = calcEMA(closes5m, 50);

    // Trend per timeframe
    const trend1h  = detectTrend(ema50_1h, ema200_1h);
    const trend15m = detectTrend(ema20_15m, ema50_15m);
    const trend5m  = detectTrend(ema20_5m, ema50_5m);

    // Weighted trend score
    const trendScore = calcTrendScore(trend1h, trend15m, trend5m);
    const htTrend = scoreTrend(trendScore);

    // RSI on 15m (confirmation timeframe)
    const rsiArr = calcRSI(closes15m, 14);
    const rsi      = rsiArr[rsiArr.length - 1] ?? 50;
    const rsiPrev  = rsiArr[rsiArr.length - 2] ?? 50;
    const rsiPrev2 = rsiArr[rsiArr.length - 3] ?? 50;
    const rsiRising  = rsi > rsiPrev && rsiPrev >= rsiPrev2;
    const rsiFalling = rsi < rsiPrev && rsiPrev <= rsiPrev2;

    // MACD on 15m
    const { macdLine, signalLine, histogram } = calcMACD(closes15m);
    const macdVal      = macdLine[macdLine.length - 1] ?? 0;
    const macdSig      = signalLine[signalLine.length - 1] ?? 0;
    const macdHist     = histogram[histogram.length - 1] ?? 0;
    const macdPrevHist = histogram[histogram.length - 2] ?? 0;
    const macdBullish  = (macdHist > 0 && macdHist > macdPrevHist) || (macdVal > macdSig && macdPrevHist <= 0 && macdHist > 0);
    const macdBearish  = (macdHist < 0 && macdHist < macdPrevHist) || (macdVal < macdSig && macdPrevHist >= 0 && macdHist < 0);
    const macdImproving = macdHist > macdPrevHist;
    const macdWeakening = macdHist < macdPrevHist;

    // ATR on 15m (tighter for intraday)
    const atrArr = calcATR(candles15m, 14);
    const atr    = atrArr[atrArr.length - 1] ?? 8;

    // Support/Resistance on 15m (shorter lookback for intraday)
    const { support, resistance } = findSupportResistance(candles15m, 20);
    const nearSupport    = currentPrice <= support * 1.005;
    const nearResistance = currentPrice >= resistance * 0.995;

    // Current EMA values for display (use 1H, 15m, 5m)
    const ema20  = ema20_15m[ema20_15m.length - 1] ?? currentPrice;
    const ema50  = ema50_15m[ema50_15m.length - 1] ?? currentPrice;
    const ema200 = ema200_1h[ema200_1h.length - 1] ?? currentPrice;

    // ─── LONG scoring ─────────────────────────────────────────────────────────
    const longPoints:  Array<{ reason: string; pts: number }> = [];
    const shortPoints: Array<{ reason: string; pts: number }> = [];

    // Trend contribution
    if (trendScore >= 2) {
      longPoints.push({ reason: "intraday trend bullish across all TFs", pts: 3 });
    } else if (trendScore === 1) {
      longPoints.push({ reason: "trend slightly bullish", pts: 1 });
    } else if (trendScore === -1) {
      shortPoints.push({ reason: "trend slightly bearish", pts: 1 });
    } else if (trendScore <= -2) {
      shortPoints.push({ reason: "intraday trend bearish across all TFs", pts: 3 });
    }

    // RSI – LONG
    if (rsi > 45 && rsi < 70 && rsiRising) {
      longPoints.push({ reason: `RSI rising (${rsi.toFixed(1)})`, pts: 2 });
    } else if (rsi > 50 && rsiRising) {
      longPoints.push({ reason: `RSI above 50 and rising (${rsi.toFixed(1)})`, pts: 1 });
    } else if (rsi < 35) {
      longPoints.push({ reason: `RSI oversold at ${rsi.toFixed(1)} – reversal possible`, pts: 1 });
    }

    // RSI – SHORT
    if (rsi < 55 && rsi > 30 && rsiFalling) {
      shortPoints.push({ reason: `RSI falling (${rsi.toFixed(1)})`, pts: 2 });
    } else if (rsi < 50 && rsiFalling) {
      shortPoints.push({ reason: `RSI below 50 and falling (${rsi.toFixed(1)})`, pts: 1 });
    } else if (rsi > 65) {
      shortPoints.push({ reason: `RSI overbought at ${rsi.toFixed(1)} – reversal possible`, pts: 1 });
    }

    // EMA structure (15m)
    if (ema20 > ema50 && currentPrice > ema20) {
      longPoints.push({ reason: "EMA20 > EMA50, price above EMA20 (15m)", pts: 2 });
    } else if (ema20 > ema50) {
      longPoints.push({ reason: "EMA20 > EMA50 bullish structure (15m)", pts: 1 });
    }

    if (ema20 < ema50 && currentPrice < ema20) {
      shortPoints.push({ reason: "EMA20 < EMA50, price below EMA20 (15m)", pts: 2 });
    } else if (ema20 < ema50) {
      shortPoints.push({ reason: "EMA20 < EMA50 bearish structure (15m)", pts: 1 });
    }

    // MACD (15m) – LONG
    if (macdBullish) {
      longPoints.push({ reason: "MACD bullish crossover / momentum up (15m)", pts: 2 });
    } else if (macdImproving && macdVal > 0) {
      longPoints.push({ reason: "MACD positive and improving (15m)", pts: 1 });
    } else if (macdImproving) {
      longPoints.push({ reason: "MACD improving (15m)", pts: 1 });
    }

    // MACD (15m) – SHORT
    if (macdBearish) {
      shortPoints.push({ reason: "MACD bearish crossover / momentum down (15m)", pts: 2 });
    } else if (macdWeakening && macdVal < 0) {
      shortPoints.push({ reason: "MACD negative and weakening (15m)", pts: 1 });
    } else if (macdWeakening) {
      shortPoints.push({ reason: "MACD weakening (15m)", pts: 1 });
    }

    // Support/Resistance
    if (nearSupport)    longPoints.push({ reason: "price near intraday support", pts: 1 });
    if (nearResistance) shortPoints.push({ reason: "price near intraday resistance", pts: 1 });

    // 1H bias (longer-term context for intraday)
    if (trend1h === "BULLISH") {
      longPoints.push({ reason: "1H trend bullish (intraday bias)", pts: 1 });
    } else if (trend1h === "BEARISH") {
      shortPoints.push({ reason: "1H trend bearish (intraday bias)", pts: 1 });
    }

    const longTotal  = longPoints.reduce((s, p) => s + p.pts, 0);
    const shortTotal = shortPoints.reduce((s, p) => s + p.pts, 0);

    const MIN_SIGNAL_POINTS = 5;

    let rawSignal: "LONG" | "SHORT" | "HOLD" = "HOLD";
    if (longTotal >= MIN_SIGNAL_POINTS && longTotal > shortTotal + 1) {
      rawSignal = "LONG";
    } else if (shortTotal >= MIN_SIGNAL_POINTS && shortTotal > longTotal + 1) {
      rawSignal = "SHORT";
    }

    // ─── Cooldown / repetition guard ──────────────────────────────────────────
    const inCooldown     = sinceLastSignal < COOLDOWN_MS;
    const priceMoved     = lastSignalState
      ? Math.abs(currentPrice - lastSignalState.price) / lastSignalState.price >= MIN_PRICE_MOVE_PCT
      : true;
    const oppositeSignal = lastSignalState && rawSignal !== "HOLD" && rawSignal !== lastSignalState.signal;

    let finalSignal: "LONG" | "SHORT" | "HOLD" = rawSignal;
    if (rawSignal !== "HOLD" && inCooldown && !priceMoved && !oppositeSignal) {
      finalSignal = "HOLD";
    }

    // ─── Confidence calculation ───────────────────────────────────────────────
    const absScore    = Math.abs(trendScore);
    const trendConf   = Math.min(30, (absScore / 4) * 30);

    const activeTotal   = finalSignal === "LONG" ? longTotal : finalSignal === "SHORT" ? shortTotal : Math.max(longTotal, shortTotal);
    const indicatorConf = Math.min(25, (activeTotal / 12) * 25);

    const rsiDev       = Math.abs(rsi - 50);
    const momentumConf = Math.min(20, (rsiDev / 25) * 20);

    const atrAvg  = 8; // typical gold 15m ATR
    const atrRatio = atr / atrAvg;
    const volConf  = atrRatio >= 0.5 && atrRatio <= 2.0 ? 15 : 7;

    const srConf = (nearSupport && (finalSignal === "LONG" || rawSignal === "LONG")) ||
                   (nearResistance && (finalSignal === "SHORT" || rawSignal === "SHORT")) ? 10 : 5;

    const confidence = Math.round(Math.min(100, trendConf + indicatorConf + momentumConf + volConf + srConf));

    if (confidence < MIN_CONFIDENCE && finalSignal !== "HOLD") {
      finalSignal = "HOLD";
    }

    // ─── Stop Loss / Take Profit (tighter for intraday) ──────────────────────
    const slDist = Math.max(atr * 1.0, 5); // minimum $5 SL for intraday gold

    let stopLoss: number;
    let takeProfit: number;

    if (finalSignal === "LONG") {
      stopLoss   = +(Math.min(currentPrice - slDist, support - 0.5)).toFixed(2);
      takeProfit = +(currentPrice + slDist * 1.5).toFixed(2);   // 1.5R for intraday
    } else if (finalSignal === "SHORT") {
      stopLoss   = +(Math.max(currentPrice + slDist, resistance + 0.5)).toFixed(2);
      takeProfit = +(currentPrice - slDist * 1.5).toFixed(2);
    } else {
      stopLoss   = +(currentPrice - slDist).toFixed(2);
      takeProfit = +(currentPrice + slDist * 1.5).toFixed(2);
    }

    // ─── Reason string ────────────────────────────────────────────────────────
    let reason: string;
    if (finalSignal === "LONG") {
      const top = longPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `LONG because: ${top.join("; ")}`;
    } else if (finalSignal === "SHORT") {
      const top = shortPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `SHORT because: ${top.join("; ")}`;
    } else if (rawSignal !== "HOLD" && inCooldown) {
      reason = `HOLD – cooldown active (${Math.ceil(cooldownRemaining / 60)}m remaining), waiting for price confirmation`;
    } else {
      reason = `HOLD – indicators mixed (long score: ${longTotal}, short score: ${shortTotal}). Waiting for clear direction.`;
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
      timestamp:    new Date().toISOString(),
      tradeDuration: "2-6 hours",
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
        trend1h,
        trend15m,
        trend5m,
      },
    };

    cachedSignal = result;
    return result;

  } catch (err) {
    logger.error({ err }, "Signal generation error");
    const slDist = 10;
    return {
      signal: "HOLD",
      confidence: 0,
      entryPrice:  +currentPrice.toFixed(2),
      stopLoss:    +(currentPrice - slDist).toFixed(2),
      takeProfit:  +(currentPrice + slDist * 1.5).toFixed(2),
      trend: "NEUTRAL",
      reason: "HOLD – unable to fetch market data. Please retry in a moment.",
      timestamp: new Date().toISOString(),
      tradeDuration: "2-6 hours",
      cooldownRemaining,
      indicators: {
        rsi: 50, ema20: currentPrice, ema50: currentPrice, ema200: currentPrice,
        macdLine: 0, macdSignal: 0, macdHistogram: 0, atr: 8,
        trend1h: "NEUTRAL", trend15m: "NEUTRAL", trend5m: "NEUTRAL",
      },
    };
  }
}
