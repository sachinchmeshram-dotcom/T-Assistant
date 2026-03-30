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
    // API field names stable; values represent scalping TFs
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
const COOLDOWN_MS        = 300_000; // 5-minute cooldown
const MIN_PRICE_MOVE_PCT = 0.001;   // 0.1% move breaks cooldown
const MIN_CONFIDENCE     = 52;
const MIN_SIGNAL_POINTS  = 6;       // Minimum to fire signal
const MIN_SEPARATION     = 2;       // Gap between winning and losing side

function scoreTrend(t: "BULLISH" | "BEARISH" | "NEUTRAL"): "BULLISH" | "BEARISH" | "NEUTRAL" {
  return t;
}

function overallTrend(
  t15: "BULLISH" | "BEARISH" | "NEUTRAL",
  t5:  "BULLISH" | "BEARISH" | "NEUTRAL",
  t1:  "BULLISH" | "BEARISH" | "NEUTRAL",
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

  if (cachedSignal && sinceLastSignal < SIGNAL_CACHE_TTL) {
    return { ...cachedSignal, cooldownRemaining };
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

    // ── EMAs ──────────────────────────────────────────────────────────────
    const ema9_1m   = calcEMA(closes1m, 9);
    const ema21_1m  = calcEMA(closes1m, 21);
    const ema20_5m  = calcEMA(closes5m, 20);
    const ema50_5m  = calcEMA(closes5m, 50);
    const ema20_15m = calcEMA(closes15m, 20);
    const ema50_15m = calcEMA(closes15m, 50);

    const ema9  = ema9_1m[ema9_1m.length - 1]   ?? currentPrice;
    const ema21 = ema21_1m[ema21_1m.length - 1]  ?? currentPrice;
    const ema20 = ema20_5m[ema20_5m.length - 1]  ?? currentPrice;
    const ema50 = ema50_5m[ema50_5m.length - 1]  ?? currentPrice;
    const ema200 = ema20_15m[ema20_15m.length - 1] ?? currentPrice;

    // ── Trends ────────────────────────────────────────────────────────────
    const trend15m = detectTrend(ema20_15m, ema50_15m);
    const trend5m  = detectTrend(ema20_5m, ema50_5m);
    const trend1m  = detectTrend(ema9_1m, ema21_1m);
    const htTrend  = overallTrend(trend15m, trend5m, trend1m);

    // ── RSI ───────────────────────────────────────────────────────────────
    // 5m RSI — confirmation layer
    const rsi5mArr  = calcRSI(closes5m, 14);
    const rsi       = rsi5mArr[rsi5mArr.length - 1] ?? 50;
    const rsiPrev   = rsi5mArr[rsi5mArr.length - 2] ?? 50;
    const rsiPrev2  = rsi5mArr[rsi5mArr.length - 3] ?? 50;
    const rsiRising  = rsi > rsiPrev;
    const rsiFalling = rsi < rsiPrev;
    const rsiWasRising = rsiPrev > rsiPrev2;

    // 1m RSI — fast momentum
    const rsi1mArr   = calcRSI(closes1m, 9);
    const rsi1m      = rsi1mArr[rsi1mArr.length - 1] ?? 50;
    const rsi1mPrev  = rsi1mArr[rsi1mArr.length - 2] ?? 50;
    const rsi1mRising  = rsi1m > rsi1mPrev;
    const rsi1mFalling = rsi1m < rsi1mPrev;

    // ── MACD on 5m ────────────────────────────────────────────────────────
    const { macdLine, signalLine, histogram } = calcMACD(closes5m);
    const macdVal      = macdLine[macdLine.length - 1] ?? 0;
    const macdSig      = signalLine[signalLine.length - 1] ?? 0;
    const macdHist     = histogram[histogram.length - 1] ?? 0;
    const macdPrevHist = histogram[histogram.length - 2] ?? 0;

    // Classic crossovers
    const macdBullCross = macdPrevHist < 0 && macdHist >= 0; // Zero-line cross up
    const macdBearCross = macdPrevHist > 0 && macdHist <= 0; // Zero-line cross down
    const macdBullish   = macdHist > 0 && macdHist > macdPrevHist;
    const macdBearish   = macdHist < 0 && macdHist < macdPrevHist;
    const macdImproving = macdHist > macdPrevHist;
    const macdWeakening = macdHist < macdPrevHist;

    // ── ATR on 1m ─────────────────────────────────────────────────────────
    const atrArr = calcATR(candles1m, 14);
    const atr    = atrArr[atrArr.length - 1] ?? 3;

    // ── Support/Resistance on 5m ──────────────────────────────────────────
    const { support, resistance } = findSupportResistance(candles5m, 20);
    const nearSupport    = currentPrice <= support * 1.004;
    const nearResistance = currentPrice >= resistance * 0.996;
    const atResistance   = currentPrice >= resistance * 0.999; // very close
    const atSupport      = currentPrice <= support * 1.001;    // very close

    // ── Distance from EMAs (extension measure) ────────────────────────────
    const distFromEma20pct = ((currentPrice - ema20) / ema20) * 100;
    const priceExtendedUp  = distFromEma20pct > 0.4;   // >0.4% above EMA20 → extended
    const priceExtendedDn  = distFromEma20pct < -0.4;  // >0.4% below EMA20 → extended

    // ══════════════════════════════════════════════════════════════════════
    // SCORING — each group is symmetric between LONG and SHORT
    // ══════════════════════════════════════════════════════════════════════
    const longPoints:  Array<{ reason: string; pts: number }> = [];
    const shortPoints: Array<{ reason: string; pts: number }> = [];

    // ── 1. 15m Trend (context only — intentionally low weight) ──────────
    // Knowing broader direction is useful but shouldn't dominate scalp signals
    if (trend15m === "BULLISH") longPoints.push({ reason: "15m trend bullish (context)", pts: 1 });
    if (trend15m === "BEARISH") shortPoints.push({ reason: "15m trend bearish (context)", pts: 1 });

    // ── 2. 5m Trend (primary scalp direction) ────────────────────────────
    if (trend5m === "BULLISH") longPoints.push({ reason: "5m trend bullish", pts: 2 });
    if (trend5m === "BEARISH") shortPoints.push({ reason: "5m trend bearish", pts: 2 });

    // ── 3. 1m Trend / EMA crossover (entry timing) ───────────────────────
    if (ema9 > ema21) longPoints.push({ reason: "1m EMA9>EMA21 (bullish cross)", pts: 2 });
    if (ema9 < ema21) shortPoints.push({ reason: "1m EMA9<EMA21 (bearish cross)", pts: 2 });

    // ── 4. RSI 5m — trend-following ──────────────────────────────────────
    // LONG: RSI in healthy bullish zone and rising
    if (rsi >= 40 && rsi <= 62 && rsiRising) {
      longPoints.push({ reason: `5m RSI ${rsi.toFixed(1)} rising (bull momentum)`, pts: 2 });
    } else if (rsi < 40 && rsi >= 30 && rsiRising) {
      longPoints.push({ reason: `5m RSI ${rsi.toFixed(1)} rising from oversold`, pts: 2 });
    } else if (rsi > 50 && rsiRising) {
      longPoints.push({ reason: `5m RSI ${rsi.toFixed(1)} above 50 & rising`, pts: 1 });
    }

    // SHORT: RSI in healthy bearish zone and falling
    if (rsi >= 38 && rsi <= 60 && rsiFalling) {
      shortPoints.push({ reason: `5m RSI ${rsi.toFixed(1)} falling (bear momentum)`, pts: 2 });
    } else if (rsi > 60 && rsi <= 70 && rsiFalling) {
      shortPoints.push({ reason: `5m RSI ${rsi.toFixed(1)} falling from high`, pts: 2 });
    } else if (rsi < 50 && rsiFalling) {
      shortPoints.push({ reason: `5m RSI ${rsi.toFixed(1)} below 50 & falling`, pts: 1 });
    }

    // ── 5. RSI Extreme — REVERSAL triggers (fire regardless of trend) ─────
    // Overbought reversal → SHORT scalp
    if (rsi >= 72) {
      const pts = rsi >= 78 ? 4 : 3;
      shortPoints.push({ reason: `5m RSI overbought at ${rsi.toFixed(1)} — reversal scalp`, pts });
    }
    // Oversold reversal → LONG scalp
    if (rsi <= 28) {
      const pts = rsi <= 22 ? 4 : 3;
      longPoints.push({ reason: `5m RSI oversold at ${rsi.toFixed(1)} — reversal scalp`, pts });
    }

    // ── 6. RSI peak/trough turn detection ────────────────────────────────
    // RSI was rising (peak) and now falling → potential SHORT
    if (rsi < rsiPrev && rsiWasRising && rsi >= 60) {
      shortPoints.push({ reason: `5m RSI peaked at ${rsiPrev.toFixed(1)} — turning down`, pts: 2 });
    }
    // RSI was falling (trough) and now rising → potential LONG
    if (rsi > rsiPrev && !rsiWasRising && rsi <= 40) {
      longPoints.push({ reason: `5m RSI troughed at ${rsiPrev.toFixed(1)} — turning up`, pts: 2 });
    }

    // ── 7. 1m RSI momentum ───────────────────────────────────────────────
    if (rsi1mRising)  longPoints.push({ reason: `1m RSI momentum up (${rsi1m.toFixed(1)})`, pts: 1 });
    if (rsi1mFalling) shortPoints.push({ reason: `1m RSI momentum down (${rsi1m.toFixed(1)})`, pts: 1 });

    // ── 8. MACD 5m — crossovers weighted highest ─────────────────────────
    if (macdBullCross) longPoints.push({ reason: "5m MACD zero-line bull cross", pts: 3 });
    else if (macdBullish) longPoints.push({ reason: "5m MACD histogram bullish & growing", pts: 2 });
    else if (macdImproving && macdVal > 0) longPoints.push({ reason: "5m MACD positive & improving", pts: 1 });

    if (macdBearCross) shortPoints.push({ reason: "5m MACD zero-line bear cross", pts: 3 });
    else if (macdBearish) shortPoints.push({ reason: "5m MACD histogram bearish & deepening", pts: 2 });
    else if (macdWeakening && macdVal < 0) shortPoints.push({ reason: "5m MACD negative & weakening", pts: 1 });

    // ── 9. EMA price structure (5m) ───────────────────────────────────────
    if (ema20 > ema50 && currentPrice > ema20) {
      longPoints.push({ reason: "5m price above EMA20 > EMA50", pts: 1 });
    } else if (ema20 > ema50) {
      longPoints.push({ reason: "5m EMA20 > EMA50 structure", pts: 1 });
    }
    if (ema20 < ema50 && currentPrice < ema20) {
      shortPoints.push({ reason: "5m price below EMA20 < EMA50", pts: 1 });
    } else if (ema20 < ema50) {
      shortPoints.push({ reason: "5m EMA20 < EMA50 structure", pts: 1 });
    }

    // ── 10. S/R levels ────────────────────────────────────────────────────
    if (atSupport)      longPoints.push({ reason: "price at scalping support", pts: 2 });
    else if (nearSupport) longPoints.push({ reason: "price near support zone", pts: 1 });

    if (atResistance)      shortPoints.push({ reason: "price at scalping resistance", pts: 2 });
    else if (nearResistance) shortPoints.push({ reason: "price near resistance zone", pts: 1 });

    // ── 11. Mean-reversion (price over-extended from EMA20) ───────────────
    // Price extended UP → SHORT scalp opportunity (even in uptrend)
    if (priceExtendedUp && (rsi > 65 || macdWeakening)) {
      shortPoints.push({ reason: `price ${distFromEma20pct.toFixed(2)}% above 5m EMA20 — extended`, pts: 2 });
    }
    // Price extended DOWN → LONG scalp opportunity
    if (priceExtendedDn && (rsi < 35 || macdImproving)) {
      longPoints.push({ reason: `price ${Math.abs(distFromEma20pct).toFixed(2)}% below 5m EMA20 — extended`, pts: 2 });
    }

    // ══════════════════════════════════════════════════════════════════════
    const longTotal  = longPoints.reduce((s, p) => s + p.pts, 0);
    const shortTotal = shortPoints.reduce((s, p) => s + p.pts, 0);

    let rawSignal: "LONG" | "SHORT" | "HOLD" = "HOLD";
    if (longTotal >= MIN_SIGNAL_POINTS && longTotal > shortTotal + MIN_SEPARATION) {
      rawSignal = "LONG";
    } else if (shortTotal >= MIN_SIGNAL_POINTS && shortTotal > longTotal + MIN_SEPARATION) {
      rawSignal = "SHORT";
    }

    // ── Cooldown guard ────────────────────────────────────────────────────
    const inCooldown     = sinceLastSignal < COOLDOWN_MS;
    const priceMoved     = lastSignalState
      ? Math.abs(currentPrice - lastSignalState.price) / lastSignalState.price >= MIN_PRICE_MOVE_PCT
      : true;
    const oppositeSignal = lastSignalState && rawSignal !== "HOLD" && rawSignal !== lastSignalState.signal;

    let finalSignal: "LONG" | "SHORT" | "HOLD" = rawSignal;
    if (rawSignal !== "HOLD" && inCooldown && !priceMoved && !oppositeSignal) {
      finalSignal = "HOLD";
    }

    // ── Confidence ────────────────────────────────────────────────────────
    const activeTotal   = finalSignal === "LONG" ? longTotal : finalSignal === "SHORT" ? shortTotal : Math.max(longTotal, shortTotal);
    const indicatorConf = Math.min(40, (activeTotal / 16) * 40);

    const rsiDev        = Math.abs(rsi - 50);
    const momentumConf  = Math.min(25, (rsiDev / 30) * 25);

    const separation    = Math.abs(longTotal - shortTotal);
    const separConf     = Math.min(20, (separation / 8) * 20);

    const atrAvg   = 3;
    const atrRatio = atr / atrAvg;
    const volConf  = atrRatio >= 0.3 && atrRatio <= 3.0 ? 15 : 5;

    const confidence = Math.round(Math.min(100, indicatorConf + momentumConf + separConf + volConf));

    if (confidence < MIN_CONFIDENCE && finalSignal !== "HOLD") {
      finalSignal = "HOLD";
    }

    // ── SL / TP (scalping tight levels) ──────────────────────────────────
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

    // ── Reason ────────────────────────────────────────────────────────────
    let reason: string;
    if (finalSignal === "LONG") {
      const top = longPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `LONG scalp: ${top.join("; ")}`;
    } else if (finalSignal === "SHORT") {
      const top = shortPoints.slice().sort((a, b) => b.pts - a.pts).slice(0, 4).map(p => p.reason);
      reason = `SHORT scalp: ${top.join("; ")}`;
    } else if (rawSignal !== "HOLD" && inCooldown) {
      reason = `HOLD – cooldown (${Math.ceil(cooldownRemaining / 60)}m left). Wait for price confirmation.`;
    } else {
      reason = `HOLD – signals mixed (long: ${longTotal} pts, short: ${shortTotal} pts). Need ≥${MIN_SIGNAL_POINTS} pts with ${MIN_SEPARATION}+ pt gap.`;
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
        trend1h:  trend15m, // 15m context
        trend15m: trend5m,  // 5m confirmation
        trend5m:  trend1m,  // 1m entry
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
