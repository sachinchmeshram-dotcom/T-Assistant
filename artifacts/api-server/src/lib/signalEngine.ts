import { fetchOHLC } from "./goldPrice.js";
import {
  calcEMA,
  calcRSI,
  calcMACD,
  calcATR,
  detectTrend,
  findSupportResistance,
  detectMarketStructure,
  detectLiquidityZones,
  detectBOS,
  detectOrderBlocks,
  type OrderBlock,
} from "./technicalIndicators.js";
import { getAnalyticsSummary, isSmartMode } from "./performanceAnalytics.js";
import { logger } from "./logger.js";

export interface OrderBlockInfo {
  type: "bullish" | "bearish";
  high: number;
  low: number;
}

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
  // ── Smart Money Concept fields ────────────────────────────────────────────
  marketStructure: "UPTREND" | "DOWNTREND" | "RANGING";
  bos: boolean;
  bosLevel: number | null;
  liquiditySweep: boolean;
  liquiditySweepType: "equal_high" | "equal_low" | null;
  orderBlock: OrderBlockInfo | null;
  inOrderBlock: boolean;
  smcScore: number;
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

// ── SMC Confidence Scoring ─────────────────────────────────────────────────
// Weights: Structure 25 + BOS 25 + Liquidity Sweep 20 + Order Block 15 + RSI/MACD 15 = 100
function calcSmcConfidence(opts: {
  structureAligned: boolean;
  bosConfirmed:     boolean;
  liquiditySweep:   boolean;
  inOrderBlock:     boolean;
  rsi:              number;
  macdBullish:      boolean;
  macdBearish:      boolean;
  signal:           "LONG" | "SHORT";
}): number {
  const { structureAligned, bosConfirmed, liquiditySweep, inOrderBlock,
          rsi, macdBullish, macdBearish, signal } = opts;

  let score = 0;

  // 1. Market structure alignment (25 pts)
  if (structureAligned) score += 25;

  // 2. Break of Structure confirmed (25 pts)
  if (bosConfirmed) score += 25;

  // 3. Liquidity sweep present (20 pts)
  if (liquiditySweep) score += 20;

  // 4. Price in Order Block zone (15 pts)
  if (inOrderBlock) score += 15;

  // 5. RSI + MACD filter (15 pts total)
  const rsiOk = signal === "LONG"
    ? rsi >= 30 && rsi <= 65    // not overbought, some upward room
    : rsi >= 35 && rsi <= 70;   // not oversold, some downward room

  const macdOk = signal === "LONG" ? macdBullish : macdBearish;

  if (rsiOk && macdOk)  score += 15;
  else if (rsiOk)       score += 10;
  else if (macdOk)      score += 7;

  return Math.min(100, score);
}

function overallTrend(
  t15: string, t5: string, t1: string
): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const score =
    (t15 === "BULLISH" ? 1 : t15 === "BEARISH" ? -1 : 0) +
    (t5  === "BULLISH" ? 1 : t5  === "BEARISH" ? -1 : 0) +
    (t1  === "BULLISH" ? 1 : t1  === "BEARISH" ? -1 : 0);
  if (score >= 2) return "BULLISH";
  if (score <= -2) return "BEARISH";
  return "NEUTRAL";
}

// ── Min confidence to emit a non-HOLD signal ──────────────────────────────
const BASE_MIN_CONFIDENCE = 60;

