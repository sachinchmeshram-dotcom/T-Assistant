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
  signal: "BUY" | "SELL" | "HOLD";
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
    trend1d: "BULLISH" | "BEARISH" | "NEUTRAL";
    trend4h: "BULLISH" | "BEARISH" | "NEUTRAL";
    trend1h: "BULLISH" | "BEARISH" | "NEUTRAL";
  };
}

interface LastSignalState {
  signal: "BUY" | "SELL" | "HOLD";
  price: number;
  timestamp: number;
}

let lastSignalState: LastSignalState | null = null;
let cachedSignal: SignalResult | null = null;
let lastSignalTime = 0;

const SIGNAL_CACHE_TTL = 300_000;   // 5 minutes
const COOLDOWN_MS = 1_800_000;      // 30 minutes cooldown
const MIN_PRICE_MOVE_PCT = 0.005;   // 0.5% price move breaks cooldown
const MIN_CONFIDENCE = 55;          // Below this → HOLD

// Weighted multi-timeframe trend score
function calcTrendScore(
  trend1d: "BULLISH" | "BEARISH" | "NEUTRAL",
  trend4h: "BULLISH" | "BEARISH" | "NEUTRAL",
  trend1h: "BULLISH" | "BEARISH" | "NEUTRAL",
): number {
  const weight = (t: "BULLISH" | "BEARISH" | "NEUTRAL", w: number) =>
    t === "BULLISH" ? w : t === "BEARISH" ? -w : 0;
  return weight(trend1d, 2) + weight(trend4h, 1) + weight(trend1h, 1);
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
    const [candles1d, candles4h, candles1h] = await Promise.all([
      fetchOHLC("1d"),
      fetchOHLC("4h"),
      fetchOHLC("1h"),
    ]);

    const closes1d = candles1d.map(c => c.close);
    const closes4h = candles4h.map(c => c.close);
    const closes1h = candles1h.map(c => c.close);

    // EMAs across timeframes
    const ema50_1d  = calcEMA(closes1d, 50);
    const ema200_1d = calcEMA(closes1d, 200);
    const ema50_4h  = calcEMA(closes4h, 50);
    const ema200_4h = calcEMA(closes4h, 200);
    const ema20_1h  = calcEMA(closes1h, 20);
    const ema50_1h  = calcEMA(closes1h, 50);
    const ema200_1h = calcEMA(closes1h, 200);

    // Trend per timeframe
    const trend1d = detectTrend(ema50_1d, ema200_1d);
    const trend4h = detectTrend(ema50_4h, ema200_4h);
    const trend1h = detectTrend(ema50_1h, ema200_1h);

    // Weighted trend score — no longer requires perfect alignment
    const trendScore = calcTrendScore(trend1d, trend4h, trend1h);
    const htTrend = scoreTrend(trendScore);

    // RSI on 1H
    const rsiArr = calcRSI(closes1h, 14);
    const rsi     = rsiArr[rsiArr.length - 1] ?? 50;
    const rsiPrev = rsiArr[rsiArr.length - 2] ?? 50;
    const rsiPrev2 = rsiArr[rsiArr.length - 3] ?? 50;
    const rsiRising  = rsi > rsiPrev && rsiPrev >= rsiPrev2;
    const rsiFalling = rsi < rsiPrev && rsiPrev <= rsiPrev2;

    // MACD on 1H
    const { macdLine, signalLine, histogram } = calcMACD(closes1h);
    const macdVal      = macdLine[macdLine.length - 1] ?? 0;
    const macdSig      = signalLine[signalLine.length - 1] ?? 0;
    const macdHist     = histogram[histogram.length - 1] ?? 0;
    const macdPrevHist = histogram[histogram.length - 2] ?? 0;
    // Bullish: histogram positive and growing (momentum up), OR line crossing above signal
    const macdBullish  = (macdHist > 0 && macdHist > macdPrevHist) || (macdVal > macdSig && macdPrevHist <= 0 && macdHist > 0);
    // Bearish: histogram negative and deepening, OR line crossing below signal
    const macdBearish  = (macdHist < 0 && macdHist < macdPrevHist) || (macdVal < macdSig && macdPrevHist >= 0 && macdHist < 0);
    const macdImproving = macdHist > macdPrevHist; // improving even if still negative
    const macdWeakening = macdHist < macdPrevHist; // weakening even if still positive

    // ATR
    const atrArr = calcATR(candles1h, 14);
    const atr    = atrArr[atrArr.length - 1] ?? 15;

    // Support / Resistance on 1H (wider lookback for swing trading)
    const { support, resistance } = findSupportResistance(candles1h, 40);
    const nearSupport    = currentPrice <= support * 1.008;
    const nearResistance = currentPrice >= resistance * 0.992;

    // Current EMA values on 1H
    const ema20  = ema20_1h[ema20_1h.length - 1]  ?? currentPrice;
    const ema50  = ema50_1h[ema50_1h.length - 1]  ?? currentPrice;
    const ema200 = ema200_1h[ema200_1h.length - 1] ?? currentPrice;

    // ─── BUY scoring ───────────────────────────────────────────────────────────
    // Each condition adds to a point tally. We don't require all of them.
    const buyPoints: Array<{ reason: string; pts: number }> = [];
    const sellPoints: Array<{ reason: string; pts: number }> = [];

    // Trend contribution
    if (trendScore >= 2) {
      buyPoints.push({ reason: "multi-timeframe trend bullish", pts: 3 });
    } else if (trendScore === 1) {
      buyPoints.push({ reason: "trend slightly bullish", pts: 1 });
    } else if (trendScore === -1) {
      sellPoints.push({ reason: "trend slightly bearish", pts: 1 });
    } else if (trendScore <= -2) {
      sellPoints.push({ reason: "multi-timeframe trend bearish", pts: 3 });
    }

    // RSI – BUY
    if (rsi > 45 && rsi < 70 && rsiRising) {
      buyPoints.push({ reason: `RSI rising (${rsi.toFixed(1)})`, pts: 2 });
    } else if (rsi > 50 && rsiRising) {
      buyPoints.push({ reason: `RSI above 50 and rising (${rsi.toFixed(1)})`, pts: 1 });
    } else if (rsi < 35) {
      // Oversold reversal potential
      buyPoints.push({ reason: `RSI oversold at ${rsi.toFixed(1)} – reversal possible`, pts: 1 });
    }

    // RSI – SELL
    if (rsi < 55 && rsi > 30 && rsiFalling) {
      sellPoints.push({ reason: `RSI falling (${rsi.toFixed(1)})`, pts: 2 });
    } else if (rsi < 50 && rsiFalling) {
      sellPoints.push({ reason: `RSI below 50 and falling (${rsi.toFixed(1)})`, pts: 1 });
    } else if (rsi > 65) {
      // Overbought reversal potential
      sellPoints.push({ reason: `RSI overbought at ${rsi.toFixed(1)} – reversal possible`, pts: 1 });
    }

    // EMA structure (1H)
    if (ema20 > ema50 && currentPrice > ema20) {
      buyPoints.push({ reason: "EMA20 > EMA50, price above EMA20", pts: 2 });
    } else if (ema20 > ema50) {
      buyPoints.push({ reason: "EMA20 > EMA50 (bullish structure)", pts: 1 });
    }

    if (ema20 < ema50 && currentPrice < ema20) {
      sellPoints.push({ reason: "EMA20 < EMA50, price below EMA20", pts: 2 });
    } else if (ema20 < ema50) {
      sellPoints.push({ reason: "EMA20 < EMA50 (bearish structure)", pts: 1 });
    }

    // MACD (1H) – BUY
    if (macdBullish) {
      buyPoints.push({ reason: "MACD bullish crossover / momentum up", pts: 2 });
    } else if (macdImproving && macdVal > 0) {
      buyPoints.push({ reason: "MACD positive and improving", pts: 1 });
    } else if (macdImproving) {
      buyPoints.push({ reason: "MACD improving", pts: 1 });
    }

    // MACD (1H) – SELL
    if (macdBearish) {
      sellPoints.push({ reason: "MACD bearish crossover / momentum down", pts: 2 });
    } else if (macdWeakening && macdVal < 0) {
      sellPoints.push({ reason: "MACD negative and weakening", pts: 1 });
    } else if (macdWeakening) {
      sellPoints.push({ reason: "MACD weakening", pts: 1 });
    }

    // Support/Resistance
    if (nearSupport) {
      buyPoints.push({ reason: "price near support zone", pts: 1 });
    }
    if (nearResistance) {
      sellPoints.push({ reason: "price near resistance zone", pts: 1 });
    }

    // Price vs EMA200 — longer-term context
    if (currentPrice > ema200) {
      buyPoints.push({ reason: "price above EMA200 (long-term bullish)", pts: 1 });
    } else {
      sellPoints.push({ reason: "price below EMA200 (long-term bearish)", pts: 1 });
    }

    const buyTotal  = buyPoints.reduce((s, p) => s + p.pts, 0);
    const sellTotal = sellPoints.reduce((s, p) => s + p.pts, 0);

    // Minimum points to fire a signal (relaxed — partial confirmations allowed)
    const MIN_SIGNAL_POINTS = 5;

    let rawSignal: "BUY" | "SELL" | "HOLD" = "HOLD";
    if (buyTotal >= MIN_SIGNAL_POINTS && buyTotal > sellTotal + 1) {
      rawSignal = "BUY";
    } else if (sellTotal >= MIN_SIGNAL_POINTS && sellTotal > buyTotal + 1) {
      rawSignal = "SELL";
    }

    // ─── Cooldown / repetition guard ───────────────────────────────────────────
    const inCooldown    = sinceLastSignal < COOLDOWN_MS;
    const priceMoved    = lastSignalState
      ? Math.abs(currentPrice - lastSignalState.price) / lastSignalState.price >= MIN_PRICE_MOVE_PCT
      : true;
    const oppositeSignal = lastSignalState && rawSignal !== "HOLD" && rawSignal !== lastSignalState.signal;

    let finalSignal: "BUY" | "SELL" | "HOLD" = rawSignal;
    if (rawSignal !== "HOLD" && inCooldown && !priceMoved && !oppositeSignal) {
      finalSignal = "HOLD";
    }

    // ─── Confidence calculation (weighted) ─────────────────────────────────────
    // 1. Trend strength (30 pts max)
    const absScore    = Math.abs(trendScore); // 0–4
    const trendConf   = Math.min(30, (absScore / 4) * 30);

    // 2. Indicator alignment (25 pts max)
    const activeTotal  = finalSignal === "BUY" ? buyTotal : finalSignal === "SELL" ? sellTotal : Math.max(buyTotal, sellTotal);
    const indicatorConf = Math.min(25, (activeTotal / 12) * 25);

    // 3. Momentum – RSI deviation from 50 (20 pts max)
    const rsiDev       = Math.abs(rsi - 50);
    const momentumConf = Math.min(20, (rsiDev / 25) * 20);

    // 4. Volatility – ATR in healthy range (15 pts max)
    const atrAvg  = 20; // typical gold hourly ATR
    const atrRatio = atr / atrAvg;
    const volConf  = atrRatio >= 0.5 && atrRatio <= 2.0 ? 15 : 7;

    // 5. S/R confluence (10 pts max)
    const srConf = (nearSupport && (finalSignal === "BUY" || rawSignal === "BUY")) ||
                   (nearResistance && (finalSignal === "SELL" || rawSignal === "SELL")) ? 10 : 5;

    const confidence = Math.round(Math.min(100, trendConf + indicatorConf + momentumConf + volConf + srConf));

    // If confidence too low, force HOLD
    if (confidence < MIN_CONFIDENCE && finalSignal !== "HOLD") {
      finalSignal = "HOLD";
    }

    // ─── Stop Loss / Take Profit ────────────────────────────────────────────────
    const slDist = Math.max(atr * 1.5, 8); // minimum $8 SL for gold

    let stopLoss: number;
    let takeProfit: number;

    if (finalSignal === "BUY") {
      stopLoss   = +(Math.min(currentPrice - slDist, support - 1)).toFixed(2);
      takeProfit = +(currentPrice + slDist * 2).toFixed(2);
    } else if (finalSignal === "SELL") {
      stopLoss   = +(Math.max(currentPrice + slDist, resistance + 1)).toFixed(2);
      takeProfit = +(currentPrice - slDist * 2).toFixed(2);
    } else {
      // HOLD – still provide reference levels
      stopLoss   = +(currentPrice - slDist).toFixed(2);
      takeProfit = +(currentPrice + slDist * 2).toFixed(2);
    }

    // ─── Reason string ─────────────────────────────────────────────────────────
    let reason: string;
    if (finalSignal === "BUY") {
      const top = buyPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `BUY because: ${top.join("; ")}`;
    } else if (finalSignal === "SELL") {
      const top = sellPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `SELL because: ${top.join("; ")}`;
    } else if (rawSignal !== "HOLD" && inCooldown) {
      reason = `HOLD – cooldown active (${Math.ceil(cooldownRemaining / 60)}m remaining), waiting for price confirmation`;
    } else {
      reason = `HOLD – indicators mixed (buy score: ${buyTotal}, sell score: ${sellTotal}). Waiting for clear direction.`;
    }

    // ─── Persist last signal state ──────────────────────────────────────────────
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
      tradeDuration: "1-3 days",
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
        trend1d,
        trend4h,
        trend1h,
      },
    };

    cachedSignal = result;
    return result;

  } catch (err) {
    logger.error({ err }, "Signal generation error");
    const slDist = 25;
    return {
      signal: "HOLD",
      confidence: 0,
      entryPrice:  +currentPrice.toFixed(2),
      stopLoss:    +(currentPrice - slDist).toFixed(2),
      takeProfit:  +(currentPrice + slDist * 2).toFixed(2),
      trend: "NEUTRAL",
      reason: "HOLD – unable to fetch market data. Please retry in a moment.",
      timestamp: new Date().toISOString(),
      tradeDuration: "1-3 days",
      cooldownRemaining,
      indicators: {
        rsi: 50, ema20: currentPrice, ema50: currentPrice, ema200: currentPrice,
        macdLine: 0, macdSignal: 0, macdHistogram: 0, atr: 25,
        trend1d: "NEUTRAL", trend4h: "NEUTRAL", trend1h: "NEUTRAL",
      },
    };
  }
}
