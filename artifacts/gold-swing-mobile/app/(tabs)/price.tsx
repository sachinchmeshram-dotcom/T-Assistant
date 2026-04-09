import { useGetPrice } from "@workspace/api-client-react";
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

import { SectionHeader } from "@/components/SectionHeader";
import { StatCard } from "@/components/StatCard";
import { useColors } from "@/hooks/useColors";

export default function PriceScreen() {
  const colors = useColors();

  const { data, isLoading, error, refetch, isFetching } = useGetPrice({
    query: {
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
      staleTime: 4000,
    },
  });

  const topPad = Platform.OS === "web" ? 67 : 0;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const changeColor =
    (data?.change ?? 0) >= 0 ? colors.long : colors.short;

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
            Loading price...
          </Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            Failed to load price
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
          {/* Live Price Hero */}
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
            <Text style={[styles.assetLabel, { color: colors.mutedForeground }]}>
              XAU/USD
            </Text>
            <Text style={[styles.price, { color: colors.foreground }]}>
              ${data.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <View style={styles.changeRow}>
              <Text style={[styles.changeValue, { color: changeColor }]}>
                {data.change >= 0 ? "+" : ""}{data.change.toFixed(2)}
              </Text>
              <View
                style={[
                  styles.pctBadge,
                  { backgroundColor: changeColor + "22", borderColor: changeColor + "44" },
                ]}
              >
                <Text style={[styles.pctText, { color: changeColor }]}>
                  {data.change >= 0 ? "+" : ""}{data.changePercent.toFixed(2)}%
                </Text>
              </View>
            </View>
            <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
              {new Date(data.timestamp).toLocaleTimeString()}
            </Text>
          </View>

          {/* 24h Stats */}
          <SectionHeader title="24H Statistics" />
          <View style={styles.statsRow}>
            <StatCard
              label="24H High"
              value={`$${data.high24h.toFixed(2)}`}
              valueColor={colors.long}
            />
            <View style={{ width: 10 }} />
            <StatCard
              label="24H Low"
              value={`$${data.low24h.toFixed(2)}`}
              valueColor={colors.short}
            />
          </View>

          <View style={styles.statsRow}>
            <StatCard
              label="Range"
              value={`$${(data.high24h - data.low24h).toFixed(2)}`}
            />
            <View style={{ width: 10 }} />
            <StatCard
              label="Mid Range"
              value={`$${((data.high24h + data.low24h) / 2).toFixed(2)}`}
            />
          </View>
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
  assetLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    letterSpacing: 2,
    marginBottom: 8,
  },
  price: {
    fontFamily: "Inter_700Bold",
    fontSize: 48,
    letterSpacing: -1,
  },
  changeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  changeValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
  },
  pctBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  pctText: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
  },
  timestamp: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 12,
  },
  statsRow: {
    flexDirection: "row",
  },
});
