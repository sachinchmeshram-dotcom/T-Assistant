import { useGetSignal } from "@workspace/api-client-react";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IndicatorRow } from "@/components/IndicatorRow";
import { PriceLevel } from "@/components/PriceLevel";
import { SectionHeader } from "@/components/SectionHeader";
import { SignalBadge } from "@/components/SignalBadge";
import { useColors } from "@/hooks/useColors";

export default function SignalScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data, isLoading, error, refetch, isFetching } = useGetSignal({
    query: {
      refetchInterval: 30000,
      refetchOnWindowFocus: true,
      staleTime: 25000,
    },
  });

  const topPad = Platform.OS === "web" ? 67 : 0;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const signalColor =
    data?.signal === "LONG"
      ? colors.long
      : data?.signal === "SHORT"
        ? colors.short
        : colors.mutedForeground;

  const trendColor = (t: string | undefined) => {
    if (t === "BULLISH") return colors.long;
    if (t === "BEARISH") return colors.short;
    return colors.mutedForeground;
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          tintColor={colors.primary}
        />
      }
    >
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Analysing market...
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Failed to load signal
          </Text>
          <Text
            style={[styles.retryText, { color: colors.primary }]}
            onPress={() => refetch()}
          >
            Tap to retry
          </Text>
        </View>
      ) : data ? (
        <>
          {/* Signal Hero */}
          <View
            style={[
              styles.heroCard,
              {
                backgroundColor: colors.card,
                borderColor: signalColor + "44",
                borderRadius: colors.radius,
              },
            ]}
          >
            <View style={styles.heroTop}>
              <SignalBadge signal={data.signal} size="lg" />
              {data.smartMode && (
                <View
                  style={[
                    styles.smartBadge,
                    { backgroundColor: colors.primary + "22", borderColor: colors.primary + "55" },
                  ]}
                >
                  <Text style={[styles.smartText, { color: colors.primary }]}>
                    SMART MODE
                  </Text>
                </View>
              )}
            </View>

            <Text style={[styles.confidence, { color: signalColor }]}>
              {data.confidence.toFixed(0)}
              <Text style={[styles.confidenceUnit, { color: colors.mutedForeground }]}>
                % confidence
              </Text>
            </Text>

            <View
              style={[
                styles.confidenceBar,
                { backgroundColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.confidenceFill,
                  {
                    backgroundColor: signalColor,
                    width: `${Math.min(data.confidence, 100)}%` as `${number}%`,
                  },
                ]}
              />
            </View>

            <Text style={[styles.reason, { color: colors.foreground }]}>
              {data.reason}
            </Text>

            <View style={styles.metaRow}>
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {data.tradeDuration}
              </Text>
              {data.cooldownRemaining > 0 && (
                <Text style={[styles.cooldown, { color: colors.warning }]}>
                  Cooldown {Math.ceil(data.cooldownRemaining / 60)}m
                </Text>
              )}
            </View>
          </View>

          {/* Trade Levels */}
          {data.signal !== "HOLD" && (
            <>
              <SectionHeader title="Trade Levels" />
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <PriceLevel
                  label="Entry"
                  price={data.entryPrice}
                  color={colors.primary}
                />
                <PriceLevel
                  label="Take Profit"
                  price={data.takeProfit}
                  color={colors.long}
                />
                <PriceLevel
                  label="Stop Loss"
                  price={data.stopLoss}
                  color={colors.short}
                />
              </View>
            </>
          )}

          {/* Market Trend */}
          <SectionHeader title="Market Trend" />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <IndicatorRow
              label="Overall Trend"
              value={data.trend}
              valueColor={trendColor(data.trend)}
            />
            <IndicatorRow
              label="1H Trend"
              value={data.indicators.trend1h}
              valueColor={trendColor(data.indicators.trend1h)}
            />
            <IndicatorRow
              label="15M Trend"
              value={data.indicators.trend15m}
              valueColor={trendColor(data.indicators.trend15m)}
            />
            <IndicatorRow
              label="5M Trend"
              value={data.indicators.trend5m}
              valueColor={trendColor(data.indicators.trend5m)}
            />
          </View>

          {/* Technical Indicators */}
          <SectionHeader title="Indicators" />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <IndicatorRow
              label="RSI (14)"
              value={data.indicators.rsi.toFixed(1)}
              valueColor={
                data.indicators.rsi > 70
                  ? colors.short
                  : data.indicators.rsi < 30
                    ? colors.long
                    : colors.foreground
              }
            />
            <IndicatorRow label="EMA 20" value={`$${data.indicators.ema20.toFixed(2)}`} />
            <IndicatorRow label="EMA 50" value={`$${data.indicators.ema50.toFixed(2)}`} />
            <IndicatorRow label="EMA 200" value={`$${data.indicators.ema200.toFixed(2)}`} />
            <IndicatorRow
              label="MACD"
              value={data.indicators.macdLine.toFixed(2)}
              valueColor={
                data.indicators.macdLine > data.indicators.macdSignal
                  ? colors.long
                  : colors.short
              }
            />
            <IndicatorRow label="ATR" value={data.indicators.atr.toFixed(2)} />
          </View>

          <Text
            style={[styles.timestamp, { color: colors.mutedForeground }]}
          >
            Updated {new Date(data.timestamp).toLocaleTimeString()}
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  loadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    marginTop: 12,
  },
  errorText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  retryText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  heroCard: {
    padding: 20,
    borderWidth: 1,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  smartBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  smartText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 1,
  },
  confidence: {
    fontFamily: "Inter_700Bold",
    fontSize: 42,
    lineHeight: 48,
  },
  confidenceUnit: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  confidenceBar: {
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 16,
    overflow: "hidden",
  },
  confidenceFill: {
    height: "100%",
    borderRadius: 2,
  },
  reason: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  metaText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
  cooldown: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
  },
  card: {
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  timestamp: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    textAlign: "center",
    marginTop: 16,
  },
});
