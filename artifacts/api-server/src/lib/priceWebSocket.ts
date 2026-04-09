import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "http";
import { priceEmitter, getLatestPrice, getTickHistory, type LivePrice } from "./priceEvents.js";
import { logger } from "./logger.js";

let wss: WebSocketServer | null = null;

export function setupWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server, path: "/api/price/ws" });

  wss.on("connection", (ws: WebSocket, req) => {
    logger.info({ clients: wss!.clients.size }, "WS client connected");

    // Send full tick history on connect so chart pre-populates instantly
    const history = getTickHistory();
    if (history.length > 0) {
      ws.send(JSON.stringify({ type: "history", ticks: history }));
    }

    ws.on("error", (err) => {
      logger.warn({ err }, "WS client error");
      ws.terminate();
    });

    ws.on("close", () => {
      logger.info({ clients: wss!.clients.size }, "WS client disconnected");
    });
  });

  wss.on("error", (err) => {
    logger.error({ err }, "WebSocket server error");
  });

  logger.info("WebSocket price server ready at /api/price/ws");
}

export function broadcastToWebSocketClients(data: LivePrice) {
  if (!wss || wss.clients.size === 0) return;
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(payload);
    }
  }
}
