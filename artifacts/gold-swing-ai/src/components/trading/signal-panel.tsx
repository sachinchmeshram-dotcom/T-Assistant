import { useGetSignal } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/utils";
import { format } from "date-fns";
import { AlertCircle, Target, ShieldX, ArrowRightCircle, TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import { CooldownTimer } from "./cooldown-timer";
import { motion } from "framer-motion";

export function SignalPanel() {
  const { data: signalData, isLoading, isError } = useGetSignal({
    query: { refetchInterval: 300000 } // Poll every 5 minutes
  });

  if (isLoading) {
    return (
      <Card className="h-full bg-card/50">
        <CardContent className="p-6 flex flex-col gap-6">
          <Skeleton className="h-24 w-full bg-white/5 rounded-2xl" />
          <Skeleton className="h-8 w-3/4 bg-white/5" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-20 w-full bg-white/5" />
            <Skeleton className="h-20 w-full bg-white/5" />
            <Skeleton className="h-20 w-full bg-white/5" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !signalData) {
    return (
      <Card className="h-full flex items-center justify-center border-destructive/20 bg-destructive/5">
        <div className="text-center text-destructive flex flex-col items-center gap-2">
          <AlertCircle className="w-8 h-8" />
          <p>Failed to load AI signal</p>
        </div>
      </Card>
    );
  }

  const { signal, confidence, entryPrice, stopLoss, takeProfit, trend, reason, timestamp, tradeDuration, cooldownRemaining } = signalData;

  const signalColors = {
    BUY: "bg-success text-success-foreground shadow-[0_0_30px_rgba(34,197,94,0.3)] border-success/50",
    SELL: "bg-destructive text-destructive-foreground shadow-[0_0_30px_rgba(239,68,68,0.3)] border-destructive/50",
    HOLD: "bg-warning text-warning-foreground shadow-[0_0_30px_rgba(234,179,8,0.3)] border-warning/50",
  };

  const TrendIcon = trend === 'BULLISH' ? TrendingUp : trend === 'BEARISH' ? TrendingDown : Minus;
  const trendColor = trend === 'BULLISH' ? 'text-success' : trend === 'BEARISH' ? 'text-destructive' : 'text-muted-foreground';

  return (
    <Card className="relative overflow-hidden border-white/10 bg-gradient-to-b from-card to-background shadow-2xl">
      {/* Decorative background glow based on signal */}
      <div className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-10 pointer-events-none
        ${signal === 'BUY' ? 'bg-success' : signal === 'SELL' ? 'bg-destructive' : 'bg-warning'}
      `} />

      <CardContent className="p-6 lg:p-8 flex flex-col gap-8 relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wider">AI Recommendation</h2>
            <div className="flex items-center gap-4">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                key={signal}
                className={`px-8 py-3 rounded-xl font-bold text-3xl tracking-tight border ${signalColors[signal]}`}
              >
                {signal}
              </motion.div>
              {cooldownRemaining > 0 && <CooldownTimer initialSeconds={cooldownRemaining} />}
            </div>
          </div>
          
          <div className="flex flex-col items-end w-full md:w-auto">
            <div className="flex justify-between w-full md:w-auto gap-4 mb-2">
              <span className="text-sm text-muted-foreground">Confidence</span>
              <span className="text-sm font-bold font-mono">{confidence}%</span>
            </div>
            <div className="w-full md:w-48 h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
              <motion.div 
                className={`h-full rounded-full ${signal === 'HOLD' ? 'bg-warning' : 'bg-primary'}`}
                initial={{ width: 0 }}
                animate={{ width: `${confidence}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </div>
          </div>
        </div>

        <div className="bg-black/30 border border-white/5 rounded-2xl p-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-1">Reasoning</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{reason}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5 mt-2">
            <div>
              <span className="text-xs text-muted-foreground block mb-1">Market Trend</span>
              <div className={`flex items-center gap-1.5 font-semibold text-sm ${trendColor}`}>
                <TrendIcon className="w-4 h-4" /> {trend}
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block mb-1">Expected Duration</span>
              <div className="font-semibold text-sm text-foreground">
                {tradeDuration}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card border border-white/5 rounded-xl p-4 shadow-inner flex flex-col items-center justify-center text-center">
            <ArrowRightCircle className="w-5 h-5 text-primary mb-2 opacity-70" />
            <span className="text-xs text-muted-foreground mb-1">Entry Price</span>
            <span className="text-xl font-bold font-mono text-foreground">{formatPrice(entryPrice)}</span>
          </div>
          
          <div className="bg-destructive/5 border border-destructive/10 rounded-xl p-4 shadow-inner flex flex-col items-center justify-center text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-destructive/50 to-transparent"></div>
            <ShieldX className="w-5 h-5 text-destructive mb-2 opacity-70" />
            <span className="text-xs text-destructive/80 mb-1">Stop Loss</span>
            <span className="text-xl font-bold font-mono text-destructive">{formatPrice(stopLoss)}</span>
          </div>
          
          <div className="bg-success/5 border border-success/10 rounded-xl p-4 shadow-inner flex flex-col items-center justify-center text-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-success/50 to-transparent"></div>
            <Target className="w-5 h-5 text-success mb-2 opacity-70" />
            <span className="text-xs text-success/80 mb-1">Take Profit</span>
            <span className="text-xl font-bold font-mono text-success">{formatPrice(takeProfit)}</span>
          </div>
        </div>

        <div className="text-xs text-muted-foreground/50 text-right font-mono flex justify-end items-center gap-2">
          <span>Generated: {format(new Date(timestamp), "HH:mm:ss 'UTC'")}</span>
          <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
        </div>
      </CardContent>
    </Card>
  );
}
