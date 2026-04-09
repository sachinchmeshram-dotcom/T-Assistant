import app from "./app";
import { logger } from "./lib/logger";
import { setupWebSocketServer } from "./lib/priceWebSocket.js";
import { startPolygonStream } from "./lib/polygonStream.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// Attach WebSocket server for frontend real-time price feed
setupWebSocketServer(server);

// Start Polygon.io real-time stream (with goldprice.org fallback)
startPolygonStream();
