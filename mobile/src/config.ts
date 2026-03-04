import { Platform } from "react-native";

const defaultApiBaseUrl =
  Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://127.0.0.1:8787";
const defaultSuppressionApiBaseUrl =
  Platform.OS === "android" ? "http://10.0.2.2:8788" : "http://127.0.0.1:8788";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || defaultApiBaseUrl;

export const SUPPRESSION_API_BASE_URL =
  process.env.EXPO_PUBLIC_SUPPRESSION_API_BASE_URL?.trim() || defaultSuppressionApiBaseUrl;

export const APP_USER_ID =
  process.env.EXPO_PUBLIC_ASSURA_USER_ID?.trim() || "local-user";
