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
import { predictLSTM, type LSTMPrediction, type MLModelStatus } from "./lstmModel.js";
import { logger } from "./logger.js";

export interface OrderBlockInfo {
  type: "bullish" | "bearish";
  high: number;
  low: number;
}

export interface SessionInfo {
  london: boolean;
  newYork: boolean;
  asian: boolean;
  active: string;
}

export interface PivotPoints {
  pivot: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
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
  session: SessionInfo;
  pivots: PivotPoints | null;
  // ── Hybrid AI fields ──────────────────────────────────────────────────────
  smcSignal:       "LONG" | "SHORT" | "HOLD";
  smcConfidence:   number;
  signalStrength:  "STRONG" | "NORMAL" | null;
  hybridConfidence: number;
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
    // Intraday timeframes — stored in these fields:
    // trend1h  → 4H trend  (highest context)
    // trend15m → 1H trend  (confirmation)
    // trend5m  → 15m trend (entry refinement)
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

// ── Intraday constants ────────────────────────────────────────────────────
const SIGNAL_CACHE_TTL   = 300_000;   // 5 minutes — intraday signals are stable
const COOLDOWN_MS        = 14_400_000; // 4 hours cooldown between signals
const MIN_PRICE_MOVE_PCT = 0.004;      // 0.4% price move to override cooldown

// ── SMC confidence thresholds ─────────────────────────────────────────────
const SMC_AGREE_THRESHOLD   = 60;
const SMC_SOLO_THRESHOLD    = 80;
const RANGING_AGREE_EXTRA   = 10;
const RANGING_SOLO_EXTRA    = 8;
// Asian session = lower liquidity → raise thresholds
const ASIAN_AGREE_EXTRA     = 15;
const ASIAN_SOLO_EXTRA      = 12;

// ── Session detection ─────────────────────────────────────────────────────
function getCurrentSession(): SessionInfo {
  const h = new Date().getUTCHours();
  const london  = h >= 7  && h < 17;   // 07:00–17:00 UTC
  const newYork = h >= 13 && h < 22;   // 13:00–22:00 UTC
  const asian   = h >= 22 || h < 7;    // 22:00–07:00 UTC

  const active =
    london && newYork ? "London / New York" :
    london            ? "London" :
    newYork           ? "New York" :
    asian             ? "Asian" :
    "Off-hours";

  return { london, newYork, asian, active };
}

// ── Daily pivot points from the previous candle ───────────────────────────
function calcPivotPoints(high: number, low: number, close: number): PivotPoints {
  const pivot = (high + low + close) / 3;
  const r1 = 2 * pivot - low;
  const r2 = pivot + (high - low);
  const s1 = 2 * pivot - high;
  const s2 = pivot - (high - low);
  return {
    pivot: +pivot.toFixed(2),
    r1:    +r1.toFixed(2),
    r2:    +r2.toFixed(2),
    s1:    +s1.toFixed(2),
    s2:    +s2.toFixed(2),
  };
}

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

