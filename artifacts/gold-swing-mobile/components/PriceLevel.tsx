import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface PriceLevelProps {
  label: string;
  price: number;
  color?: string;
}

export function PriceLevel({ label, price, color }: PriceLevelProps) {
  const colors = useColors();
  const textColor = color ?? colors.foreground;
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.price, { color: textColor }]}>${price.toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  price: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
});
