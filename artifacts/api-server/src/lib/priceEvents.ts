import { EventEmitter } from "events";
import type { PriceData } from "./goldPrice.js";

export interface LivePrice extends PriceData {
  bid: number;
  ask: number;
  spread: number;
  direction: "up" | "down" | "unchanged";
  ms: number;
  source: "finnhub" | "polygon" | "goldprice" | "yahoo" | "synthetic";
}

class PriceEventEmitter extends EventEmitter {}
export const priceEmitter = new PriceEventEmitter();

// Shared mutable price state written by all sources
let _latestPrice: LivePrice | null = null;
let _prevPrice: number | null = null;

// Circular tick history — last 500 ticks so new clients can pre-populate charts
const TICK_BUFFER_SIZE = 500;
const _tickHistory: LivePrice[] = [];

export function setLatestPrice(price: LivePrice) {
  _prevPrice = _latestPrice?.price ?? null;
  _latestPrice = price;
  _tickHistory.push(price);
  if (_tickHistory.length > TICK_BUFFER_SIZE) _tickHistory.shift();
  priceEmitter.emit("price", price);
}

export function getLatestPrice(): LivePrice | null {
  return _latestPrice;
}

export function getTickHistory(): LivePrice[] {
  return [..._tickHistory];
}

export function buildLivePrice(
  data: PriceData,
  spread: number,
  source: LivePrice["source"],
): LivePrice {
  const direction: LivePrice["direction"] =
    _prevPrice === null ? "unchanged"
    : data.price > _prevPrice ? "up"
    : data.price < _prevPrice ? "down"
    : "unchanged";

  return {
    ...data,
    bid:  +(data.price - spread / 2).toFixed(2),
    ask:  +(data.price + spread / 2).toFixed(2),
    spread,
    direction,
    ms: Date.now(),
    source,
  };
}
