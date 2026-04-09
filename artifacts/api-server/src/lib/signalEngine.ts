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
import { getAnalyticsSummary, isSmartMode, getAdaptiveWeights } from "./performanceAnalytics.js";
import { predict, featurize, type MLPrediction, type MLModelStatus } from "./mlModel.js";
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
  // ── Hybrid AI fields ──────────────────────────────────────────────────────
  smcSignal:       "LONG" | "SHORT" | "HOLD";
  smcConfidence:   number;                      // raw SMC score 0-100
  signalStrength:  "STRONG" | "NORMAL" | null;  // STRONG=both agree, NORMAL=SMC solo ≥80
  hybridConfidence: number;                     // 60% SMC + 40% ML
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
  // ── ML Neural Network fields ──────────────────────────────────────────────
  mlSignal:      "LONG" | "SHORT" | "NO_TRADE";
  mlConfidence:  number;
  mlPLong:       number;
  mlPShort:      number;
  mlPNoTrade:    number;
  mlModelStatus: MLModelStatus;
  mlTrainedOn:   number;
  mlAccuracy:    number;
  mlEnabled:     boolean;
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

// ── SMC confidence thresholds ─────────────────────────────────────────────
// STRONG = SMC + ML agree  → SMC needs to be ≥ this
const SMC_AGREE_THRESHOLD   = 60;
// NORMAL = SMC alone        → SMC needs to be ≥ this
const SMC_SOLO_THRESHOLD    = 80;
// Ranging market raises both thresholds (sideways suppression)
const RANGING_AGREE_EXTRA   = 10;
const RANGING_SOLO_EXTRA    = 8;

// ── SMC Confidence Scoring using adaptive weights ─────────────────────────
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

  const w = getAdaptiveWeights();

  let score = 0;
  if (structureAligned) score += w.structure;
  if (bosConfirmed)     score += w.bos;
  if (liquiditySweep)   score += w.liquidity;
  if (inOrderBlock)     score += w.orderBlock;

  const rsiOk = signal === "LONG"
    ? rsi >= 30 && rsi <= 65
    : rsi >= 35 && rsi <= 70;
  const macdOk = signal === "LONG" ? macdBullish : macdBearish;

  if (rsiOk && macdOk)  score += w.rsiMacd;
  else if (rsiOk)       score += Math.round(w.rsiMacd * 0.67);
  else if (macdOk)      score += Math.round(w.rsiMacd * 0.47);

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

// ── Hybrid Decision Engine ────────────────────────────────────────────────
interface HybridDecision {
  smcSignal:        "LONG" | "SHORT" | "HOLD";
  signalStrength:   "STRONG" | "NORMAL" | null;
  finalSignal:      "LONG" | "SHORT" | "HOLD";
  hybridConfidence: number;
  smcConfidence:    number;
}

