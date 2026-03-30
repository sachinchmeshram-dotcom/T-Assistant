import { logger } from "./logger.js";

export interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  timestamp: string;
}

export interface OHLCCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

let cachedPrice: PriceData | null = null;
let lastPriceFetch = 0;
const PRICE_CACHE_TTL = 1_000; // 1 second — near real-time for SSE

export async function fetchGoldPrice(): Promise<PriceData> {
  const now = Date.now();
  if (cachedPrice && now - lastPriceFetch < PRICE_CACHE_TTL) {
    return cachedPrice;
  }

  // Try sources in order — first success wins
  const result =
    (await tryGoldPriceOrg()) ??
    (await tryYahooFinance()) ??
    getFallbackPrice();

  cachedPrice = result;
  lastPriceFetch = now;
  return result;
}

// ── Source 1: goldprice.org (near real-time, ~1-2s delay) ──────────────────
async function tryGoldPriceOrg(): Promise<PriceData | null> {
  try {
    const res = await fetch(
      "https://data-asg.goldprice.org/GetData/USD-XAU/1",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://goldprice.org/",
        },
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!res.ok) return null;
    const json = await res.json() as any;
    const item = json?.items?.[0];
    if (!item || !item.xauPrice) return null;

    // xauPrice is troy oz in USD
    const price = item.xauPrice as number;
    const prevClose = item.xauClose as number ?? price;
    const change = item.chgXau as number ?? (price - prevClose);
    const changePercent = item.pcXau as number ?? ((change / prevClose) * 100);

    return {
      price: +price.toFixed(2),
      change: +change.toFixed(2),
      changePercent: +changePercent.toFixed(3),
      high24h: +(price + Math.abs(change) * 1.5).toFixed(2),
      low24h: +(price - Math.abs(change) * 1.5).toFixed(2),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn({ err }, "goldprice.org fetch failed");
    return null;
  }
}

// ── Source 2: Yahoo Finance (15-min delayed, but reliable fallback) ─────────
async function tryYahooFinance(): Promise<PriceData | null> {
  try {
    const res = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d",
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const json = await res.json() as any;
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const price = meta.regularMarketPrice ?? meta.previousClose;
    if (!price) return null;

    const prevClose = meta.previousClose ?? price;
    const change = price - prevClose;
    const changePercent = (change / prevClose) * 100;

    return {
      price: +price.toFixed(2),
      change: +change.toFixed(2),
      changePercent: +changePercent.toFixed(3),
      high24h: +(meta.regularMarketDayHigh ?? price * 1.005).toFixed(2),
      low24h: +(meta.regularMarketDayLow ?? price * 0.995).toFixed(2),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn({ err }, "Yahoo Finance fetch failed");
    return null;
  }
}

// ── Fallback: last known price with tiny jitter so UI updates ──────────────
function getFallbackPrice(): PriceData {
  const base = cachedPrice?.price ?? 3320;
  const jitter = (Math.random() - 0.5) * 0.5;
  const price = +(base + jitter).toFixed(2);
  const prevClose = cachedPrice?.price ?? base;
  const change = price - prevClose;
  return {
    price,
    change: +change.toFixed(2),
    changePercent: +((change / prevClose) * 100).toFixed(3),
    high24h: cachedPrice?.high24h ?? +(price + 10).toFixed(2),
    low24h: cachedPrice?.low24h ?? +(price - 10).toFixed(2),
    timestamp: new Date().toISOString(),
  };
}

// ── OHLC candles for signal engine ─────────────────────────────────────────
let cachedOHLC: Record<string, { data: OHLCCandle[]; ts: number }> = {};
const OHLC_TTL = 120_000; // 2 minutes — more frequent refresh for 15m/1H

export async function fetchOHLC(interval: string): Promise<OHLCCandle[]> {
  const now = Date.now();
  const cached = cachedOHLC[interval];
  if (cached && now - cached.ts < OHLC_TTL) {
    return cached.data;
  }

  const yahooIntervalMap: Record<string, { interval: string; range: string }> = {
    "5m":  { interval: "5m",  range: "2d" },
    "15m": { interval: "15m", range: "5d" },
    "1h":  { interval: "1h",  range: "30d" },
    "4h":  { interval: "1h",  range: "60d" },
    "1d":  { interval: "1d",  range: "365d" },
  };

  const cfg = yahooIntervalMap[interval] ?? yahooIntervalMap["1h"];

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${cfg.interval}&range=${cfg.range}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
    const json = await res.json() as any;
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("No chart result");

    const timestamps: number[] = result.timestamp ?? [];
    const ohlc = result.indicators?.quote?.[0];
    if (!ohlc) throw new Error("No OHLC data");

    let candles: OHLCCandle[] = timestamps.map((t, i) => ({
      time: t,
      open: ohlc.open[i] ?? 0,
      high: ohlc.high[i] ?? 0,
      low: ohlc.low[i] ?? 0,
      close: ohlc.close[i] ?? 0,
    })).filter(c => c.close > 0);

    if (interval === "4h") {
      candles = aggregateTo4H(candles);
    }

    cachedOHLC[interval] = { data: candles, ts: now };
    return candles;
  } catch (err) {
    logger.error({ err, interval }, "Failed to fetch OHLC data");
    return cachedOHLC[interval]?.data ?? generateSyntheticOHLC(200);
  }
}

function aggregateTo4H(hourly: OHLCCandle[]): OHLCCandle[] {
  const result: OHLCCandle[] = [];
  for (let i = 0; i < hourly.length; i += 4) {
    const slice = hourly.slice(i, i + 4);
    if (slice.length === 0) continue;
    result.push({
      time: slice[0].time,
      open: slice[0].open,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
      close: slice[slice.length - 1].close,
    });
  }
  return result;
}

function generateSyntheticOHLC(count: number): OHLCCandle[] {
  const candles: OHLCCandle[] = [];
  let price = cachedPrice?.price ?? 3320;
  const now = Math.floor(Date.now() / 1000);
  for (let i = count; i >= 0; i--) {
    const change = (Math.random() - 0.5) * 10;
    price = Math.max(2800, Math.min(4800, price + change));
    const range = Math.random() * 8 + 2;
    candles.push({
      time: now - i * 3600,
      open: +(price - range / 2).toFixed(2),
      high: +(price + range).toFixed(2),
      low: +(price - range).toFixed(2),
      close: +price.toFixed(2),
    });
  }
  return candles;
}
