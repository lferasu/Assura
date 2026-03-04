import { MD3LightTheme, type MD3Theme } from "react-native-paper";
import { palette, radii, spacing } from "./tokens";

export const appTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: radii.card,
  colors: {
    ...MD3LightTheme.colors,
    primary: palette.primary,
    secondary: palette.accent,
    tertiary: palette.accent,
    error: palette.danger,
    background: palette.background,
    surface: palette.surface,
    surfaceVariant: palette.surface2,
    outline: palette.border,
    primaryContainer: palette.heroMuted,
    secondaryContainer: palette.surface2,
    onSurface: palette.textPrimary,
    onSurfaceVariant: palette.textSecondary,
    onBackground: palette.textPrimary,
    onPrimary: palette.hero,
    onSecondary: palette.hero,
    onPrimaryContainer: palette.heroText,
    onSecondaryContainer: palette.textPrimary
  }
};

export const themeTokens = {
  palette,
  radii,
  spacing
} as const;
