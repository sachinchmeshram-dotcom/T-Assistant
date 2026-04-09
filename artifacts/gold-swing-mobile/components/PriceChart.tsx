import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { useColors } from "@/hooks/useColors";

interface PriceChartProps {
  data: number[];
  width: number;
  height?: number;
}

export function PriceChart({ data, width, height = 130 }: PriceChartProps) {
  const colors = useColors();

  if (data.length < 2) {
    return (
      <View
        style={[
          styles.placeholder,
          { height, backgroundColor: colors.card, borderRadius: colors.radius },
        ]}
      >
        <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>
          Collecting price data...
        </Text>
      </View>
    );
  }

  const PAD_TOP = 8;
  const PAD_BOTTOM = 8;
  const innerH = height - PAD_TOP - PAD_BOTTOM;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max === min ? 1 : max - min;

  const getX = (i: number) => (i / (data.length - 1)) * width;
  const getY = (v: number) =>
    PAD_TOP + innerH - ((v - min) / range) * innerH;

  const linePath = data
    .map((v, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(v).toFixed(1)}`)
    .join(" ");

  const lastX = getX(data.length - 1);
  const areaPath =
    linePath +
    ` L ${lastX.toFixed(1)} ${height} L 0 ${height} Z`;

  const isUp = data[data.length - 1] >= data[0];
  const lineColor = isUp ? colors.long : colors.short;

  const minLabel = `$${min.toFixed(2)}`;
  const maxLabel = `$${max.toFixed(2)}`;

  return (
    <View style={{ position: "relative" }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lineColor} stopOpacity={0.25} />
            <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* Filled area */}
        <Path d={areaPath} fill="url(#areaGrad)" />

        {/* Price line */}
        <Path
          d={linePath}
          stroke={lineColor}
          strokeWidth={1.8}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>

      {/* Price labels */}
      <View style={styles.labels}>
        <Text style={[styles.labelText, { color: colors.mutedForeground }]}>
          {maxLabel}
        </Text>
        <Text style={[styles.labelText, { color: colors.mutedForeground }]}>
          {minLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
  },
  labels: {
    position: "absolute",
    right: 4,
    top: 0,
    bottom: 0,
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  labelText: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    textAlign: "right",
  },
});
