import React from "react";
import { StyleSheet, Text } from "react-native";
import { useColors } from "@/hooks/useColors";

interface SectionHeaderProps {
  title: string;
}

export function SectionHeader({ title }: SectionHeaderProps) {
  const colors = useColors();
  return (
    <Text style={[styles.title, { color: colors.mutedForeground }]}>{title}</Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 8,
  },
});
