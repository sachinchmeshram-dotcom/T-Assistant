import { useGetHistory } from "@workspace/api-client-react";
import { usePriceStream } from "@/hooks/usePriceStream";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { format, formatDistanceStrict } from "date-fns";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type TradeStatus = "RUNNING" | "TARGET_HIT" | "STOP_HIT" | "HOLD";

function StatusBadge({ status }: { status: TradeStatus }) {
  if (status === "TARGET_HIT") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-success/15 text-success border border-success/30">
        ✅ TARGET HIT
      </span>
    );
  }
  if (status === "STOP_HIT") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-destructive/15 text-destructive border border-destructive/30">
        ❌ STOP LOSS
      </span>
    );
  }
  if (status === "RUNNING") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 animate-pulse">
        ⏳ RUNNING
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/5 text-muted-foreground border border-white/10">
      — HOLD
    </span>
  );
}

function PnlCell({
  signal,
  status,
  pnlPoints,
  entryPrice,
  stopLoss,
  takeProfit,
  currentPrice,
}: {
  signal: "LONG" | "SHORT" | "HOLD";
  status: TradeStatus;
  pnlPoints?: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
}) {
  if (signal === "HOLD") return <span className="text-muted-foreground">—</span>;

  // Use stored pnl for closed trades, calculate live pnl for running
  let pts: number;
  let isClosed = false;

  if (status === "TARGET_HIT" || status === "STOP_HIT") {
    pts = pnlPoints ?? 0;
    isClosed = true;
  } else {
    // Live unrealised P&L
    pts = signal === "LONG"
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;
  }

  const positive = pts >= 0;
  const color = positive ? "text-success" : "text-destructive";
  const Icon = positive ? TrendingUp : TrendingDown;

  return (
    <span className={`inline-flex items-center gap-1 font-mono font-semibold ${color}`}>
      <Icon className="w-3 h-3" />
      {positive ? "+" : ""}{pts.toFixed(2)}
      {!isClosed && <span className="text-[10px] opacity-60 font-sans">live</span>}
    </span>
  );
}

function DurationCell({ timestamp, closedAt }: { timestamp: string; closedAt?: string }) {
  const start = new Date(timestamp);
  const end   = closedAt ? new Date(closedAt) : new Date();
  try {
    return (
      <span className="text-muted-foreground text-xs font-sans">
        {formatDistanceStrict(start, end)}
      </span>
    );
  } catch {
    return <span className="text-muted-foreground">—</span>;
  }
}

export function HistoryTable() {
  const { data, isLoading, isError } = useGetHistory({
    query: { refetchInterval: 10000 }
  });
  const { data: priceData } = usePriceStream();
  const currentPrice = priceData?.price ?? 0;

  if (isError) return null;

  return (
    <Card className="border-white/5 bg-card/50 overflow-hidden">
      <CardHeader className="pb-4 border-b border-white/5 bg-black/20">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="w-5 h-5 text-muted-foreground" />
          Signal History
          {currentPrice > 0 && (
            <span className="ml-auto text-xs font-mono font-normal text-muted-foreground">
              Live: <span className="text-foreground">{formatPrice(currentPrice)}</span>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-black/40 border-b border-white/5">
              <tr>
                <th className="px-4 py-3 font-semibold tracking-wider whitespace-nowrap">Date & Time</th>
                <th className="px-4 py-3 font-semibold tracking-wider">Signal</th>
                <th className="px-4 py-3 font-semibold tracking-wider">Status</th>
                <th className="px-4 py-3 font-semibold tracking-wider whitespace-nowrap">Entry</th>
                <th className="px-4 py-3 font-semibold tracking-wider whitespace-nowrap">Stop Loss</th>
                <th className="px-4 py-3 font-semibold tracking-wider whitespace-nowrap">Take Profit</th>
                <th className="px-4 py-3 font-semibold tracking-wider whitespace-nowrap">P&amp;L (pts)</th>
                <th className="px-4 py-3 font-semibold tracking-wider whitespace-nowrap">Duration</th>
                <th className="px-4 py-3 font-semibold tracking-wider">Conf.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-16 bg-white/5" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                data?.signals.map((row) => {
                  const status = (row.tradeStatus ?? "RUNNING") as TradeStatus;
                  return (
                    <tr key={row.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {format(new Date(row.timestamp), "MMM dd, HH:mm")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={
                          row.signal === "LONG" ? "success" :
                          row.signal === "SHORT" ? "destructive" : "warning"
                        }>
                          {row.signal}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-4 py-3 text-foreground font-semibold">
                        {formatPrice(row.entryPrice)}
                      </td>
                      <td className="px-4 py-3 text-destructive/80">
                        {formatPrice(row.stopLoss)}
                      </td>
                      <td className="px-4 py-3 text-success/80">
                        {formatPrice(row.takeProfit)}
                      </td>
                      <td className="px-4 py-3">
                        <PnlCell
                          signal={row.signal}
                          status={status}
                          pnlPoints={row.pnlPoints}
                          entryPrice={row.entryPrice}
                          stopLoss={row.stopLoss}
                          takeProfit={row.takeProfit}
                          currentPrice={currentPrice}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <DurationCell
                            timestamp={row.timestamp}
                            closedAt={row.closedAt}
                          />
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.confidence}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {data?.signals.length === 0 && !isLoading && (
            <div className="p-8 text-center text-muted-foreground">
              No signal history yet. Signals will appear here once generated.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