function hybridDecide(opts: {
  longConf:    number;
  shortConf:   number;
  mlPred:      MLPrediction;
  isRanging:   boolean;
  smartMode:   boolean;
  winRate:     number;
  sufficientData: boolean;
}): HybridDecision {
  const { longConf, shortConf, mlPred, isRanging, smartMode, winRate, sufficientData } = opts;

  // Dynamic thresholds
  let agreeThreshold = SMC_AGREE_THRESHOLD;
  let soloThreshold  = SMC_SOLO_THRESHOLD;

  if (isRanging) {
    agreeThreshold += RANGING_AGREE_EXTRA;
    soloThreshold  += RANGING_SOLO_EXTRA;
  }

  if (smartMode && sufficientData) {
    if (winRate < 60) {
      agreeThreshold += 8;
      soloThreshold  += 8;
    } else if (winRate >= 70) {
      agreeThreshold = Math.max(agreeThreshold - 5, 50);
      soloThreshold  = Math.max(soloThreshold  - 5, 72);
    }
  }

  // 1. Determine raw SMC signal
  const smcSignal: "LONG" | "SHORT" | "HOLD" =
    longConf  >= agreeThreshold && longConf  > shortConf + 5 ? "LONG"  :
    shortConf >= agreeThreshold && shortConf > longConf  + 5 ? "SHORT" :
    "HOLD";

  const dominantSmcConf = smcSignal === "LONG"  ? longConf
                        : smcSignal === "SHORT" ? shortConf
                        : Math.max(longConf, shortConf);

  // 2. ML signal (only trust when model is trained)
  const mlTrained = mlPred.modelStatus === "trained";
  const effectiveMlSignal = mlTrained ? mlPred.signal : "NO_TRADE";

  // 3. Agreement check
  const agreed =
    smcSignal !== "HOLD" &&
    effectiveMlSignal !== "NO_TRADE" &&
    smcSignal === effectiveMlSignal;

  // 4. Strength determination
  let signalStrength: "STRONG" | "NORMAL" | null = null;

  if (agreed && longConf >= agreeThreshold || agreed && shortConf >= agreeThreshold) {
    signalStrength = "STRONG";
  } else if (smcSignal !== "HOLD" && dominantSmcConf >= soloThreshold) {
    signalStrength = "NORMAL";
  }

  const finalSignal: "LONG" | "SHORT" | "HOLD" =
    signalStrength !== null ? smcSignal : "HOLD";

  // 5. Hybrid confidence = 60% SMC + 40% ML (direction-specific ML prob)
  const mlProbForDir =
    finalSignal === "LONG"  ? mlPred.pLong  :
    finalSignal === "SHORT" ? mlPred.pShort :
    Math.max(mlPred.pLong, mlPred.pShort);

  const smcConf = finalSignal !== "HOLD" ? dominantSmcConf
    : Math.max(longConf, shortConf);

  const hybridConfidence = mlTrained
    ? Math.round(smcConf * 0.6 + mlProbForDir * 0.4)
    : smcConf;

  return {
    smcSignal,
    signalStrength,
    finalSignal,
    hybridConfidence: Math.min(100, hybridConfidence),
    smcConfidence: smcConf,
  };
}

