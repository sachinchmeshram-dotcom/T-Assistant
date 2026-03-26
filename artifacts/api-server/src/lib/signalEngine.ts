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
const SIGNAL_CACHE_TTL = 300_000;
const COOLDOWN_MS = 1_800_000;
const MIN_PRICE_MOVE_PCT = 0.005;

export async function generateSignal(currentPrice: number): Promise<SignalResult> {
  const now = Date.now();
  const sinceLastSignal = now - lastSignalTime;
  const cooldownRemaining = Math.max(0, Math.ceil((COOLDOWN_MS - sinceLastSignal) / 1000));

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

    const ema50_1d = calcEMA(closes1d, 50);
    const ema200_1d = calcEMA(closes1d, 200);
    const ema50_4h = calcEMA(closes4h, 50);
    const ema200_4h = calcEMA(closes4h, 200);
    const ema20_1h = calcEMA(closes1h, 20);
    const ema50_1h = calcEMA(closes1h, 50);
    const ema200_1h = calcEMA(closes1h, 200);

    const trend1d = detectTrend(ema50_1d, ema200_1d);
    const trend4h = detectTrend(ema50_4h, ema200_4h);
    const trend1h = detectTrend(ema50_1h, ema200_1h);

    const rsiArr = calcRSI(closes1h, 14);
    const rsi = rsiArr[rsiArr.length - 1] ?? 50;
    const rsiPrev = rsiArr[rsiArr.length - 2] ?? 50;
    const rsiRising = rsi > rsiPrev;

    const { macdLine, signalLine, histogram } = calcMACD(closes1h);
    const macdVal = macdLine[macdLine.length - 1] ?? 0;
    const macdSig = signalLine[signalLine.length - 1] ?? 0;
    const macdHist = histogram[histogram.length - 1] ?? 0;
    const macdPrevHist = histogram[histogram.length - 2] ?? 0;
    const macdBullish = macdHist > 0 && macdHist > macdPrevHist;
    const macdBearish = macdHist < 0 && macdHist < macdPrevHist;

    const atrArr = calcATR(candles1h, 14);
    const atr = atrArr[atrArr.length - 1] ?? 10;

    const { support, resistance } = findSupportResistance(candles1h);
    const nearSupport = currentPrice <= support * 1.005;
    const nearResistance = currentPrice >= resistance * 0.995;

    const ema20 = ema20_1h[ema20_1h.length - 1] ?? currentPrice;
    const ema50 = ema50_1h[ema50_1h.length - 1] ?? currentPrice;
    const ema200 = ema200_1h[ema200_1h.length - 1] ?? currentPrice;

    const htBullish = trend1d === "BULLISH" && trend4h === "BULLISH";
    const htBearish = trend1d === "BEARISH" && trend4h === "BEARISH";
    const htTrend: "BULLISH" | "BEARISH" | "NEUTRAL" = htBullish
      ? "BULLISH"
      : htBearish
      ? "BEARISH"
      : "NEUTRAL";

    let rawSignal: "BUY" | "SELL" | "HOLD" = "HOLD";
    const buyReasons: string[] = [];
    const sellReasons: string[] = [];

    if (htTrend === "BULLISH") {
      buyReasons.push("trend bullish (1D+4H)");
      if (rsi >= 40 && rsi <= 65 && rsiRising) buyReasons.push("RSI rising (" + rsi.toFixed(1) + ")");
      if (ema20 > ema50) buyReasons.push("EMA20 > EMA50");
      if (macdBullish) buyReasons.push("MACD bullish crossover");
      if (nearSupport) buyReasons.push("price near support");
    } else if (htTrend === "BEARISH") {
      sellReasons.push("trend bearish (1D+4H)");
      if (rsi >= 35 && rsi <= 60 && !rsiRising) sellReasons.push("RSI falling (" + rsi.toFixed(1) + ")");
      if (ema20 < ema50) sellReasons.push("EMA20 < EMA50");
      if (macdBearish) sellReasons.push("MACD bearish crossover");
      if (nearResistance) sellReasons.push("price near resistance");
    } else {
      const rsiCrossUp = rsiPrev < 50 && rsi > 50;
      const rsiCrossDown = rsiPrev > 50 && rsi < 50;
      if (rsiCrossUp && macdBullish) {
        buyReasons.push("RSI crossed 50 upward");
        buyReasons.push("MACD confirming");
      }
      if (rsiCrossDown && macdBearish) {
        sellReasons.push("RSI crossed 50 downward");
        sellReasons.push("MACD confirming");
      }
    }

    const buyScore = buyReasons.length;
    const sellScore = sellReasons.length;
    const minConditions = htTrend !== "NEUTRAL" ? 3 : 2;

    if (buyScore >= minConditions && buyScore > sellScore) rawSignal = "BUY";
    else if (sellScore >= minConditions && sellScore > buyScore) rawSignal = "SELL";

    const inCooldown = sinceLastSignal < COOLDOWN_MS;
    const priceMoved = lastSignalState
      ? Math.abs(currentPrice - lastSignalState.price) / lastSignalState.price >= MIN_PRICE_MOVE_PCT
      : true;
    const oppositeSignal = lastSignalState && rawSignal !== "HOLD" && rawSignal !== lastSignalState.signal;

    let finalSignal: "BUY" | "SELL" | "HOLD" = rawSignal;
    if (rawSignal !== "HOLD" && inCooldown && !priceMoved && !oppositeSignal) {
      finalSignal = "HOLD";
    }

    let confidence = 0;
    const trendScore = htTrend !== "NEUTRAL" ? 30 : 10;
    confidence += trendScore;

    const activeReasons = finalSignal === "BUY" ? buyReasons : finalSignal === "SELL" ? sellReasons : [];
    const indicatorScore = Math.min(25, activeReasons.filter(r =>
      r.includes("RSI") || r.includes("EMA") || r.includes("MACD")
    ).length * 8);
    confidence += indicatorScore;

    const rsiDeviation = Math.abs(rsi - 50);
    const momentumScore = Math.min(20, rsiDeviation / 2.5);
    confidence += momentumScore;

    const atrAvg = 15;
    const volScore = atr < atrAvg * 1.5 && atr > atrAvg * 0.5 ? 15 : 7;
    confidence += volScore;

    const srScore = (nearSupport && finalSignal === "BUY") || (nearResistance && finalSignal === "SELL") ? 10 : 5;
    confidence += srScore;

    if (confidence < 65 && finalSignal !== "HOLD") {
      finalSignal = "HOLD";
    }

    const stopLossDistance = atr * 1.5;
    let stopLoss: number;
    let takeProfit: number;

    if (finalSignal === "BUY") {
      stopLoss = +(currentPrice - stopLossDistance).toFixed(2);
      takeProfit = +(currentPrice + stopLossDistance * 2).toFixed(2);
      stopLoss = Math.min(stopLoss, support - 2);
    } else if (finalSignal === "SELL") {
      stopLoss = +(currentPrice + stopLossDistance).toFixed(2);
      takeProfit = +(currentPrice - stopLossDistance * 2).toFixed(2);
      stopLoss = Math.max(stopLoss, resistance + 2);
    } else {
      stopLoss = +(currentPrice - stopLossDistance).toFixed(2);
      takeProfit = +(currentPrice + stopLossDistance * 2).toFixed(2);
    }

    const reasonParts = finalSignal === "BUY" ? buyReasons : finalSignal === "SELL" ? sellReasons : [];
    let reason = "HOLD – waiting for stronger confirmation";
    if (finalSignal !== "HOLD" && reasonParts.length > 0) {
      reason = `${finalSignal} because ${reasonParts.join(" + ")}`;
    } else if (finalSignal !== "HOLD") {
      reason = `${finalSignal} signal detected`;
    }

    if (finalSignal !== "HOLD") {
      lastSignalState = { signal: finalSignal, price: currentPrice, timestamp: now };
      lastSignalTime = now;
    }

    const result: SignalResult = {
      signal: finalSignal,
      confidence: +Math.min(100, Math.round(confidence)).toFixed(0),
      entryPrice: +currentPrice.toFixed(2),
      stopLoss,
      takeProfit,
      trend: htTrend,
      reason,
      timestamp: new Date().toISOString(),
      tradeDuration: "1-3 days",
      cooldownRemaining: finalSignal !== "HOLD" ? 0 : cooldownRemaining,
      indicators: {
        rsi: +rsi.toFixed(2),
        ema20: +ema20.toFixed(2),
        ema50: +ema50.toFixed(2),
        ema200: +ema200.toFixed(2),
        macdLine: +macdVal.toFixed(4),
        macdSignal: +macdSig.toFixed(4),
        macdHistogram: +macdHist.toFixed(4),
        atr: +atr.toFixed(2),
        trend1d,
        trend4h,
        trend1h,
      },
    };

    cachedSignal = result;
    return result;
  } catch (err) {
    logger.error({ err }, "Signal generation error");
    const fallback: SignalResult = {
      signal: "HOLD",
      confidence: 0,
      entryPrice: +currentPrice.toFixed(2),
      stopLoss: +(currentPrice - 20).toFixed(2),
      takeProfit: +(currentPrice + 40).toFixed(2),
      trend: "NEUTRAL",
      reason: "HOLD – data fetch error, waiting for market data",
      timestamp: new Date().toISOString(),
      tradeDuration: "1-3 days",
      cooldownRemaining,
      indicators: {
        rsi: 50,
        ema20: currentPrice,
        ema50: currentPrice,
        ema200: currentPrice,
        macdLine: 0,
        macdSignal: 0,
        macdHistogram: 0,
        atr: 15,
        trend1d: "NEUTRAL",
        trend4h: "NEUTRAL",
        trend1h: "NEUTRAL",
      },
    };
    return fallback;
  }
}
