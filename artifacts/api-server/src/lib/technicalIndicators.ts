import type { OHLCCandle } from "./goldPrice.js";

export function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  if (closes.length === 0) return ema;
  ema[0] = closes[0];
  for (let i = 1; i < closes.length; i++) {
    ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

export function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(period).fill(50);
  if (closes.length < period + 1) return rsi;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const delta = closes[i] - closes[i - 1];
      const gain = delta > 0 ? delta : 0;
      const loss = delta < 0 ? Math.abs(delta) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }

  return rsi;
}

export function calcMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const ema12 = calcEMA(closes, fastPeriod);
  const ema26 = calcEMA(closes, slowPeriod);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine.slice(slowPeriod), signalPeriod);
  const padded = new Array(slowPeriod).fill(0).concat(signalLine);
  const histogram = macdLine.map((v, i) => v - (padded[i] ?? 0));
  return { macdLine, signalLine: padded, histogram };
}

export function calcATR(candles: OHLCCandle[], period = 14): number[] {
  if (candles.length < 2) return [0];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  const atrs: number[] = [];
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  atrs.push(atr);
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    atrs.push(atr);
  }
  return atrs;
}

export function detectTrend(ema50: number[], ema200: number[]): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (ema50.length === 0 || ema200.length === 0) return "NEUTRAL";
  const last50 = ema50[ema50.length - 1];
  const last200 = ema200[ema200.length - 1];
  const diff = (last50 - last200) / last200;
  if (diff > 0.001) return "BULLISH";
  if (diff < -0.001) return "BEARISH";
  return "NEUTRAL";
}

export function findSupportResistance(candles: OHLCCandle[], lookback = 20): {
  support: number;
  resistance: number;
} {
  const recent = candles.slice(-lookback);
  const lows = recent.map(c => c.low);
  const highs = recent.map(c => c.high);
  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart Money Concept (SMC) Detection
// ─────────────────────────────────────────────────────────────────────────────

export interface SwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
}

export interface MarketStructureResult {
  structure: "UPTREND" | "DOWNTREND" | "RANGING";
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  lastHH: number | null;
  lastHL: number | null;
  lastLH: number | null;
  lastLL: number | null;
}

export interface LiquidityZone {
  price: number;
  type: "equal_high" | "equal_low";
  swept: boolean;
}

export interface OrderBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  index: number;
  mitigated: boolean;
}

export interface BOSResult {
  bullishBOS: boolean;
  bearishBOS: boolean;
  bosLevel: number | null;
}

// Internal: find pivot swing highs and lows
function detectSwings(
  candles: OHLCCandle[],
  leftBars = 3,
  rightBars = 3
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const c = candles[i];

    const isSwingHigh =
      candles.slice(i - leftBars, i).every(l => l.high <= c.high) &&
      candles.slice(i + 1, i + rightBars + 1).every(r => r.high < c.high);

    const isSwingLow =
      candles.slice(i - leftBars, i).every(l => l.low >= c.low) &&
      candles.slice(i + 1, i + rightBars + 1).every(r => r.low > c.low);

    if (isSwingHigh) highs.push({ index: i, price: c.high, type: "high" });
    if (isSwingLow)  lows.push({ index: i, price: c.low,  type: "low" });
  }

  return { highs, lows };
}

// Classify market structure via HH/HL (uptrend) or LH/LL (downtrend)
export function detectMarketStructure(candles: OHLCCandle[]): MarketStructureResult {
  const { highs, lows } = detectSwings(candles, 3, 3);

  if (highs.length < 2 || lows.length < 2) {
    return {
      structure: "RANGING",
      swingHighs: highs,
      swingLows: lows,
      lastHH: null, lastHL: null,
      lastLH: null, lastLL: null,
    };
  }

  const lastHigh = highs[highs.length - 1].price;
  const prevHigh = highs[highs.length - 2].price;
  const lastLow  = lows[lows.length - 1].price;
  const prevLow  = lows[lows.length - 2].price;

  const isHH = lastHigh > prevHigh;
  const isHL = lastLow  > prevLow;
  const isLH = lastHigh < prevHigh;
  const isLL = lastLow  < prevLow;

  let structure: "UPTREND" | "DOWNTREND" | "RANGING" = "RANGING";
  if (isHH && isHL) structure = "UPTREND";
  else if (isLH && isLL) structure = "DOWNTREND";

  return {
    structure,
    swingHighs: highs,
    swingLows: lows,
    lastHH: isHH ? lastHigh : null,
    lastHL: isHL ? lastLow  : null,
    lastLH: isLH ? lastHigh : null,
    lastLL: isLL ? lastLow  : null,
  };
}

