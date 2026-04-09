import { useGetHistory } from "@workspace/api-client-react";
import type { HistoryEntry } from "@workspace/api-client-react";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SignalBadge } from "@/components/SignalBadge";
import { useColors } from "@/hooks/useColors";

function TradeRow({ item }: { item: HistoryEntry }) {
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
          ? "RUNNING"
          : "HOLD";

  const pnl = item.pnlPoints;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.rowLeft}>
        <SignalBadge signal={item.signal} size="sm" />
        <Text style={[styles.time, { color: colors.mutedForeground }]}>
          {new Date(item.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {" · "}
          {new Date(item.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </Text>
        <Text style={[styles.entry, { color: colors.mutedForeground }]}>
          Entry ${item.entryPrice.toFixed(2)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: statusColor + "22", borderColor: statusColor + "44" },
          ]}
        >
          <Text style={[styles.statusText, { color: statusColor }]}>
            {statusLabel}
          </Text>
        </View>
        {pnl !== undefined && pnl !== null && item.tradeStatus !== "RUNNING" && item.tradeStatus !== "HOLD" ? (
          <Text
            style={[
              styles.pnl,
              { color: pnl >= 0 ? colors.long : colors.short },
            ]}
          >
            {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)} pts
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data, isLoading, error, refetch, isFetching } = useGetHistory({
    query: {
      refetchInterval: 30000,
      refetchOnWindowFocus: true,
    },
  });

  const topPad = Platform.OS === "web" ? 67 : 0;

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.destructive }]}>
          Failed to load history
        </Text>
        <Text
          style={[styles.retryText, { color: colors.primary }]}
          onPress={() => refetch()}
        >
          Tap to retry
        </Text>
      </View>
    );
  }

  const signals = data?.signals ?? [];

  return (
    <FlatList
      style={[styles.container, { backgroundColor: colors.background }]}
      data={signals}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[
        styles.listContent,
        {
          paddingTop: topPad + 16,
          paddingBottom: (Platform.OS === "web" ? 34 : 0) + 100,
        },
      ]}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      renderItem={({ item }) => <TradeRow item={item} />}
      scrollEnabled
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No trade history yet
          </Text>
          <Text style={[styles.emptySubText, { color: colors.mutedForeground }]}>
            Signals will appear here once generated
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  retryText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
  },
  rowLeft: {
    flex: 1,
    gap: 4,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  time: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
  entry: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  statusText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 0.8,
  },
  pnl: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
  },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 8,
  },
  emptyText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  emptySubText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
