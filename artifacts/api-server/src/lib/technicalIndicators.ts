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
