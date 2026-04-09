import { useGetHistory, useGetPrice, useGetSignal } from "@workspace/api-client-react";
import type { HistoryEntry } from "@workspace/api-client-react";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { PriceChart } from "@/components/PriceChart";
import { SectionHeader } from "@/components/SectionHeader";
import { SignalBadge } from "@/components/SignalBadge";
import { useColors } from "@/hooks/useColors";
import { useSignalNotifications } from "@/hooks/useSignalNotifications";

// Compact history row
function HistoryRow({ item }: { item: HistoryEntry }) {
  const colors = useColors();
  const statusColor =
    item.tradeStatus === "TARGET_HIT"
      ? colors.long
      : item.tradeStatus === "STOP_HIT"
        ? colors.short
        : colors.mutedForeground;
  const statusLabel =
    item.tradeStatus === "TARGET_HIT"
      ? "TP HIT"
      : item.tradeStatus === "STOP_HIT"
        ? "SL HIT"
        : item.tradeStatus === "RUNNING"
          ? "LIVE"
          : "HOLD";

  return (
    <View style={[styles.historyRow, { borderColor: colors.border }]}>
      <View style={styles.historyLeft}>
        <SignalBadge signal={item.signal} size="sm" />
        <Text style={[styles.historyTime, { color: colors.mutedForeground }]}>
          {new Date(item.timestamp).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </View>
      <Text style={[styles.historyEntry, { color: colors.foreground }]}>
        ${item.entryPrice.toFixed(2)}
      </Text>
      <View style={styles.historyRight}>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: statusColor + "22",
              borderColor: statusColor + "55",
            },
          ]}
        >
          <Text style={[styles.statusText, { color: statusColor }]}>
            {statusLabel}
          </Text>
        </View>
        {item.pnlPoints !== undefined &&
          item.pnlPoints !== null &&
          item.tradeStatus !== "RUNNING" &&
          item.tradeStatus !== "HOLD" && (
            <Text
              style={[
                styles.pnlText,
                { color: item.pnlPoints >= 0 ? colors.long : colors.short },
              ]}
            >
              {item.pnlPoints >= 0 ? "+" : ""}
              {item.pnlPoints.toFixed(1)}
            </Text>
          )}
      </View>
    </View>
  );
}

