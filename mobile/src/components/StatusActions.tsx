import React from "react";
import { StyleSheet, View } from "react-native";
import { Badge, IconButton } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { themeTokens } from "../theme";

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <Badge size={18} style={styles.badge}>
      {count > 99 ? "99+" : String(count)}
    </Badge>
  );
}

export function StatusActions({
  urgentCount,
  syncCount,
  syncing,
  onPressUrgent,
  onPressSync
}: {
  urgentCount: number;
  syncCount: number;
  syncing: boolean;
  onPressUrgent: () => void;
  onPressSync: () => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="toolbar">
      <View style={styles.iconWrap}>
        <IconButton
          mode="contained-tonal"
          size={18}
          icon={({ size, color }) => (
            <MaterialCommunityIcons name="alert-circle-outline" size={size} color={color} />
          )}
          containerColor="rgba(255, 255, 255, 0.18)"
          iconColor="#FFD46B"
          accessibilityLabel="Urgent actions"
          onPress={onPressUrgent}
          style={styles.button}
        />
        <CountBadge count={urgentCount} />
      </View>

      <View style={styles.iconWrap}>
        <IconButton
          mode="contained-tonal"
          size={18}
          loading={syncing}
          disabled={syncing}
          icon={({ size, color }) => (
            <MaterialCommunityIcons name="refresh" size={size} color={color} />
          )}
          containerColor="rgba(255, 255, 255, 0.18)"
          iconColor={themeTokens.palette.heroText}
          accessibilityLabel="Sync inbox"
          onPress={onPressSync}
          style={styles.button}
        />
        <CountBadge count={syncCount} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: themeTokens.spacing.xs
  },
  iconWrap: {
    position: "relative"
  },
  button: {
    margin: 0
  },
  badge: {
    position: "absolute",
    top: 1,
    right: 1,
    backgroundColor: themeTokens.palette.danger,
    color: "#FFFFFF"
  }
});
