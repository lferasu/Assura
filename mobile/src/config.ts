import Constants from "expo-constants";
import { Platform } from "react-native";

function getExpoHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri?.trim();
  if (!hostUri) {
    return null;
  }

  const [host] = hostUri.split(":");
  if (!host) {
    return null;
  }

  return host.replace(/^\[/, "").replace(/\]$/, "");
}

function getDefaultApiHost(): string {
  const expoHost = getExpoHost();
  if (expoHost) {
    if (Platform.OS === "android" && (expoHost === "127.0.0.1" || expoHost === "localhost")) {
      return "10.0.2.2";
    }

    return expoHost;
  }

  return Platform.OS === "android" ? "10.0.2.2" : "127.0.0.1";
}

const defaultApiHost = getDefaultApiHost();
const defaultApiBaseUrl = `http://${defaultApiHost}:8787`;

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || defaultApiBaseUrl;

export const SUPPRESSION_API_BASE_URL =
  process.env.EXPO_PUBLIC_SUPPRESSION_API_BASE_URL?.trim() || API_BASE_URL;

export const APP_USER_ID =
  process.env.EXPO_PUBLIC_ASSURA_USER_ID?.trim() || "local-user";
