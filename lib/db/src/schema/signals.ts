import { pgTable, text, serial, real, timestamp } from "drizzle-orm/pg-core";
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
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
