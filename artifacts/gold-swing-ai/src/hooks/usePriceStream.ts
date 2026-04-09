import { useEffect, useRef, useState, useCallback } from "react";

export interface StreamPrice {
  price: number;
  bid: number;
  ask: number;
  spread: number;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  direction: "up" | "down" | "unchanged";
  timestamp: string;
  ms: number;
  source?: "polygon" | "goldprice" | "yahoo" | "synthetic";
}

export interface PriceStreamState {
  data: StreamPrice | null;
  connected: boolean;
  error: boolean;
  tickCount: number;
  transport: "websocket" | "sse" | "none";
}

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/price/ws`;
}

export function usePriceStream(): PriceStreamState {
  const [state, setState] = useState<PriceStreamState>({
    data: null,
    connected: false,
    error: false,
    tickCount: 0,
    transport: "none",
  });

  const wsRef  = useRef<WebSocket | null>(null);
  const esRef  = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsFailedRef = useRef(false);

  const onMessage = useCallback((raw: string) => {
    try {
      const incoming = JSON.parse(raw) as StreamPrice;
      if (!incoming.price) return;
      setState(s => ({
        ...s,
        data: incoming,
        connected: true,
        error: false,
        tickCount: s.tickCount + 1,
      }));
    } catch {
      // ignore parse errors
    }
  }, []);

  // ── SSE fallback ──────────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (esRef.current) esRef.current.close();

    const es = new EventSource("/api/price/stream");
    esRef.current = es;

    es.onopen = () => {
      setState(s => ({ ...s, connected: true, error: false, transport: "sse" }));
    };

    es.onmessage = (event: MessageEvent) => {
      onMessage(event.data as string);
      setState(s => ({ ...s, transport: "sse" }));
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setState(s => ({ ...s, connected: false, error: true }));
      retryRef.current = setTimeout(connectSSE, 3000);
    };
  }, [onMessage]);

  // ── WebSocket primary ──────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (wsRef.current) wsRef.current.close();

    const url = buildWsUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    const openTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        wsFailedRef.current = true;
        connectSSE();
      }
    }, 5000);

    ws.onopen = () => {
      clearTimeout(openTimeout);
      setState(s => ({ ...s, connected: true, error: false, transport: "websocket" }));
    };

    ws.onmessage = (event: MessageEvent) => {
      onMessage(event.data as string);
      setState(s => ({ ...s, transport: "websocket" }));
    };

    ws.onerror = () => {
      clearTimeout(openTimeout);
      wsFailedRef.current = true;
    };

    ws.onclose = () => {
      clearTimeout(openTimeout);
      setState(s => ({ ...s, connected: false }));

      if (wsFailedRef.current) {
        // WS not available — stay on SSE
        if (!esRef.current) connectSSE();
      } else {
        // Unexpected close — retry WS after 3s
        retryRef.current = setTimeout(connectWS, 3000);
      }
    };
  }, [onMessage, connectSSE]);

  useEffect(() => {
    connectWS();

    return () => {
      wsRef.current?.close();
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connectWS]);

  return state;
}
