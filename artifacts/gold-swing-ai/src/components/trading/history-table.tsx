import { useGetHistory } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";
import { format } from "date-fns";
import { formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function HistoryTable() {
  const { data, isLoading, isError } = useGetHistory({
    query: { refetchInterval: 300000 }
  });

  if (isError) return null;

  return (
    <Card className="border-white/5 bg-card/50 overflow-hidden">
      <CardHeader className="pb-4 border-b border-white/5 bg-black/20">
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="w-5 h-5 text-muted-foreground" />
          Signal History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-black/40 border-b border-white/5">
              <tr>
                <th className="px-6 py-4 font-semibold tracking-wider">Date & Time</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Signal</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Entry</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Stop Loss</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Take Profit</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Conf.</th>
                <th className="px-6 py-4 font-semibold tracking-wider">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="hover:bg-white/5">
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24 bg-white/5" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-6 w-16 bg-white/5 rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16 bg-white/5" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16 bg-white/5" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16 bg-white/5" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-12 bg-white/5" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16 bg-white/5" /></td>
                  </tr>
                ))
              ) : (
                data?.signals.map((row) => (
                  <tr key={row.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-muted-foreground">
                      {format(new Date(row.timestamp), "MMM dd, HH:mm")}
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={
                        row.signal === 'LONG' ? 'success' : 
                        row.signal === 'SHORT' ? 'destructive' : 'warning'
                      }>
                        {row.signal}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-foreground font-semibold">{formatPrice(row.entryPrice)}</td>
                    <td className="px-6 py-4 text-destructive/80">{formatPrice(row.stopLoss)}</td>
                    <td className="px-6 py-4 text-success/80">{formatPrice(row.takeProfit)}</td>
                    <td className="px-6 py-4">{row.confidence}%</td>
                    <td className={`px-6 py-4 font-sans font-semibold text-xs tracking-wider ${
                      row.trend === 'BULLISH' ? 'text-success' : 
                      row.trend === 'BEARISH' ? 'text-destructive' : 'text-muted-foreground'
                    }`}>
                      {row.trend}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {data?.signals.length === 0 && !isLoading && (
            <div className="p-8 text-center text-muted-foreground">
              No signal history available.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
