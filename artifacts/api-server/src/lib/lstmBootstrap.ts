/**
 * LSTM Bootstrap — seeds training data from historical DB trades.
 *
 * When the server restarts, /tmp is gone. This module reconstructs training
 * data by pairing each completed DB trade with the 50 hourly candles that
 * preceded it, then triggers an LSTM training pass.
 *
 * Run once at startup, after initLSTM() has been called.
 */
import { db, signalsTable } from "@workspace/db";
import { ne }               from "drizzle-orm";
import { fetchOHLC }        from "./goldPrice.js";
import {
  addBootstrapRecord,
  getTrainingRecordCount,
  lstmRetrainIfNeeded,
} from "./lstmModel.js";
import { logger } from "./logger.js";

const SEQ_LEN = 50;

export async function bootstrapLSTMFromDB(): Promise<void> {
  try {
    // Skip if we already have enough training data (e.g. persistent file survived)
    const existing = getTrainingRecordCount();
    if (existing >= 15) {
      logger.info({ existing }, "LSTM bootstrap: training data already present — skipping");
      lstmRetrainIfNeeded();
      return;
    }

    // Fetch completed trades from DB (only LONG and SHORT with definitive outcomes)
    const completedTrades = await db
      .select({
        id:          signalsTable.id,
        signal:      signalsTable.signal,
        tradeStatus: signalsTable.tradeStatus,
        createdAt:   signalsTable.createdAt,
      })
      .from(signalsTable)
      .where(ne(signalsTable.tradeStatus, "RUNNING"));

    const eligible = completedTrades.filter(
      t =>
        (t.signal === "LONG" || t.signal === "SHORT") &&
        (t.tradeStatus === "TARGET_HIT" || t.tradeStatus === "STOP_HIT")
    );

    if (eligible.length === 0) {
      logger.info("LSTM bootstrap: no completed trades to bootstrap from");
      return;
    }

    logger.info({ trades: eligible.length }, "LSTM bootstrap: seeding from DB trade history");

    // Fetch 1H OHLC candles for the past 30 days
    const candles1h = await fetchOHLC("1h");
    if (candles1h.length < SEQ_LEN) {
      logger.warn({ candles: candles1h.length }, "LSTM bootstrap: insufficient 1H OHLC data");
      return;
    }

    let seeded = 0;
    for (const trade of eligible) {
      const tradeTs = Math.floor(trade.createdAt.getTime() / 1000); // unix seconds

      // Find the candle index closest to (but not after) the trade timestamp
      let endIdx = -1;
      for (let i = candles1h.length - 1; i >= 0; i--) {
        if (candles1h[i].time <= tradeTs) {
          endIdx = i;
          break;
        }
      }

      if (endIdx < SEQ_LEN - 1) continue; // not enough history before this trade

      const slice = candles1h.slice(endIdx - SEQ_LEN + 1, endIdx + 1);
      if (slice.length !== SEQ_LEN) continue;

      addBootstrapRecord(
        slice,
        trade.signal as "LONG" | "SHORT",
        trade.tradeStatus as "TARGET_HIT" | "STOP_HIT"
      );
      seeded++;
    }

    logger.info({ seeded, total: eligible.length }, "LSTM bootstrap: records seeded");

    if (seeded >= 15) {
      lstmRetrainIfNeeded();
    }
  } catch (err) {
    logger.error({ err }, "LSTM bootstrap: error during seeding");
  }
}
