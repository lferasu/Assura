import { Platform } from "react-native";

const defaultApiBaseUrl =
  Platform.OS === "android" ? "http://10.0.2.2:8787" : "http://127.0.0.1:8787";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || defaultApiBaseUrl;
