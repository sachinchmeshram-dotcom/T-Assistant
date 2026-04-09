import { db, signalsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { fetchGoldPrice } from "./goldPrice.js";
import { logger } from "./logger.js";

const TRACKER_INTERVAL = 10_000; // 10 seconds

async function checkRunningTrades() {
  let currentPrice: number;
  try {
    const priceData = await fetchGoldPrice();
    currentPrice = priceData.price;
  } catch {
    return; // Skip check if price unavailable
  }

  try {
    const runningTrades = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.tradeStatus, "RUNNING"));

    if (runningTrades.length === 0) return;

    for (const trade of runningTrades) {
      const { id, signal, entryPrice, stopLoss, takeProfit } = trade;

      let newStatus: string | null = null;
      let closedPrice: number | null = null;
      let pnlPoints: number | null = null;

      if (signal === "LONG") {
        if (currentPrice >= takeProfit) {
          newStatus  = "TARGET_HIT";
          closedPrice = takeProfit;
          pnlPoints   = +(takeProfit - entryPrice).toFixed(2);
        } else if (currentPrice <= stopLoss) {
          newStatus  = "STOP_HIT";
          closedPrice = stopLoss;
          pnlPoints   = +(stopLoss - entryPrice).toFixed(2);
        }
      } else if (signal === "SHORT") {
        if (currentPrice <= takeProfit) {
          newStatus  = "TARGET_HIT";
          closedPrice = takeProfit;
          pnlPoints   = +(entryPrice - takeProfit).toFixed(2);
        } else if (currentPrice >= stopLoss) {
          newStatus  = "STOP_HIT";
          closedPrice = stopLoss;
          pnlPoints   = +(entryPrice - stopLoss).toFixed(2);
        }
      }

      if (newStatus && closedPrice !== null && pnlPoints !== null) {
        await db
          .update(signalsTable)
          .set({
            tradeStatus: newStatus,
            closedPrice,
            closedAt: new Date(),
            pnlPoints,
          })
          .where(eq(signalsTable.id, id));

        logger.info({ id, signal, newStatus, closedPrice, pnlPoints }, "Trade outcome updated");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Trade tracker update error");
  }
}

export function startTradeTracker() {
  logger.info("Trade tracker started (10s interval)");
  setInterval(checkRunningTrades, TRACKER_INTERVAL);
  // Run once immediately at startup
  checkRunningTrades().catch(() => {});
}
