import { Router, type IRouter, type Request, type Response } from "express";
import { fetchGoldPrice } from "../lib/goldPrice.js";
import { generateSignal } from "../lib/signalEngine.js";
import { startTradeTracker } from "../lib/tradeTracker.js";
import { getAnalyticsSummary, setSmartMode } from "../lib/performanceAnalytics.js";
import { priceEmitter, getLatestPrice, type LivePrice } from "../lib/priceEvents.js";
import { broadcastToWebSocketClients } from "../lib/priceWebSocket.js";
import { initLSTM, captureSequenceForTrade } from "../lib/lstmModel.js";
import { bootstrapLSTMFromDB } from "../lib/lstmBootstrap.js";
import { db, signalsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// Start background trade outcome tracker
startTradeTracker();

// Initialise LSTM time-series model (async — non-blocking)
initLSTM()
  .then(() => bootstrapLSTMFromDB())
  .catch(err => logger.error({ err }, "LSTM init/bootstrap failed"));

const router: IRouter = Router();

// ── SSE streaming — receives events from priceEmitter (Polygon.io or fallback)
const sseClients = new Set<Response>();

priceEmitter.on("price", (data: LivePrice) => {
  // Also push to WebSocket clients immediately
  broadcastToWebSocketClients(data);

  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
});

router.get("/price/stream", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(": connected\n\n");

  sseClients.add(res);
  logger.info({ total: sseClients.size }, "SSE client connected");

  // Send latest known price immediately on connect
  const current = getLatestPrice();
  if (current) {
    res.write(`data: ${JSON.stringify(current)}\n\n`);
  }

  req.on("close", () => {
    sseClients.delete(res);
    logger.info({ total: sseClients.size }, "SSE client disconnected");
  });
});

// ── REST price endpoint (fallback) ────────────────────────────────────────
router.get("/price", async (req, res) => {
  try {
    const live = getLatestPrice();
    if (live) {
      res.json(live);
    } else {
      const priceData = await fetchGoldPrice();
      res.json(priceData);
    }
  } catch (err) {
    req.log.error({ err }, "Error fetching price");
    res.status(500).json({ error: "price_fetch_error", message: "Failed to fetch gold price" });
  }
});

// ── Signal endpoint ────────────────────────────────────────────────────────
router.get("/signal", async (req, res) => {
  try {
    const live = getLatestPrice();
    const price = live?.price ?? (await fetchGoldPrice()).price;
    const signal = await generateSignal(price);

    if (signal.signal !== "HOLD") {
      try {
        const [inserted] = await db.insert(signalsTable).values({
          signal:          signal.signal,
          confidence:      signal.confidence,
          entryPrice:      signal.entryPrice,
          stopLoss:        signal.stopLoss,
          takeProfit:      signal.takeProfit,
          trend:           signal.trend,
          reason:          signal.reason,
          tradeDuration:   signal.tradeDuration,
          // SMC condition columns — power the adaptive learning engine
          marketStructure: signal.marketStructure,
          bosPresent:      signal.bos,
          liquiditySweep:  signal.liquiditySweep,
          inOrderBlock:    signal.inOrderBlock,
          smcScore:        signal.smcScore,
        }).returning({ id: signalsTable.id });
        // Associate the LSTM candle sequence with this trade ID
        if (inserted?.id) captureSequenceForTrade(inserted.id);
      } catch (dbErr) {
        req.log.warn({ dbErr }, "Failed to persist signal to DB");
      }
    }

    res.json(signal);
  } catch (err) {
    req.log.error({ err }, "Error generating signal");
    res.status(500).json({ error: "signal_error", message: "Failed to generate trading signal" });
  }
});

// ── History endpoint ───────────────────────────────────────────────────────
router.get("/history", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(signalsTable)
      .orderBy(desc(signalsTable.createdAt))
      .limit(50);

    const signals = rows.map(r => ({
      id: String(r.id),
      signal: r.signal as "LONG" | "SHORT" | "HOLD",
      confidence: r.confidence,
      entryPrice: r.entryPrice,
      stopLoss: r.stopLoss,
      takeProfit: r.takeProfit,
      trend: r.trend as "BULLISH" | "BEARISH" | "NEUTRAL",
      reason: r.reason,
      timestamp: r.createdAt.toISOString(),
      tradeDuration: r.tradeDuration,
      tradeStatus: (r.tradeStatus ?? "RUNNING") as "RUNNING" | "TARGET_HIT" | "STOP_HIT" | "HOLD",
      closedPrice: r.closedPrice ?? undefined,
      closedAt: r.closedAt ? r.closedAt.toISOString() : undefined,
      pnlPoints: r.pnlPoints ?? undefined,
    }));

    res.json({ signals });
  } catch (err) {
    req.log.error({ err }, "Error fetching history");
    res.json({ signals: [] });
  }
});

// ── Analytics endpoints ────────────────────────────────────────────────────
router.get("/analytics", async (req, res) => {
  try {
    const analytics = await getAnalyticsSummary();
    res.json(analytics);
  } catch (err) {
    req.log.error({ err }, "Error fetching analytics");
    res.status(500).json({ error: "analytics_error", message: "Failed to fetch analytics" });
  }
});

router.post("/analytics/smart-mode", async (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "validation_error", message: "enabled must be a boolean" });
    return;
  }
  setSmartMode(enabled);
  const analytics = await getAnalyticsSummary(true);
  res.json(analytics);
});


export default router;
