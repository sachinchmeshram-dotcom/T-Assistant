import WebSocket from "ws";
import { setLatestPrice, buildLivePrice, type LivePrice } from "./priceEvents.js";
import { fetchGoldPrice } from "./goldPrice.js";
import { logger } from "./logger.js";

const SPREAD = 0.35;
const POLYGON_WS_URL = "wss://socket.polygon.io/forex";
const RECONNECT_DELAY_BASE = 3_000;
const RECONNECT_DELAY_MAX  = 60_000;

let ws: WebSocket | null = null;
let reconnectDelay = RECONNECT_DELAY_BASE;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let polygonConnected = false;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;

// ── Goldprice.org fallback polling ─────────────────────────────────────────
function startFallbackPolling() {
  if (fallbackTimer) return;
  logger.info("Starting goldprice.org fallback polling (500ms)");
  fallbackTimer = setInterval(async () => {
    if (polygonConnected) return; // Polygon is live — skip
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
    logger.info("Fallback polling stopped (Polygon.io is live)");
  }
}

// ── Polygon.io message handlers ────────────────────────────────────────────
function handleMessage(raw: string) {
  let events: unknown[];
  try { events = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(events)) return;

  for (const ev of events as Record<string, unknown>[]) {
    const type = ev["ev"] as string;

    if (type === "connected") {
      // Send auth
      ws?.send(JSON.stringify({
        action: "auth",
        params: process.env["POLYGON_API_KEY"] ?? "",
      }));
      continue;
    }

    if (type === "status") {
      const status = ev["status"] as string;
      if (status === "auth_success") {
        logger.info("Polygon.io auth success — subscribing to C.C:XAUUSD");
        ws?.send(JSON.stringify({
          action: "subscribe",
          params: "C.C:XAUUSD",
        }));
      } else if (status === "auth_failed") {
        logger.error("Polygon.io auth failed — check POLYGON_API_KEY");
        ws?.close();
      } else if (status === "success") {
        logger.info({ msg: ev["message"] }, "Polygon.io subscription confirmed");
        polygonConnected = true;
        reconnectDelay = RECONNECT_DELAY_BASE;
        stopFallbackPolling();
      }
      continue;
    }

    // Forex quote: ev === "C"
    if (type === "C") {
      const ask = ev["a"] as number | undefined;
      const bid = ev["b"] as number | undefined;
      const t   = ev["t"] as number | undefined;
      if (!ask || !bid) continue;

      const mid = +((ask + bid) / 2).toFixed(2);
      const live: LivePrice = {
        price: mid,
        bid: +bid.toFixed(2),
        ask: +ask.toFixed(2),
        spread: +(ask - bid).toFixed(2),
        change: 0,
        changePercent: 0,
        high24h: mid,
        low24h: mid,
        timestamp: t ? new Date(t).toISOString() : new Date().toISOString(),
        direction: "unchanged",
        ms: t ?? Date.now(),
        source: "polygon",
      };
      setLatestPrice(live);
      continue;
    }

    // Per-second aggregate: ev === "CAS"
    if (type === "CAS") {
      const close = ev["c"] as number | undefined;
      const high  = ev["h"] as number | undefined;
      const low   = ev["l"] as number | undefined;
      const t     = ev["s"] as number | undefined;
      if (!close) continue;

      const live: LivePrice = {
        price: +close.toFixed(2),
        bid:   +(close - SPREAD / 2).toFixed(2),
        ask:   +(close + SPREAD / 2).toFixed(2),
        spread: SPREAD,
        change: 0,
        changePercent: 0,
        high24h: high ?? close,
        low24h:  low  ?? close,
        timestamp: t ? new Date(t).toISOString() : new Date().toISOString(),
        direction: "unchanged",
        ms: t ?? Date.now(),
        source: "polygon",
      };
      setLatestPrice(live);
      continue;
    }
  }
}

// ── Connection management ──────────────────────────────────────────────────
function connect() {
  if (!process.env["POLYGON_API_KEY"]) {
    logger.warn("POLYGON_API_KEY not set — using goldprice.org fallback only");
    startFallbackPolling();
    return;
  }

  logger.info({ url: POLYGON_WS_URL }, "Connecting to Polygon.io forex WebSocket…");

  ws = new WebSocket(POLYGON_WS_URL);

  ws.on("open", () => {
    logger.info("Polygon.io WebSocket connected");
  });

  ws.on("message", (data: WebSocket.RawData) => {
    handleMessage(data.toString());
  });

  ws.on("error", (err) => {
    logger.warn({ err: err.message }, "Polygon.io WebSocket error");
  });

  ws.on("close", (code, reason) => {
    polygonConnected = false;
    logger.warn({ code, reason: reason.toString() }, "Polygon.io disconnected — reconnecting…");
    startFallbackPolling(); // Resume fallback while reconnecting
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
    reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_DELAY_MAX);
  }, reconnectDelay);
}

export function startPolygonStream() {
  startFallbackPolling(); // Always start fallback first
  connect();              // Then try Polygon.io (takes over when authenticated)
}