// Find equal highs/lows within tolerance and whether they've been swept (grabbed)
export function detectLiquidityZones(
  candles: OHLCCandle[],
  tolerance = 0.0012
): LiquidityZone[] {
  if (candles.length < 6) return [];

  const { highs, lows } = detectSwings(candles, 2, 2);
  const zones: LiquidityZone[] = [];

  const last = candles[candles.length - 1];
  const currentHigh  = last.high;
  const currentLow   = last.low;
  const currentClose = last.close;

  // Equal highs
  const seenHighZones = new Set<number>();
  for (let i = 0; i < highs.length - 1; i++) {
    for (let j = i + 1; j < highs.length; j++) {
      const diff = Math.abs(highs[i].price - highs[j].price) / highs[i].price;
      if (diff <= tolerance) {
        const zonePrice = (highs[i].price + highs[j].price) / 2;
        const key = Math.round(zonePrice * 100);
        if (!seenHighZones.has(key)) {
          seenHighZones.add(key);
          const swept = currentHigh > zonePrice && currentClose < zonePrice;
          zones.push({ price: +zonePrice.toFixed(2), type: "equal_high", swept });
        }
      }
    }
  }

  // Equal lows
  const seenLowZones = new Set<number>();
  for (let i = 0; i < lows.length - 1; i++) {
    for (let j = i + 1; j < lows.length; j++) {
      const diff = Math.abs(lows[i].price - lows[j].price) / lows[i].price;
      if (diff <= tolerance) {
        const zonePrice = (lows[i].price + lows[j].price) / 2;
        const key = Math.round(zonePrice * 100);
        if (!seenLowZones.has(key)) {
          seenLowZones.add(key);
          const swept = currentLow < zonePrice && currentClose > zonePrice;
          zones.push({ price: +zonePrice.toFixed(2), type: "equal_low", swept });
        }
      }
    }
  }

  return zones;
}

// Detect Break of Structure — current candle closes beyond a swing high/low
export function detectBOS(
  candles: OHLCCandle[],
  ms: MarketStructureResult
): BOSResult {
  if (candles.length < 4) {
    return { bullishBOS: false, bearishBOS: false, bosLevel: null };
  }

  const current = candles[candles.length - 1];
  const prev    = candles[candles.length - 2];

  const lastSwingHigh = ms.swingHighs.length > 0
    ? ms.swingHighs[ms.swingHighs.length - 1].price
    : null;
  const lastSwingLow = ms.swingLows.length > 0
    ? ms.swingLows[ms.swingLows.length - 1].price
    : null;

  // BOS confirmed when this candle closes beyond the swing level AND previous candle was also pushing
  const bullishBOS =
    lastSwingHigh !== null &&
    current.close > lastSwingHigh &&
    prev.close > (lastSwingHigh * 0.9995);   // prev was near or above

  const bearishBOS =
    lastSwingLow !== null &&
    current.close < lastSwingLow &&
    prev.close < (lastSwingLow * 1.0005);

  const bosLevel = bullishBOS ? lastSwingHigh
    : bearishBOS ? lastSwingLow
    : null;

  return { bullishBOS, bearishBOS, bosLevel };
}

// Find the most recent unmitigated Order Blocks
// Bullish OB = last bearish candle before a strong bullish impulse
// Bearish OB = last bullish candle before a strong bearish impulse
export function detectOrderBlocks(
  candles: OHLCCandle[],
  lookback = 40
): { bullishOB: OrderBlock | null; bearishOB: OrderBlock | null } {
  const n = candles.length;
  if (n < 5) return { bullishOB: null, bearishOB: null };

  const slice = candles.slice(Math.max(0, n - lookback));
  const len = slice.length;
  const IMPULSE_MOVE_PCT = 0.0015;

  let bullishOB: OrderBlock | null = null;
  let bearishOB: OrderBlock | null = null;

  const currentClose = slice[len - 1].close;

  // Scan from most recent backwards to find latest unmitigated OBs
  for (let i = len - 3; i >= 1; i--) {
    const c    = slice[i];
    const next = slice[i + 1];
    const nn   = slice[i + 2];

    // ── Bullish OB ───────────────────────────────────────────────────────────
    if (!bullishOB) {
      const bullishImpulse =
        next.close > next.open &&
        nn.close   > nn.open   &&
        (nn.close - c.low) / Math.max(c.low, 0.01) > IMPULSE_MOVE_PCT;

      if (bullishImpulse && c.close < c.open) {
        // Check if OB has been mitigated (price traded back below OB low)
        const futureCandlesAfterOB = slice.slice(i + 1);
        const mitigated = futureCandlesAfterOB.some(fc => fc.close < c.low);
        if (!mitigated) {
          const inZone = currentClose >= c.low * 0.999 && currentClose <= c.high * 1.001;
          bullishOB = {
            type: "bullish",
            high: +c.high.toFixed(2),
            low:  +c.low.toFixed(2),
            index: i,
            mitigated: false,
          };
          // If in zone, break immediately — this is our entry OB
          if (inZone) break;
        }
      }
    }

    // ── Bearish OB ───────────────────────────────────────────────────────────
    if (!bearishOB) {
      const bearishImpulse =
        next.close < next.open &&
        nn.close   < nn.open   &&
        (c.high - nn.close) / Math.max(c.high, 0.01) > IMPULSE_MOVE_PCT;

      if (bearishImpulse && c.close > c.open) {
        const futureCandlesAfterOB = slice.slice(i + 1);
        const mitigated = futureCandlesAfterOB.some(fc => fc.close > c.high);
        if (!mitigated) {
          bearishOB = {
            type: "bearish",
            high: +c.high.toFixed(2),
            low:  +c.low.toFixed(2),
            index: i,
            mitigated: false,
          };
          if (currentClose >= bearishOB.low * 0.999 && currentClose <= bearishOB.high * 1.001) break;
        }
      }
    }

    if (bullishOB && bearishOB) break;
  }

  return { bullishOB, bearishOB };
}