export async function generateSignal(currentPrice: number): Promise<SignalResult> {
  const now = Date.now();
  const sinceLastSignal = now - lastSignalTime;
  const cooldownRemaining = Math.max(0, Math.ceil((COOLDOWN_MS - sinceLastSignal) / 1000));
  const smartMode = isSmartMode();

  if (cachedSignal && sinceLastSignal < SIGNAL_CACHE_TTL) {
    return { ...cachedSignal, cooldownRemaining, smartMode };
  }

  const analytics = await getAnalyticsSummary();

  try {
    const [candles15m, candles5m, candles1m] = await Promise.all([
      fetchOHLC("15m"),
      fetchOHLC("5m"),
      fetchOHLC("1m"),
    ]);

    const closes15m = candles15m.map(c => c.close);
    const closes5m  = candles5m.map(c => c.close);
    const closes1m  = candles1m.map(c => c.close);

    // ── Indicators ────────────────────────────────────────────────────────
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

    // ── SMC Analysis ──────────────────────────────────────────────────────
    const ms15m = detectMarketStructure(candles15m);
    const ms5m  = detectMarketStructure(candles5m);

    const primaryStructure = ms5m.structure;
    const contextStructure = ms15m.structure;

    const isRanging =
      primaryStructure === "RANGING" && contextStructure === "RANGING";

    const liqZones5m = detectLiquidityZones(candles5m, 0.0012);
    const sweptLow   = liqZones5m.some(z => z.type === "equal_low"  && z.swept);
    const sweptHigh  = liqZones5m.some(z => z.type === "equal_high" && z.swept);

    const bosResult = detectBOS(candles5m, ms5m);

    const { bullishOB, bearishOB } = detectOrderBlocks(candles5m, 40);

    const inBullishOB = bullishOB !== null &&
      currentPrice >= bullishOB.low * 0.9985 &&
      currentPrice <= bullishOB.high * 1.0015;

    const inBearishOB = bearishOB !== null &&
      currentPrice >= bearishOB.low * 0.9985 &&
      currentPrice <= bearishOB.high * 1.0015;

    // ── SMC Confidence Scores ─────────────────────────────────────────────
    const longStructure  = primaryStructure === "UPTREND" || contextStructure === "UPTREND";
    const shortStructure = primaryStructure === "DOWNTREND" || contextStructure === "DOWNTREND";

    const longConfidence = calcSmcConfidence({
      structureAligned: longStructure,
      bosConfirmed:     bosResult.bullishBOS,
      liquiditySweep:   sweptLow,
      inOrderBlock:     inBullishOB,
      rsi, macdBullish, macdBearish,
      signal: "LONG",
    });

    const shortConfidence = calcSmcConfidence({
      structureAligned: shortStructure,
      bosConfirmed:     bosResult.bearishBOS,
      liquiditySweep:   sweptHigh,
      inOrderBlock:     inBearishOB,
      rsi, macdBullish, macdBearish,
      signal: "SHORT",
    });

    // ── ML Prediction ─────────────────────────────────────────────────────
    const dominantSMCScore = Math.max(longConfidence, shortConfidence);
    const mlFeatures = featurize({
      marketStructure: primaryStructure,
      bosPresent:      bosResult.bullishBOS || bosResult.bearishBOS,
      liquiditySweep:  sweptLow || sweptHigh,
      inOrderBlock:    inBullishOB || inBearishOB,
      smcScore:        dominantSMCScore,
      confidence:      dominantSMCScore,
    });
    const mlPred = predict(mlFeatures);

    // ── Hybrid Decision ───────────────────────────────────────────────────
    const hybrid = hybridDecide({
      longConf:      longConfidence,
      shortConf:     shortConfidence,
      mlPred,
      isRanging,
      smartMode,
      winRate:       analytics.winRate,
      sufficientData: analytics.sufficientData,
    });

    const { smcSignal, signalStrength, hybridConfidence, smcConfidence } = hybrid;
    let finalSignal = hybrid.finalSignal;

    // ── Cooldown Guard ────────────────────────────────────────────────────
    const inCooldown     = sinceLastSignal < COOLDOWN_MS;
    const priceMoved     = lastSignalState
      ? Math.abs(currentPrice - lastSignalState.price) / lastSignalState.price >= MIN_PRICE_MOVE_PCT
      : true;
    const oppositeSignal = lastSignalState &&
      finalSignal !== "HOLD" && finalSignal !== lastSignalState.signal;

    if (finalSignal !== "HOLD" && inCooldown && !priceMoved && !oppositeSignal) {
      finalSignal = "HOLD";
    }

    // ── SL / TP (always driven by SMC levels) ─────────────────────────────
    const slDist = Math.max(atr * 1.0, 2);
    let stopLoss: number;
    let takeProfit: number;

    if (finalSignal === "LONG") {
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

    // ── Reason String ─────────────────────────────────────────────────────
    const smcParts: string[] = [];
    const isBullishDir = finalSignal === "LONG" || (finalSignal === "HOLD" && longConfidence >= shortConfidence);
    if (isBullishDir) {
      smcParts.push(`${primaryStructure}`);
      if (sweptLow)             smcParts.push("Liq Sweep ↓");
      if (bosResult.bullishBOS) smcParts.push(`BOS ↑${bosResult.bosLevel?.toFixed(0)}`);
      if (bullishOB)            smcParts.push(`Bull OB $${bullishOB.low.toFixed(0)}`);
      if (inBullishOB)          smcParts.push("In OB");
    } else {
      smcParts.push(`${primaryStructure}`);
      if (sweptHigh)            smcParts.push("Liq Sweep ↑");
      if (bosResult.bearishBOS) smcParts.push(`BOS ↓${bosResult.bosLevel?.toFixed(0)}`);
      if (bearishOB)            smcParts.push(`Bear OB $${bearishOB.high.toFixed(0)}`);
      if (inBearishOB)          smcParts.push("In OB");
    }

    let reason: string;
    if (finalSignal !== "HOLD") {
      const mlPart = mlPred.modelStatus === "trained"
        ? ` · ML ${mlPred.signal === finalSignal ? "✓" : "✗"} ${mlPred.confidence}%`
        : "";
      reason = `${signalStrength} ${finalSignal} [hybrid: ${hybridConfidence}%] — SMC: ${smcConfidence}% (${smcParts.join(", ")})${mlPart}`;
    } else if (finalSignal !== hybrid.finalSignal) {
      reason = `HOLD – cooldown ${Math.ceil(cooldownRemaining / 60)}m remaining`;
    } else if (isRanging) {
      reason = `HOLD – Sideways market (RANGING on 5m+15m) · SMC L:${longConfidence}% S:${shortConfidence}% · ML ${mlPred.signal} ${mlPred.confidence}%`;
    } else if (mlPred.modelStatus === "trained" && smcSignal === "HOLD") {
      reason = `HOLD – SMC incomplete (L:${longConfidence}% S:${shortConfidence}%) · ML ${mlPred.signal} ${mlPred.confidence}%`;
    } else if (smcSignal !== "HOLD" && signalStrength === null) {
      reason = `HOLD – SMC ${smcSignal} ${smcConfidence}% (need ≥${SMC_SOLO_THRESHOLD}% solo or ≥${SMC_AGREE_THRESHOLD}% with ML agreement)`;
    } else {
      reason = `HOLD – Waiting for confluence · L:${longConfidence}% S:${shortConfidence}%`;
    }

    if (finalSignal !== "HOLD") {
      lastSignalState = { signal: finalSignal, price: currentPrice, timestamp: now };
      lastSignalTime  = now;
    }

    // ── Populate OB / Sweep for display ───────────────────────────────────
    const activeOB: OrderBlockInfo | null =
      finalSignal === "LONG"  && bullishOB ? { type: "bullish", high: bullishOB.high, low: bullishOB.low } :
      finalSignal === "SHORT" && bearishOB ? { type: "bearish", high: bearishOB.high, low: bearishOB.low } :
      bullishOB && longConfidence >= shortConfidence  ? { type: "bullish", high: bullishOB.high, low: bullishOB.low } :
      bearishOB ? { type: "bearish", high: bearishOB.high, low: bearishOB.low } : null;

    const liquiditySweep =
      finalSignal === "LONG"  ? sweptLow  :
      finalSignal === "SHORT" ? sweptHigh :
      longConfidence >= shortConfidence ? sweptLow : sweptHigh;

    const liquiditySweepType: "equal_low" | "equal_high" | null = liquiditySweep
      ? (finalSignal === "LONG" || longConfidence >= shortConfidence ? "equal_low" : "equal_high")
      : null;

    const smcScore =
      finalSignal === "LONG"  ? longConfidence :
      finalSignal === "SHORT" ? shortConfidence :
      Math.max(longConfidence, shortConfidence);

    const result: SignalResult = {
      signal:     finalSignal,
      confidence: hybridConfidence,
      entryPrice: +currentPrice.toFixed(2),
      stopLoss,
      takeProfit,
      trend:      htTrend,
      reason,
      timestamp:  new Date().toISOString(),
      tradeDuration: "5-15 minutes",
      cooldownRemaining: finalSignal !== "HOLD" ? 0 : cooldownRemaining,
      smartMode,
      // Hybrid fields
      smcSignal,
      smcConfidence,
      signalStrength,
      hybridConfidence,
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
      // ML fields
      mlSignal:      mlPred.signal,
      mlConfidence:  mlPred.confidence,
      mlPLong:       mlPred.pLong,
      mlPShort:      mlPred.pShort,
      mlPNoTrade:    mlPred.pNoTrade,
      mlModelStatus: mlPred.modelStatus,
      mlTrainedOn:   mlPred.trainedOn,
      mlAccuracy:    mlPred.accuracy,
      mlEnabled:     signalStrength === "STRONG",
    };

    cachedSignal = result;
    return result;

  } catch (err) {
    logger.error({ err }, "Signal generation error");
    const slDist = 4;
    const { getMLStatus } = await import("./mlModel.js");
    const mlStatus = getMLStatus();
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
      smcSignal:        "HOLD",
      smcConfidence:    0,
      signalStrength:   null,
      hybridConfidence: 0,
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
      mlSignal:      "NO_TRADE",
      mlConfidence:  0,
      mlPLong:       34,
      mlPShort:      33,
      mlPNoTrade:    33,
      mlModelStatus: mlStatus.mlModelStatus,
      mlTrainedOn:   mlStatus.mlTrainedOn,
      mlAccuracy:    mlStatus.mlAccuracy,
      mlEnabled:     false,
    };
  }
}
