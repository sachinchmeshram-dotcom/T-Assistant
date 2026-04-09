import colors from "@/constants/colors";

/**
 * Returns the design tokens for this app.
 * The app is always dark-themed (no light mode variant).
 */
export function useColors() {
  return { ...colors.light, radius: colors.radius };
}
