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
}

export interface PriceStreamState {
  data: StreamPrice | null;
  connected: boolean;
  error: boolean;
  tickCount: number;
}

export function usePriceStream(): PriceStreamState {
  const [state, setState] = useState<PriceStreamState>({
    data: null,
    connected: false,
    error: false,
    tickCount: 0,
  });

  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource("/api/price/stream");
    esRef.current = es;

    es.onopen = () => {
      setState(s => ({ ...s, connected: true, error: false }));
    };

    es.onmessage = (event: MessageEvent) => {
      try {
        const incoming = JSON.parse(event.data) as StreamPrice;
        setState(s => ({
          data: incoming,
          connected: true,
          error: false,
          tickCount: s.tickCount + 1,
        }));
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setState(s => ({ ...s, connected: false, error: true }));
      retryRef.current = setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);

  return state;
}