export default function SignalScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const chartWidth = width - 32;

  const [priceBuffer, setPriceBuffer] = useState<number[]>([]);
  const prevPriceRef = useRef<number | null>(null);
  const seededFromHistory = useRef(false);

  const { checkSignal } = useSignalNotifications();

  // Live price — fast polling
  const { data: price } = useGetPrice({
    query: { refetchInterval: 5000, staleTime: 4000 },
  });

  // AI signal — 30s polling
  const {
    data: signal,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useGetSignal({
    query: {
      refetchInterval: 30000,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: true,
      staleTime: 25000,
    },
  });

  // History for seed data and recent panel
  const { data: history } = useGetHistory({
    query: { refetchInterval: 30000, staleTime: 25000 },
  });

  // Seed chart from history on first load
  useEffect(() => {
    if (seededFromHistory.current) return;
    if (!history?.signals || history.signals.length < 2) return;
    const historicalPrices = [...history.signals]
      .reverse()
      .slice(-40)
      .map((s) => s.entryPrice);
    if (historicalPrices.length > 1) {
      setPriceBuffer(historicalPrices);
      seededFromHistory.current = true;
    }
  }, [history?.signals]);

  // Accumulate live prices into rolling buffer
  useEffect(() => {
    if (!price?.price) return;
    if (price.price === prevPriceRef.current) return;
    prevPriceRef.current = price.price;
    setPriceBuffer((prev) => [...prev.slice(-79), price.price]);
  }, [price?.price]);

  // Fire notification when signal changes
  useEffect(() => {
    if (signal) {
      checkSignal(signal.signal, signal.confidence);
    }
  }, [signal?.signal]);

  const topPad = Platform.OS === "web" ? 67 : 0;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const signalColor =
    signal?.signal === "LONG"
      ? colors.long
      : signal?.signal === "SHORT"
        ? colors.short
        : colors.mutedForeground;

  const changeColor = (price?.change ?? 0) >= 0 ? colors.long : colors.short;

  const recentSignals = (history?.signals ?? []).slice(0, 6);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 12, paddingBottom: bottomPad + 100 },
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          tintColor={colors.primary}
        />
      }
    >
      {/* ── PRICE + CHART ── */}
      <View
        style={[
          styles.chartCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
          },
        ]}
      >
        {/* Price header row */}
        {price && (
          <View style={styles.priceRow}>
            <View>
              <Text style={[styles.assetLabel, { color: colors.mutedForeground }]}>
                XAU / USD
              </Text>
              <Text style={[styles.priceValue, { color: colors.foreground }]}>
                ${price.price.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
            </View>
            <View style={styles.priceRight}>
              <View
                style={[
                  styles.changeBadge,
                  {
                    backgroundColor: changeColor + "22",
                    borderColor: changeColor + "44",
                  },
                ]}
              >
                <Text style={[styles.changeText, { color: changeColor }]}>
                  {price.change >= 0 ? "+" : ""}
                  {price.changePercent.toFixed(2)}%
                </Text>
              </View>
              <Text style={[styles.highLow, { color: colors.mutedForeground }]}>
                H ${price.high24h.toFixed(0)} · L ${price.low24h.toFixed(0)}
              </Text>
            </View>
          </View>
        )}

        {/* Chart */}
        <PriceChart data={priceBuffer} width={chartWidth - 32} height={120} />
      </View>

      {/* ── AI SIGNAL ── */}
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Analysing...
          </Text>
        </View>
      ) : error ? (
        <Text
          style={[styles.errorText, { color: colors.destructive }]}
          onPress={() => refetch()}
        >
          Failed to load signal — tap to retry
        </Text>
      ) : signal ? (
        <>
          <SectionHeader title="AI Signal" />
          <View
            style={[
              styles.signalCard,
              {
                backgroundColor: colors.card,
                borderColor: signalColor + "55",
                borderRadius: colors.radius,
              },
            ]}
          >
            <View style={styles.signalTop}>
              <SignalBadge signal={signal.signal} size="lg" />
              {signal.smartMode && (
                <View
                  style={[
                    styles.smartBadge,
                    {
                      backgroundColor: colors.primary + "22",
                      borderColor: colors.primary + "55",
                    },
                  ]}
                >
                  <Text style={[styles.smartText, { color: colors.primary }]}>
                    SMART
                  </Text>
                </View>
              )}
              <View style={styles.confRight}>
                <Text style={[styles.confValue, { color: signalColor }]}>
                  {signal.confidence.toFixed(0)}%
                </Text>
                <Text
                  style={[styles.confLabel, { color: colors.mutedForeground }]}
                >
                  confidence
                </Text>
              </View>
            </View>

            {/* Confidence bar */}
            <View
              style={[styles.confBar, { backgroundColor: colors.accent }]}
            >
              <View
                style={[
                  styles.confFill,
                  {
                    backgroundColor: signalColor,
                    width: `${Math.min(signal.confidence, 100)}%` as `${number}%`,
                  },
                ]}
              />
            </View>

            <Text style={[styles.reason, { color: colors.foreground }]}>
              {signal.reason}
            </Text>

            <View style={styles.metaRow}>
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                {signal.tradeDuration}
              </Text>
              {signal.cooldownRemaining > 0 && (
                <Text style={[styles.cooldown, { color: colors.warning }]}>
                  Cooldown {Math.ceil(signal.cooldownRemaining / 60)}m
                </Text>
              )}
            </View>

            {/* Trade levels (only if actionable) */}
            {signal.signal !== "HOLD" && (
              <View
                style={[
                  styles.levelsGrid,
                  { borderTopColor: colors.border },
                ]}
              >
                <View style={styles.levelItem}>
                  <Text
                    style={[styles.levelLabel, { color: colors.mutedForeground }]}
                  >
                    ENTRY
                  </Text>
                  <Text
                    style={[styles.levelValue, { color: colors.primary }]}
                  >
                    ${signal.entryPrice.toFixed(2)}
                  </Text>
                </View>
                <View
                  style={[styles.levelDivider, { backgroundColor: colors.border }]}
                />
                <View style={styles.levelItem}>
                  <Text
                    style={[styles.levelLabel, { color: colors.mutedForeground }]}
                  >
                    TP
                  </Text>
                  <Text style={[styles.levelValue, { color: colors.long }]}>
                    ${signal.takeProfit.toFixed(2)}
                  </Text>
                </View>
                <View
                  style={[styles.levelDivider, { backgroundColor: colors.border }]}
                />
                <View style={styles.levelItem}>
                  <Text
                    style={[styles.levelLabel, { color: colors.mutedForeground }]}
                  >
                    SL
                  </Text>
                  <Text style={[styles.levelValue, { color: colors.short }]}>
                    ${signal.stopLoss.toFixed(2)}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Trend indicators — compact */}
          <View style={styles.indicatorRow}>
            {[
              { label: "1H", value: signal.indicators.trend1h },
              { label: "15M", value: signal.indicators.trend15m },
              { label: "5M", value: signal.indicators.trend5m },
              { label: "RSI", value: signal.indicators.rsi.toFixed(0) },
            ].map(({ label, value }) => {
              const isBull = value === "BULLISH";
              const isBear = value === "BEARISH";
              const c = isBull
                ? colors.long
                : isBear
                  ? colors.short
                  : colors.mutedForeground;
              return (
                <View
                  key={label}
                  style={[
                    styles.indCell,
                    {
                      backgroundColor: c + "15",
                      borderColor: c + "33",
                      borderRadius: 8,
                    },
                  ]}
                >
                  <Text style={[styles.indLabel, { color: colors.mutedForeground }]}>
                    {label}
                  </Text>
                  <Text style={[styles.indValue, { color: c }]}>{value}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {/* ── RECENT SIGNALS ── */}
      {recentSignals.length > 0 && (
        <>
          <SectionHeader title="Recent Signals" />
          <View
            style={[
              styles.historyCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            {recentSignals.map((item, i) => (
              <React.Fragment key={item.id}>
                <HistoryRow item={item} />
                {i < recentSignals.length - 1 && (
                  <View
                    style={[styles.divider, { backgroundColor: colors.border }]}
                  />
                )}
              </React.Fragment>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16 },

  /* Chart */
  chartCard: {
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  assetLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  priceValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    letterSpacing: -0.5,
  },
  priceRight: { alignItems: "flex-end", gap: 4 },
  changeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  changeText: { fontFamily: "Inter_700Bold", fontSize: 13 },
  highLow: { fontFamily: "Inter_400Regular", fontSize: 11 },

  /* Signal card */
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
  },
  loadingText: { fontFamily: "Inter_400Regular", fontSize: 13 },
  errorText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    marginTop: 12,
    textAlign: "center",
  },
  signalCard: {
    padding: 16,
    borderWidth: 1,
  },
  signalTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  smartBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  smartText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 1,
  },
  confRight: { marginLeft: "auto", alignItems: "flex-end" },
  confValue: { fontFamily: "Inter_700Bold", fontSize: 28 },
  confLabel: { fontFamily: "Inter_400Regular", fontSize: 11 },
  confBar: {
    height: 3,
    borderRadius: 2,
    marginBottom: 12,
    overflow: "hidden",
  },
  confFill: { height: "100%", borderRadius: 2 },
  reason: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  metaText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  cooldown: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  levelsGrid: {
    flexDirection: "row",
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  levelItem: { flex: 1, alignItems: "center", gap: 4 },
  levelDivider: { width: 1, alignSelf: "stretch" },
  levelLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    letterSpacing: 1,
  },
  levelValue: { fontFamily: "Inter_700Bold", fontSize: 15 },

  /* Indicator row */
  indicatorRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  indCell: {
    flex: 1,
    padding: 10,
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
  },
  indLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 10,
    letterSpacing: 0.5,
  },
  indValue: { fontFamily: "Inter_700Bold", fontSize: 12 },

  /* History */
  historyCard: { borderWidth: 1, overflow: "hidden" },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  historyLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  historyTime: { fontFamily: "Inter_400Regular", fontSize: 12 },
  historyEntry: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  historyRight: {
    alignItems: "flex-end",
    gap: 3,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 0.6,
  },
  pnlText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  divider: { height: 1, marginHorizontal: 0 },
});