  // Intraday RSI zones: wider mid-range acceptable
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
  t4h: string, t1h: string, t15: string
): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const score =
    (t4h  === "BULLISH" ? 1 : t4h  === "BEARISH" ? -1 : 0) +
    (t1h  === "BULLISH" ? 1 : t1h  === "BEARISH" ? -1 : 0) +
    (t15  === "BULLISH" ? 1 : t15  === "BEARISH" ? -1 : 0);
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
  mlPred:      LSTMPrediction;
  isRanging:   boolean;
  isAsian:     boolean;
  smartMode:   boolean;
  winRate:     number;
  sufficientData: boolean;
}): HybridDecision {
  const { longConf, shortConf, mlPred, isRanging, isAsian, smartMode, winRate, sufficientData } = opts;

  let agreeThreshold = SMC_AGREE_THRESHOLD;
  let soloThreshold  = SMC_SOLO_THRESHOLD;

  if (isRanging) {
    agreeThreshold += RANGING_AGREE_EXTRA;
    soloThreshold  += RANGING_SOLO_EXTRA;
  }

  // Asian session: require higher conviction (thin liquidity)
  if (isAsian) {
    agreeThreshold += ASIAN_AGREE_EXTRA;
    soloThreshold  += ASIAN_SOLO_EXTRA;
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

  const smcSignal: "LONG" | "SHORT" | "HOLD" =
    longConf  >= agreeThreshold && longConf  > shortConf + 5 ? "LONG"  :
    shortConf >= agreeThreshold && shortConf > longConf  + 5 ? "SHORT" :
    "HOLD";

  const dominantSmcConf = smcSignal === "LONG"  ? longConf
                        : smcSignal === "SHORT" ? shortConf
                        : Math.max(longConf, shortConf);

  const mlTrained = mlPred.modelStatus === "trained";
  const effectiveMlSignal = mlTrained ? mlPred.signal : "NO_TRADE";

  const agreed =
    smcSignal !== "HOLD" &&
    effectiveMlSignal !== "NO_TRADE" &&
    smcSignal === effectiveMlSignal;

  let signalStrength: "STRONG" | "NORMAL" | null = null;

  if (agreed && longConf >= agreeThreshold || agreed && shortConf >= agreeThreshold) {
    signalStrength = "STRONG";
  } else if (smcSignal !== "HOLD" && dominantSmcConf >= soloThreshold) {
    signalStrength = "NORMAL";
  }

  const finalSignal: "LONG" | "SHORT" | "HOLD" =
    signalStrength !== null ? smcSignal : "HOLD";

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
  const session = getCurrentSession();

  if (cachedSignal && sinceLastSignal < SIGNAL_CACHE_TTL) {
    return { ...cachedSignal, cooldownRemaining, smartMode, session };
  }

  const analytics = await getAnalyticsSummary();

  try {
    // ── Intraday timeframes: 4H context, 1H confirmation, 15m entry ──────────
    const [candles4h, candles1h, candles15m, candles1d] = await Promise.all([
      fetchOHLC("4h"),
      fetchOHLC("1h"),
      fetchOHLC("15m"),
      fetchOHLC("1d"),
    ]);

    const closes4h  = candles4h.map(c => c.close);
    const closes1h  = candles1h.map(c => c.close);
    const closes15m = candles15m.map(c => c.close);

    // ── EMAs ──────────────────────────────────────────────────────────────
    const ema20_4h  = calcEMA(closes4h, 20);
    const ema50_4h  = calcEMA(closes4h, 50);
    const ema20_1h  = calcEMA(closes1h, 20);
    const ema50_1h  = calcEMA(closes1h, 50);
    const ema200_1h = calcEMA(closes1h, 200);
    const ema20_15m = calcEMA(closes15m, 20);
    const ema50_15m = calcEMA(closes15m, 50);

    // Primary EMAs for signal display (1H-based)
    const ema20  = ema20_1h[ema20_1h.length - 1]   ?? currentPrice;
    const ema50  = ema50_1h[ema50_1h.length - 1]   ?? currentPrice;
    const ema200 = ema200_1h[ema200_1h.length - 1] ?? currentPrice;

    // ── Trend Detection ───────────────────────────────────────────────────
    const trend4h  = detectTrend(ema20_4h,  ema50_4h);   // stored as trend1h
    const trend1h  = detectTrend(ema20_1h,  ema50_1h);   // stored as trend15m
    const trend15m = detectTrend(ema20_15m, ema50_15m);  // stored as trend5m
    const htTrend  = overallTrend(trend4h, trend1h, trend15m);

    // ── RSI / MACD from 1H ────────────────────────────────────────────────
    const rsi1hArr = calcRSI(closes1h, 14);
    const rsi      = rsi1hArr[rsi1hArr.length - 1] ?? 50;

    const { macdLine, signalLine, histogram } = calcMACD(closes1h);
    const macdVal      = macdLine[macdLine.length - 1]    ?? 0;
    const macdSig      = signalLine[signalLine.length - 1] ?? 0;
    const macdHist     = histogram[histogram.length - 1]   ?? 0;
    const macdPrevHist = histogram[histogram.length - 2]   ?? 0;
    const macdBullish  = macdHist > 0 && macdHist > macdPrevHist;
    const macdBearish  = macdHist < 0 && macdHist < macdPrevHist;

    // ── ATR from 1H ───────────────────────────────────────────────────────
    const atrArr = calcATR(candles1h, 14);
    const atr    = atrArr[atrArr.length - 1] ?? 8;

    const { support, resistance } = findSupportResistance(candles1h, 20);

    // ── Pivot Points from yesterday's daily candle ─────────────────────────
    let pivots: PivotPoints | null = null;
    if (candles1d.length >= 2) {
      const prev = candles1d[candles1d.length - 2];
      pivots = calcPivotPoints(prev.high, prev.low, prev.close);
    }

    // ── SMC Analysis on 1H + 4H ───────────────────────────────────────────
    const ms4h = detectMarketStructure(candles4h);
    const ms1h = detectMarketStructure(candles1h);

    const primaryStructure = ms1h.structure;
    const contextStructure = ms4h.structure;

    const isRanging =
      primaryStructure === "RANGING" && contextStructure === "RANGING";

    const liqZones1h = detectLiquidityZones(candles1h, 0.0012);
    const sweptLow   = liqZones1h.some(z => z.type === "equal_low"  && z.swept);
    const sweptHigh  = liqZones1h.some(z => z.type === "equal_high" && z.swept);

    const bosResult = detectBOS(candles1h, ms1h);

    const { bullishOB, bearishOB } = detectOrderBlocks(candles1h, 40);

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

    // ── LSTM on 1H candles ────────────────────────────────────────────────
    const mlPred = predictLSTM(candles1h.slice(-50));

    // ── Hybrid Decision ───────────────────────────────────────────────────
    const hybrid = hybridDecide({
      longConf:      longConfidence,
      shortConf:     shortConfidence,
      mlPred,
      isRanging,
      isAsian:       session.asian,
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

    // ── Intraday SL / TP — wider distances via ATR ────────────────────────
    // SL: 1.5× ATR (min $8), TP: 2.5× SL  →  1:1.67 R:R minimum
    const slDist = Math.max(atr * 1.5, 8);
    let stopLoss: number;
    let takeProfit: number;

    if (finalSignal === "LONG") {
      const slBase = bullishOB ? Math.min(bullishOB.low - 1.0, support - 0.5) : support - 0.5;
      stopLoss   = +Math.min(currentPrice - slDist, slBase).toFixed(2);
      takeProfit = +(currentPrice + slDist * 2.5).toFixed(2);
    } else if (finalSignal === "SHORT") {
      const slBase = bearishOB ? Math.max(bearishOB.high + 1.0, resistance + 0.5) : resistance + 0.5;
      stopLoss   = +Math.max(currentPrice + slDist, slBase).toFixed(2);
      takeProfit = +(currentPrice - slDist * 2.5).toFixed(2);
    } else {
      stopLoss   = +(currentPrice - slDist).toFixed(2);
      takeProfit = +(currentPrice + slDist * 2.0).toFixed(2);
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

    const sessionNote = `[${session.active}]`;

    let reason: string;
    if (finalSignal !== "HOLD") {
      const mlPart = mlPred.modelStatus === "trained"
        ? ` · LSTM ${mlPred.signal === finalSignal ? "✓" : "✗"} ${mlPred.confidence}%`
        : "";
      reason = `${signalStrength} ${finalSignal} ${sessionNote} [hybrid: ${hybridConfidence}%] — SMC 1H/4H: ${smcConfidence}% (${smcParts.join(", ")})${mlPart}`;
    } else if (finalSignal !== hybrid.finalSignal) {
      const hLeft = Math.floor(cooldownRemaining / 3600);
      const mLeft = Math.ceil((cooldownRemaining % 3600) / 60);
      reason = `HOLD – cooldown ${hLeft > 0 ? `${hLeft}h ` : ""}${mLeft}m remaining`;
    } else if (session.asian && smcSignal !== "HOLD") {
      reason = `HOLD – Asian session (low liquidity); raising thresholds · SMC ${smcSignal} ${smcConfidence}%`;
    } else if (isRanging) {
      reason = `HOLD – Sideways market (RANGING on 1H+4H) ${sessionNote} · SMC L:${longConfidence}% S:${shortConfidence}% · LSTM ${mlPred.signal} ${mlPred.confidence}%`;
    } else if (mlPred.modelStatus === "trained" && smcSignal === "HOLD") {
      reason = `HOLD – SMC incomplete (L:${longConfidence}% S:${shortConfidence}%) ${sessionNote} · LSTM ${mlPred.signal} ${mlPred.confidence}%`;
    } else if (smcSignal !== "HOLD" && signalStrength === null) {
      reason = `HOLD – SMC ${smcSignal} ${smcConfidence}% below threshold ${sessionNote}`;
    } else {
      reason = `HOLD – Waiting for confluence ${sessionNote} · L:${longConfidence}% S:${shortConfidence}%`;
    }

    if (finalSignal !== "HOLD") {
      lastSignalState = { signal: finalSignal, price: currentPrice, timestamp: now };
      lastSignalTime  = now;
    }

    // ── Populate OB for display ────────────────────────────────────────────
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
      tradeDuration: "2-8 hours",
      cooldownRemaining: finalSignal !== "HOLD" ? 0 : cooldownRemaining,
      smartMode,
      session,
      pivots,
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
        trend1h:  trend4h,   // 4H context  → trend1h field
        trend15m: trend1h,   // 1H confirm  → trend15m field
        trend5m:  trend15m,  // 15m entry   → trend5m field
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
    const slDist = 10;
    const { getLSTMStatus } = await import("./lstmModel.js");
    const mlStatus = getLSTMStatus();
    return {
      signal: "HOLD",
      confidence: 0,
      entryPrice: +currentPrice.toFixed(2),
      stopLoss:   +(currentPrice - slDist).toFixed(2),
      takeProfit: +(currentPrice + slDist * 2.0).toFixed(2),
      trend: "NEUTRAL",
      reason: "HOLD – market data unavailable",
      timestamp: new Date().toISOString(),
      tradeDuration: "2-8 hours",
      cooldownRemaining,
      smartMode,
      session: getCurrentSession(),
      pivots: null,
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
        macdLine: 0, macdSignal: 0, macdHistogram: 0, atr: 8,
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
