import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCalculatePositionSize, useGetSignal } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Calculator, DollarSign, Percent, ArrowDownUp } from "lucide-react";
import { formatPrice } from "@/lib/utils";

const formSchema = z.object({
  balance: z.coerce.number().min(1, "Balance must be greater than 0"),
  riskPercent: z.coerce.number().min(0.1, "Min risk is 0.1%").max(10, "Max risk is 10%"),
  stopLossDistance: z.coerce.number().min(0.1, "Distance required"),
});

type FormValues = z.infer<typeof formSchema>;

export function PositionSizer() {
  const { data: signalData } = useGetSignal();
  const { mutate, data: result, isPending, error } = useCalculatePositionSize();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      balance: 10000,
      riskPercent: 1,
      stopLossDistance: 10,
    },
  });

  // Auto-fill SL distance from signal AND auto-trigger calculation
  useEffect(() => {
    if (signalData) {
      const distance = Math.abs(signalData.entryPrice - signalData.stopLoss);
      const slDist = Number(distance.toFixed(2));
      form.setValue('stopLossDistance', slDist);
      // Auto-calculate with current balance and risk %
      const { balance, riskPercent } = form.getValues();
      if (balance > 0 && riskPercent > 0 && slDist > 0) {
        mutate({ data: { balance, riskPercent, stopLossDistance: slDist } });
      }
    }
  }, [signalData]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (values: FormValues) => {
    mutate({ data: values });
  };

  return (
    <Card className="border-white/5 bg-card/80 backdrop-blur flex flex-col h-full">
      <CardHeader className="pb-4 border-b border-white/5">
        <CardTitle className="text-lg flex items-center gap-2">
          <Calculator className="w-5 h-5 text-primary" />
          Position Sizer
        </CardTitle>
      </CardHeader>
      
      <CardContent className="p-6 flex-grow flex flex-col justify-between gap-6">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Account Balance</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                {...form.register("balance")}
                type="number"
                step="any"
                className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-foreground font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
              />
            </div>
            {form.formState.errors.balance && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.balance.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Risk %</label>
              <div className="relative">
                <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  {...form.register("riskPercent")}
                  type="number"
                  step="0.1"
                  className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-foreground font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>
              {form.formState.errors.riskPercent && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.riskPercent.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">SL Dist ($)</label>
              <div className="relative">
                <ArrowDownUp className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  {...form.register("stopLossDistance")}
                  type="number"
                  step="any"
                  className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-foreground font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                />
              </div>
              {form.formState.errors.stopLossDistance && (
                <p className="text-xs text-destructive mt-1">{form.formState.errors.stopLossDistance.message}</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 rounded-lg shadow-lg shadow-primary/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {isPending ? "Calculating..." : "Calculate Lot Size"}
          </button>
        </form>

        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive text-center">
             Failed to calculate. Check inputs.
          </div>
        )}

        <div className="bg-black/30 border border-white/5 rounded-xl p-5 flex flex-col gap-3">
          <div className="flex justify-between items-center pb-3 border-b border-white/5">
            <span className="text-sm text-muted-foreground">Recommended Lot Size</span>
            <span className="text-2xl font-bold font-mono text-primary">
              {result ? result.lotSize.toFixed(2) : "0.00"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Value at Risk</span>
            <span className="text-sm font-bold font-mono text-destructive">
              {result ? formatPrice(result.riskAmount) : "$0.00"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Position Value</span>
            <span className="text-sm font-bold font-mono text-foreground">
              {result ? formatPrice(result.positionValue) : "$0.00"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
