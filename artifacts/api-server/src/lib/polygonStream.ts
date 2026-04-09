import WebSocket from "ws";
import { setLatestPrice, buildLivePrice, type LivePrice } from "./priceEvents.js";
import { fetchGoldPrice } from "./goldPrice.js";
import { logger } from "./logger.js";

const SPREAD = 0.35;
const FINNHUB_WS_BASE = "wss://ws.finnhub.io";
// Finnhub free-tier symbol for XAU/USD via OANDA feed
const GOLD_SYMBOL = "OANDA:XAU_USD";

const RECONNECT_DELAY_BASE = 5_000;
const RECONNECT_DELAY_MAX  = 120_000;

let ws: WebSocket | null = null;
let reconnectDelay = RECONNECT_DELAY_BASE;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let finnhubConnected = false;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;

// ── Goldprice.org fallback polling ─────────────────────────────────────────
function startFallbackPolling() {
  if (fallbackTimer) return;
  logger.info("Starting goldprice.org fallback polling (500ms)");
  fallbackTimer = setInterval(async () => {
    if (finnhubConnected) return;
    try {
      const raw = await fetchGoldPrice();
      const live = buildLivePrice(raw, SPREAD, "goldprice");
      setLatestPrice(live);
    } catch {
      // ignore
    }
  }, 500);
}

function stopFallbackPolling() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
    logger.info("Fallback polling stopped (Finnhub is live)");
  }
}

// ── Finnhub message handler ────────────────────────────────────────────────
function handleMessage(raw: string) {
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return; }
  if (typeof msg !== "object" || msg === null) return;

  const ev = msg as Record<string, unknown>;
  const type = ev["type"] as string;

  // Trade tick — this is the real-time price
  if (type === "trade") {
    const ticks = ev["data"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(ticks) || ticks.length === 0) return;

    // Use the latest tick in the batch
    const tick = ticks[ticks.length - 1];
    const price = tick["p"] as number | undefined;
    const t     = tick["t"] as number | undefined;
    if (!price) return;

    const live: LivePrice = {
      price:         +price.toFixed(2),
      bid:           +(price - SPREAD / 2).toFixed(2),
      ask:           +(price + SPREAD / 2).toFixed(2),
      spread:        SPREAD,
      change:        0,
      changePercent: 0,
      high24h:       +price.toFixed(2),
      low24h:        +price.toFixed(2),
      timestamp:     t ? new Date(t).toISOString() : new Date().toISOString(),
      direction:     "unchanged",
      ms:            t ?? Date.now(),
      source:        "polygon", // reusing "polygon" tag — will rename to "finnhub" below
    };
    // Override source tag
    (live as any).source = "finnhub";
    setLatestPrice(live);
    return;
  }

  if (type === "error") {
    logger.error({ msg: ev["msg"] }, "Finnhub WebSocket error message");
    return;
  }
}

// ── Connection management ──────────────────────────────────────────────────
function connect() {
  const apiKey = process.env["FINNHUB_API_KEY"];
  if (!apiKey) {
    logger.warn("FINNHUB_API_KEY not set — using goldprice.org fallback only");
    startFallbackPolling();
    return;
  }

  const url = `${FINNHUB_WS_BASE}?token=${apiKey}`;
  logger.info("Connecting to Finnhub WebSocket for real-time XAU/USD ticks…");

  ws = new WebSocket(url);

  ws.on("open", () => {
    logger.info("Finnhub WebSocket connected — subscribing to XAUUSD");
    ws?.send(JSON.stringify({ type: "subscribe", symbol: GOLD_SYMBOL }));
    finnhubConnected = true;
    reconnectDelay = RECONNECT_DELAY_BASE;
    stopFallbackPolling();
  });

  ws.on("message", (data: WebSocket.RawData) => {
    handleMessage(data.toString());
  });

  ws.on("error", (err) => {
    logger.warn({ err: err.message }, "Finnhub WebSocket error");
  });

  ws.on("close", (code, reason) => {
    finnhubConnected = false;
    logger.warn({ code, reason: reason.toString() }, "Finnhub disconnected — will reconnect");
    startFallbackPolling();
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_DELAY_MAX);
  }, reconnectDelay);
}

export function startPolygonStream() {
  startFallbackPolling();
  connect();
}
