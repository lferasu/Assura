export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24
} as const;

export const radii = {
  badge: 10,
  card: 22,
  chip: 999
} as const;

export const palette = {
  background: "#F3F2F7",
  surface: "#FFFFFF",
  surface2: "#F7F4FF",
  border: "#E4E0EC",
  textPrimary: "#18233D",
  textSecondary: "#6D7690",
  primary: "#7C35FF",
  accent: "#D85AE8",
  danger: "#E06D67",
  warning: "#F2B45F",
  success: "#36B98A",
  hero: "#8B2FFF",
  heroMuted: "#D852D3",
  heroText: "#FDFBFF"
} as const;

export const shadows = {
  card: {
    shadowColor: "#2E2250",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3
  }
} as const;
