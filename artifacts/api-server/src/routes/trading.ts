import { Router, type IRouter } from "express";
import { fetchGoldPrice } from "../lib/goldPrice.js";
import { generateSignal } from "../lib/signalEngine.js";
import { db, signalsTable } from "@workspace/db";
import { CalculatePositionSizeBody } from "@workspace/api-zod";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/price", async (req, res) => {
  try {
    const priceData = await fetchGoldPrice();
    res.json(priceData);
  } catch (err) {
    req.log.error({ err }, "Error fetching price");
    res.status(500).json({ error: "price_fetch_error", message: "Failed to fetch gold price" });
  }
});

router.get("/signal", async (req, res) => {
  try {
    const priceData = await fetchGoldPrice();
    const signal = await generateSignal(priceData.price);

    if (signal.signal !== "HOLD") {
      try {
        await db.insert(signalsTable).values({
          signal: signal.signal,
          confidence: signal.confidence,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          trend: signal.trend,
          reason: signal.reason,
          tradeDuration: signal.tradeDuration,
        });
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

router.get("/history", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(signalsTable)
      .orderBy(desc(signalsTable.createdAt))
      .limit(50);

    const signals = rows.map(r => ({
      id: String(r.id),
      signal: r.signal as "BUY" | "SELL" | "HOLD",
      confidence: r.confidence,
      entryPrice: r.entryPrice,
      stopLoss: r.stopLoss,
      takeProfit: r.takeProfit,
      trend: r.trend as "BULLISH" | "BEARISH" | "NEUTRAL",
      reason: r.reason,
      timestamp: r.createdAt.toISOString(),
      tradeDuration: r.tradeDuration,
    }));

    res.json({ signals });
  } catch (err) {
    req.log.error({ err }, "Error fetching history");
    res.json({ signals: [] });
  }
});

router.post("/position-size", (req, res) => {
  const parseResult = CalculatePositionSizeBody.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "validation_error",
      message: "Invalid inputs: " + parseResult.error.issues.map(i => i.message).join(", "),
    });
    return;
  }

  const { balance, riskPercent, stopLossDistance } = parseResult.data;

  if (balance <= 0) {
    res.status(400).json({ error: "invalid_balance", message: "Balance must be greater than 0" });
    return;
  }
  if (riskPercent < 0.1 || riskPercent > 10) {
    res.status(400).json({ error: "invalid_risk", message: "Risk % must be between 0.1 and 10" });
    return;
  }
  if (stopLossDistance <= 0) {
    res.status(400).json({ error: "invalid_sl", message: "Stop loss distance must be greater than 0" });
    return;
  }

  const riskAmount = balance * (riskPercent / 100);
  const contractSize = 100;
  const pipValue = contractSize;
  let lotSize = riskAmount / (stopLossDistance * pipValue);
  lotSize = Math.max(0.01, Math.min(lotSize, 100));
  lotSize = Math.round(lotSize * 100) / 100;

  const positionValue = lotSize * contractSize * (stopLossDistance + 1);

  res.json({
    lotSize,
    riskAmount: +riskAmount.toFixed(2),
    positionValue: +positionValue.toFixed(2),
    pipValue,
  });
});

export default router;
