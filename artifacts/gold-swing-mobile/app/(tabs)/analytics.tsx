import {
  useGetAnalytics,
  useSetSmartMode,
} from "@workspace/api-client-react";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { IndicatorRow } from "@/components/IndicatorRow";
import { SectionHeader } from "@/components/SectionHeader";
import { StatCard } from "@/components/StatCard";
import { useColors } from "@/hooks/useColors";

export default function AnalyticsScreen() {
  const colors = useColors();

  const { data, isLoading, error, refetch, isFetching } = useGetAnalytics({
    query: {
      refetchInterval: 30000,
      refetchOnWindowFocus: true,
    },
  });

  const { mutate: setSmartMode, isPending: isToggling } = useSetSmartMode({
    mutation: {
      onSuccess: () => {
        refetch();
      },
    },
  });

  const topPad = Platform.OS === "web" ? 67 : 0;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const winRateColor =
    (data?.winRate ?? 0) >= 60
      ? colors.long
      : (data?.winRate ?? 0) >= 45
        ? colors.warning
        : colors.short;

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
            Loading analytics...
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Failed to load analytics
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
          {/* Win Rate Hero */}
          <View
            style={[
              styles.heroCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
              },
            ]}
          >
            <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>
              WIN RATE
            </Text>
            <Text style={[styles.heroValue, { color: winRateColor }]}>
              {data.winRate.toFixed(1)}%
            </Text>
            <View
              style={[styles.winBar, { backgroundColor: colors.border }]}
            >
              <View
                style={[
                  styles.winFill,
                  {
                    backgroundColor: winRateColor,
                    width: `${Math.min(data.winRate, 100)}%` as `${number}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              {data.wins}W · {data.losses}L · {data.totalCompleted} trades
            </Text>
          </View>

          {/* Stats Grid */}
          <SectionHeader title="Performance" />
          <View style={styles.statsRow}>
            <StatCard
              label="Avg Win"
              value={`${data.avgProfit >= 0 ? "+" : ""}${data.avgProfit.toFixed(1)}`}
              subValue="pts"
              valueColor={colors.long}
            />
            <View style={{ width: 10 }} />
            <StatCard
              label="Avg Loss"
              value={`${data.avgLoss.toFixed(1)}`}
              subValue="pts"
              valueColor={colors.short}
            />
          </View>
          <View style={styles.statsRow}>
            <StatCard
              label="Expectancy"
              value={`${data.expectancy >= 0 ? "+" : ""}${data.expectancy.toFixed(2)}`}
              subValue="per trade"
              valueColor={data.expectancy >= 0 ? colors.long : colors.short}
            />
            <View style={{ width: 10 }} />
            <StatCard
              label="Loss Rate"
              value={`${data.lossRate.toFixed(1)}%`}
              valueColor={colors.mutedForeground}
            />
          </View>

          {/* Smart Mode Toggle */}
          <SectionHeader title="Smart Mode" />
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
            <View style={styles.smartRow}>
              <View style={styles.smartInfo}>
                <Text style={[styles.smartTitle, { color: colors.foreground }]}>
                  Strict Signal Filter
                </Text>
                <Text style={[styles.smartDesc, { color: colors.mutedForeground }]}>
                  {data.smartModeStatus}
                </Text>
              </View>
              <Switch
                value={data.smartMode}
                onValueChange={(enabled) => {
                  if (!isToggling) {
                    setSmartMode({ data: { enabled } });
                  }
                }}
                trackColor={{ false: colors.border, true: colors.primary + "88" }}
                thumbColor={data.smartMode ? colors.primary : colors.mutedForeground}
                disabled={isToggling}
                testID="smart-mode-toggle"
              />
            </View>
          </View>

          {/* LSTM Status */}
          <SectionHeader title="LSTM Model" />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius,
                paddingVertical: 4,
              },
            ]}
          >
            <IndicatorRow label="Learning Status" value={data.learningStatus} />
            <IndicatorRow
              label="Sufficient Data"
              value={data.sufficientData ? "Yes" : "No"}
              valueColor={data.sufficientData ? colors.long : colors.mutedForeground}
            />
          </View>

          {/* Recent Trades */}
          {data.last10.length > 0 && (
            <>
              <SectionHeader title="Recent Trades" />
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                    paddingVertical: 4,
                  },
                ]}
              >
                {data.last10.map((trade, i) => (
                  <IndicatorRow
                    key={trade.id}
                    label={`${trade.signal} · ${new Date(trade.timestamp).toLocaleDateString()}`}
                    value={`${trade.result} · ${trade.pnlPoints >= 0 ? "+" : ""}${trade.pnlPoints.toFixed(1)}pts`}
                    valueColor={trade.result === "WIN" ? colors.long : colors.short}
                  />
                ))}
              </View>
            </>
          )}
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
    padding: 24,
    borderWidth: 1,
    alignItems: "center",
  },
  heroLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 8,
  },
  heroValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 56,
    letterSpacing: -1,
    lineHeight: 64,
  },
  winBar: {
    width: "100%",
    height: 4,
    borderRadius: 2,
    marginTop: 12,
    marginBottom: 12,
    overflow: "hidden",
  },
  winFill: {
    height: "100%",
    borderRadius: 2,
  },
  heroSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  statsRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  card: {
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  smartRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  smartInfo: {
    flex: 1,
    marginRight: 16,
  },
  smartTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    marginBottom: 4,
  },
  smartDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 16,
  },
});
