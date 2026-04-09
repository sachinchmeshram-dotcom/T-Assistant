import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface SignalBadgeProps {
  signal: "LONG" | "SHORT" | "HOLD";
  size?: "sm" | "md" | "lg";
}

export function SignalBadge({ signal, size = "md" }: SignalBadgeProps) {
  const colors = useColors();

  const bgColor =
    signal === "LONG"
      ? colors.long + "22"
      : signal === "SHORT"
        ? colors.short + "22"
        : colors.hold + "22";

  const textColor =
    signal === "LONG"
      ? colors.long
      : signal === "SHORT"
        ? colors.short
        : colors.mutedForeground;

  const fontSize = size === "sm" ? 11 : size === "lg" ? 20 : 14;
  const paddingH = size === "sm" ? 8 : size === "lg" ? 20 : 12;
  const paddingV = size === "sm" ? 3 : size === "lg" ? 8 : 5;

  return (
    <View style={[styles.badge, { backgroundColor: bgColor, borderColor: textColor + "44", paddingHorizontal: paddingH, paddingVertical: paddingV }]}>
      <Text style={[styles.text, { color: textColor, fontSize }]}>{signal}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  text: {
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.5,
  },
});