export async function generateSignal(currentPrice: number): Promise<SignalResult> {
  const now = Date.now();
  const sinceLastSignal = now - lastSignalTime;
  const cooldownRemaining = Math.max(0, Math.ceil((COOLDOWN_MS - sinceLastSignal) / 1000));
  const smartMode = isSmartMode();

  if (cachedSignal && sinceLastSignal < SIGNAL_CACHE_TTL) {
    return { ...cachedSignal, cooldownRemaining, smartMode };
  }

  const analytics = await getAnalyticsSummary();

  // Smart Mode adjusts confidence threshold
  let MIN_CONFIDENCE = BASE_MIN_CONFIDENCE;
  if (smartMode && analytics.sufficientData && analytics.winRate < 60) {
    MIN_CONFIDENCE = 72;   // strict — demand very strong SMC confluence
  } else if (smartMode && analytics.sufficientData && analytics.winRate >= 70) {
    MIN_CONFIDENCE = 55;   // performing well — slightly looser
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

    // ── Classic indicators (kept for RSI/MACD filter + SL/TP) ───────────────
    const ema9_1m   = calcEMA(closes1m, 9);
    const ema21_1m  = calcEMA(closes1m, 21);
    const ema20_5m  = calcEMA(closes5m, 20);
    const ema50_5m  = calcEMA(closes5m, 50);
    const ema20_15m = calcEMA(closes15m, 20);
    const ema50_15m = calcEMA(closes15m, 50);

    const ema20  = ema20_5m[ema20_5m.length - 1]   ?? currentPrice;
    const ema50  = ema50_5m[ema50_5m.length - 1]   ?? currentPrice;
    const ema200 = ema20_15m[ema20_15m.length - 1] ?? currentPrice;

    const trend15m = detectTrend(ema20_15m, ema50_15m);
    const trend5m  = detectTrend(ema20_5m,  ema50_5m);
    const trend1m  = detectTrend(ema9_1m,   ema21_1m);
    const htTrend  = overallTrend(trend15m, trend5m, trend1m);

    const rsi5mArr = calcRSI(closes5m, 14);
    const rsi      = rsi5mArr[rsi5mArr.length - 1] ?? 50;

    const { macdLine, signalLine, histogram } = calcMACD(closes5m);
    const macdVal      = macdLine[macdLine.length - 1]  ?? 0;
    const macdSig      = signalLine[signalLine.length - 1] ?? 0;
    const macdHist     = histogram[histogram.length - 1]   ?? 0;
    const macdPrevHist = histogram[histogram.length - 2]   ?? 0;
    const macdBullish  = macdHist > 0 && macdHist > macdPrevHist;
    const macdBearish  = macdHist < 0 && macdHist < macdPrevHist;

    const atrArr = calcATR(candles1m, 14);
    const atr    = atrArr[atrArr.length - 1] ?? 3;

    const { support, resistance } = findSupportResistance(candles5m, 20);

    // ── SMC Analysis ─────────────────────────────────────────────────────────

    // 1. Market structure on 15m (macro context) and 5m (entry context)
    const ms15m = detectMarketStructure(candles15m);
    const ms5m  = detectMarketStructure(candles5m);

    // Use 5m structure as primary, 15m as confirmation
    const primaryStructure = ms5m.structure;
    const contextStructure = ms15m.structure;

    // 2. Liquidity zones on 5m
    const liqZones5m = detectLiquidityZones(candles5m, 0.0012);

    // Swept equal low → bullish setup (SMT sweep before long)
    const sweptLow  = liqZones5m.some(z => z.type === "equal_low"  && z.swept);
    const sweptHigh = liqZones5m.some(z => z.type === "equal_high" && z.swept);

    // 3. BOS on 5m
    const bosResult = detectBOS(candles5m, ms5m);

    // 4. Order Blocks on 5m (last 40 candles)
    const { bullishOB, bearishOB } = detectOrderBlocks(candles5m, 40);

    // Is price in an OB zone right now?
    const inBullishOB = bullishOB !== null &&
      currentPrice >= bullishOB.low * 0.9985 &&
      currentPrice <= bullishOB.high * 1.0015;

    const inBearishOB = bearishOB !== null &&
      currentPrice >= bearishOB.low * 0.9985 &&
      currentPrice <= bearishOB.high * 1.0015;

    // ── SMC Signal Logic ─────────────────────────────────────────────────────
    // LONG: uptrend structure + swept low (liquidity grab) + bullish BOS + bullish OB
    // SHORT: downtrend structure + swept high (liquidity grab) + bearish BOS + bearish OB

    const longStructure  = primaryStructure === "UPTREND" || contextStructure === "UPTREND";
    const shortStructure = primaryStructure === "DOWNTREND" || contextStructure === "DOWNTREND";

    const longConfidence = calcSmcConfidence({
      structureAligned: longStructure,
      bosConfirmed:     bosResult.bullishBOS,
      liquiditySweep:   sweptLow,
      inOrderBlock:     inBullishOB,
      rsi,
      macdBullish,
      macdBearish,
      signal: "LONG",
    });

    const shortConfidence = calcSmcConfidence({
      structureAligned: shortStructure,
      bosConfirmed:     bosResult.bearishBOS,
      liquiditySweep:   sweptHigh,
      inOrderBlock:     inBearishOB,
      rsi,
      macdBullish,
      macdBearish,
      signal: "SHORT",
    });

    // Pick the dominant side
    let rawSignal: "LONG" | "SHORT" | "HOLD" = "HOLD";
    let confidence = 0;

    if (longConfidence >= MIN_CONFIDENCE && longConfidence > shortConfidence + 5) {
      rawSignal  = "LONG";
      confidence = longConfidence;
    } else if (shortConfidence >= MIN_CONFIDENCE && shortConfidence > longConfidence + 5) {
      rawSignal  = "SHORT";
      confidence = shortConfidence;
    } else {
      // Show the higher of the two for HOLD
      confidence = Math.max(longConfidence, shortConfidence);
    }

    // ── Cooldown guard ────────────────────────────────────────────────────────
    const inCooldown     = sinceLastSignal < COOLDOWN_MS;
    const priceMoved     = lastSignalState
      ? Math.abs(currentPrice - lastSignalState.price) / lastSignalState.price >= MIN_PRICE_MOVE_PCT
      : true;
    const oppositeSignal = lastSignalState &&
      rawSignal !== "HOLD" && rawSignal !== lastSignalState.signal;

    let finalSignal: "LONG" | "SHORT" | "HOLD" = rawSignal;
    if (rawSignal !== "HOLD" && inCooldown && !priceMoved && !oppositeSignal) {
      finalSignal = "HOLD";
    }

    // ── SL / TP ───────────────────────────────────────────────────────────────
    const slDist = Math.max(atr * 1.0, 2);
    let stopLoss: number;
    let takeProfit: number;

    if (finalSignal === "LONG") {
      // Place SL below bullish OB low if available, otherwise below support
      const slBase = bullishOB ? Math.min(bullishOB.low - 0.5, support - 0.25) : support - 0.25;
      stopLoss   = +Math.min(currentPrice - slDist, slBase).toFixed(2);
      takeProfit = +(currentPrice + slDist * 2).toFixed(2);
    } else if (finalSignal === "SHORT") {
      const slBase = bearishOB ? Math.max(bearishOB.high + 0.5, resistance + 0.25) : resistance + 0.25;
      stopLoss   = +Math.max(currentPrice + slDist, slBase).toFixed(2);
      takeProfit = +(currentPrice - slDist * 2).toFixed(2);
    } else {
      stopLoss   = +(currentPrice - slDist).toFixed(2);
      takeProfit = +(currentPrice + slDist * 1.5).toFixed(2);
    }

    // ── Reason string ─────────────────────────────────────────────────────────
    const smcParts: string[] = [];
    if (finalSignal === "LONG" || (finalSignal === "HOLD" && longConfidence >= shortConfidence)) {
      smcParts.push(`Structure: ${primaryStructure}`);
      if (sweptLow)             smcParts.push("Liquidity sweep (equal lows)");
      if (bosResult.bullishBOS) smcParts.push(`BOS ↑ ${bosResult.bosLevel?.toFixed(2)}`);
      if (bullishOB)            smcParts.push(`Bullish OB $${bullishOB.low.toFixed(2)}–$${bullishOB.high.toFixed(2)}`);
      if (inBullishOB)          smcParts.push("Price IN bullish OB");
    } else {
      smcParts.push(`Structure: ${primaryStructure}`);
      if (sweptHigh)            smcParts.push("Liquidity sweep (equal highs)");
      if (bosResult.bearishBOS) smcParts.push(`BOS ↓ ${bosResult.bosLevel?.toFixed(2)}`);
      if (bearishOB)            smcParts.push(`Bearish OB $${bearishOB.low.toFixed(2)}–$${bearishOB.high.toFixed(2)}`);
      if (inBearishOB)          smcParts.push("Price IN bearish OB");
    }

    let reason: string;
    if (finalSignal !== "HOLD") {
      reason = `${finalSignal} (SMC ${confidence}%): ${smcParts.join(" · ")}`;
    } else if (rawSignal !== "HOLD" && inCooldown) {
      reason = `HOLD – cooldown ${Math.ceil(cooldownRemaining / 60)}m remaining`;
    } else if (smartMode && analytics.sufficientData && analytics.winRate < 60) {
      reason = `HOLD – Smart Mode STRICT (win rate ${analytics.winRate}%): need SMC confluence ≥${MIN_CONFIDENCE}% (LONG:${longConfidence}% SHORT:${shortConfidence}%)`;
    } else {
      reason = `HOLD – SMC conditions incomplete (LONG:${longConfidence}% SHORT:${shortConfidence}%, need ≥${MIN_CONFIDENCE}%)`;
    }

    if (finalSignal !== "HOLD") {
      lastSignalState = { signal: finalSignal, price: currentPrice, timestamp: now };
      lastSignalTime  = now;
    }

    // Active OB for the signal direction
    const activeOB: OrderBlockInfo | null = finalSignal === "LONG" && bullishOB
      ? { type: "bullish", high: bullishOB.high, low: bullishOB.low }
      : finalSignal === "SHORT" && bearishOB
      ? { type: "bearish", high: bearishOB.high, low: bearishOB.low }
      : (bullishOB && longConfidence >= shortConfidence)
      ? { type: "bullish", high: bullishOB.high, low: bullishOB.low }
      : bearishOB
      ? { type: "bearish", high: bearishOB.high, low: bearishOB.low }
      : null;

    const liquiditySweep = finalSignal === "LONG" ? sweptLow
      : finalSignal === "SHORT" ? sweptHigh
      : longConfidence >= shortConfidence ? sweptLow : sweptHigh;

    const liquiditySweepType = liquiditySweep
      ? (finalSignal === "LONG" || longConfidence >= shortConfidence ? "equal_low" : "equal_high")
      : null;

    const smcScore = finalSignal === "LONG" ? longConfidence
      : finalSignal === "SHORT" ? shortConfidence
      : Math.max(longConfidence, shortConfidence);

    const result: SignalResult = {
      signal:     finalSignal,
      confidence: finalSignal !== "HOLD" ? confidence : smcScore,
      entryPrice: +currentPrice.toFixed(2),
      stopLoss,
      takeProfit,
      trend:      htTrend,
      reason,
      timestamp:  new Date().toISOString(),
      tradeDuration: "5-15 minutes",
      cooldownRemaining: finalSignal !== "HOLD" ? 0 : cooldownRemaining,
      smartMode,
      // SMC fields
      marketStructure:     primaryStructure,
      bos:                 bosResult.bullishBOS || bosResult.bearishBOS,
      bosLevel:            bosResult.bosLevel,
      liquiditySweep,
      liquiditySweepType,
      orderBlock:          activeOB,
      inOrderBlock:        finalSignal === "LONG" ? inBullishOB : finalSignal === "SHORT" ? inBearishOB : false,
      smcScore,
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
      stopLoss:   +(currentPrice - slDist).toFixed(2),
      takeProfit: +(currentPrice + slDist * 1.5).toFixed(2),
      trend: "NEUTRAL",
      reason: "HOLD – market data unavailable",
      timestamp: new Date().toISOString(),
      tradeDuration: "5-15 minutes",
      cooldownRemaining,
      smartMode,
      marketStructure: "RANGING",
      bos: false,
      bosLevel: null,
      liquiditySweep: false,
      liquiditySweepType: null,
      orderBlock: null,
      inOrderBlock: false,
      smcScore: 0,
      indicators: {
        rsi: 50, ema20: currentPrice, ema50: currentPrice, ema200: currentPrice,
        macdLine: 0, macdSignal: 0, macdHistogram: 0, atr: 3,
        trend1h: "NEUTRAL", trend15m: "NEUTRAL", trend5m: "NEUTRAL",
      },
    };
  }
}
