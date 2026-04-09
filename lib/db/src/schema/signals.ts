import { pgTable, text, serial, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  signal: text("signal").notNull(),
  confidence: real("confidence").notNull(),
  entryPrice: real("entry_price").notNull(),
  stopLoss: real("stop_loss").notNull(),
  takeProfit: real("take_profit").notNull(),
  trend: text("trend").notNull(),
  reason: text("reason").notNull(),
  tradeDuration: text("trade_duration").notNull().default("5-15 minutes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Trade outcome tracking
  tradeStatus: text("trade_status").notNull().default("RUNNING"),
  closedPrice: real("closed_price"),
  closedAt: timestamp("closed_at"),
  pnlPoints: real("pnl_points"),
  // SMC condition columns — used for per-condition accuracy + adaptive weights
  marketStructure: text("market_structure"),          // UPTREND | DOWNTREND | RANGING
  bosPresent: boolean("bos_present"),                 // Break of Structure detected?
  liquiditySweep: boolean("liquidity_sweep"),         // Liquidity grab detected?
  inOrderBlock: boolean("in_order_block"),            // Price in Order Block?
  smcScore: real("smc_score"),                        // Raw SMC confluence % at signal time
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
