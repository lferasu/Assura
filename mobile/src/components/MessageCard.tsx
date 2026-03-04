import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Swipeable } from "react-native-gesture-handler";
import { Button, Surface, Text, TouchableRipple } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { ImportanceLevel, MobileAssessment } from "../types";
import { themeTokens } from "../theme";

function categoryIcon(category: string): keyof typeof MaterialCommunityIcons.glyphMap {
  const lower = category.toLowerCase();
  if (lower.includes("finance") || lower.includes("billing")) return "currency-usd";
  if (lower.includes("calendar") || lower.includes("schedule")) return "calendar-blank-outline";
  if (lower.includes("education") || lower.includes("school")) return "school-outline";
  if (lower.includes("travel")) return "airplane";
  if (lower.includes("social")) return "account-group-outline";
  return "email-outline";
}

function importanceTone(level: ImportanceLevel) {
  if (level === "critical") {
    return {
      backgroundColor: "#FFE1DE",
      color: "#C85C57"
    };
  }

  if (level === "high") {
    return {
      backgroundColor: "#FFF0D8",
      color: "#D38A34"
    };
  }

  if (level === "medium") {
    return {
      backgroundColor: "#DFF8F1",
      color: "#2B9E81"
    };
  }

  return {
    backgroundColor: "#EEF4FF",
    color: "#6078A0"
  };
}

function formatStoredAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderSource(source: MobileAssessment["source"]): string {
  if (source === "gmail") return "Gmail";
  return source;
}

export function MessageCard({
  item,
  expanded,
  disabled,
  onToggleExpand,
  onMarkRead,
  onToggleDone,
  onRemove,
  onOpenMute
}: {
  item: MobileAssessment;
  expanded: boolean;
  disabled: boolean;
  onToggleExpand: (item: MobileAssessment) => void;
  onMarkRead: (item: MobileAssessment) => void;
  onToggleDone: (item: MobileAssessment) => void;
  onRemove: (item: MobileAssessment) => void;
  onOpenMute: (item: MobileAssessment) => void;
}) {
  const [nextMoveExpanded, setNextMoveExpanded] = useState(true);
  const [suggestedActionsExpanded, setSuggestedActionsExpanded] = useState(true);
  const tone = importanceTone(item.importance);
  const actionCount = item.suggestedActions.length;
  const timeLabel = formatStoredAt(item.storedAt);

  return (
    <Swipeable
      overshootRight={false}
      overshootLeft={false}
      leftThreshold={36}
      rightThreshold={36}
      renderLeftActions={() => (
        <View style={styles.swipeActionWrap}>
          <Button
            mode="contained"
            compact
            onPress={() => onMarkRead(item)}
            icon="check"
            buttonColor={themeTokens.palette.primary}
            textColor="#FFFFFF"
            contentStyle={styles.swipeActionContent}
            style={styles.swipeAction}
            disabled={disabled}
          >
            Mark read
          </Button>
        </View>
      )}
      renderRightActions={() => (
        <View style={styles.swipeActionWrap}>
          <Button
            mode="contained"
            compact
            onPress={() => onOpenMute(item)}
            icon="tune-variant"
            buttonColor={themeTokens.palette.danger}
            textColor="#FFFFFF"
            contentStyle={styles.swipeActionContent}
            style={styles.swipeAction}
            disabled={disabled}
          >
            Not interested
          </Button>
        </View>
      )}
    >
      <Surface style={[styles.card, item.done ? styles.cardDone : null]}>
        <View
          style={[
            styles.accentRail,
            item.needsAction ? styles.accentRailActionable : styles.accentRailNeutral
          ]}
        />
        <LinearGradient
          colors={["#FFFFFF", "#FCFBFF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.cardGradient}
        >
          <TouchableRipple
            onPress={() => onToggleExpand(item)}
            disabled={disabled}
            borderless={false}
            rippleColor="rgba(124, 53, 255, 0.08)"
            style={styles.touchArea}
          >
            <View>
              <View style={styles.topRow}>
                <View style={styles.categoryRow}>
                  <MaterialCommunityIcons
                    name={categoryIcon(item.category)}
                    size={16}
                    color={themeTokens.palette.textSecondary}
                  />
                  <Text variant="labelMedium" style={styles.categoryText}>
                    {item.category}
                  </Text>
                  <View style={styles.metaDot} />
                  <MaterialCommunityIcons
                    name="gmail"
                    size={14}
                    color={themeTokens.palette.textSecondary}
                  />
                  <Text variant="bodySmall" style={styles.categoryText}>
                    {renderSource(item.source)}
                  </Text>
                </View>

                <View style={styles.topRight}>
                  <View style={[styles.priorityBadge, { backgroundColor: tone.backgroundColor }]}>
                    <Text style={[styles.priorityText, { color: tone.color }]}>{item.importance}</Text>
                  </View>
                  <Text variant="bodySmall" style={styles.timeText}>
                    {timeLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.titleRow}>
                <Text
                  variant="titleMedium"
                  style={[styles.title, item.done ? styles.titleDone : null]}
                  numberOfLines={1}
                >
                  {item.subject}
                </Text>
                <MaterialCommunityIcons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={themeTokens.palette.textSecondary}
                />
              </View>

              <View style={styles.metaRow}>
                <Text variant="bodySmall" style={styles.metaText} numberOfLines={1}>
                  {item.from}
                </Text>
              </View>

              {item.summary ? (
                <Text
                  variant="bodyMedium"
                  style={[styles.summary, !expanded ? styles.summaryCollapsed : null]}
                  numberOfLines={expanded ? 4 : 2}
                >
                  {item.summary}
                </Text>
              ) : null}

              {item.needsAction ? (
                <View style={styles.actionStrip}>
                  <MaterialCommunityIcons name="lightning-bolt-outline" size={16} color={themeTokens.palette.warning} />
                  <Text variant="labelMedium" style={styles.actionStripText}>
                    Action
                  </Text>
                  <Text variant="bodySmall" style={styles.actionMeta}>
                    {actionCount || 0} {actionCount === 1 ? "step" : "steps"}
                  </Text>
                  <Text variant="bodySmall" style={styles.actionMeta}>
                    {item.keyDates.length} {item.keyDates.length === 1 ? "key date" : "key dates"}
                  </Text>
                </View>
              ) : null}
            </View>
          </TouchableRipple>
        </LinearGradient>

        {expanded ? (
          <View style={styles.expandedArea}>
            {item.actionSummary || item.suggestedActions.length > 0 ? (
              <View style={styles.dualColumnRow}>
                {item.actionSummary ? (
                  <View style={styles.toggleColumn}>
                    <TouchableRipple
                      onPress={() => setNextMoveExpanded((current) => !current)}
                      borderless={false}
                      rippleColor="rgba(124, 53, 255, 0.08)"
                      style={styles.sectionToggle}
                    >
                      <View style={styles.sectionToggleRow}>
                        <Text variant="labelMedium" style={styles.detailLabel}>
                          Next best move
                        </Text>
                        <MaterialCommunityIcons
                          name={nextMoveExpanded ? "chevron-up" : "chevron-down"}
                          size={18}
                          color={themeTokens.palette.primary}
                        />
                      </View>
                    </TouchableRipple>
                  </View>
                ) : null}

                {item.suggestedActions.length > 0 ? (
                  <View style={styles.toggleColumn}>
                    <TouchableRipple
                      onPress={() => setSuggestedActionsExpanded((current) => !current)}
                      borderless={false}
                      rippleColor="rgba(124, 53, 255, 0.08)"
                      style={styles.sectionToggle}
                    >
                      <View style={styles.sectionToggleRow}>
                        <Text variant="labelMedium" style={styles.detailLabel}>
                          Suggested actions
                        </Text>
                        <MaterialCommunityIcons
                          name={suggestedActionsExpanded ? "chevron-up" : "chevron-down"}
                          size={18}
                          color={themeTokens.palette.primary}
                        />
                      </View>
                    </TouchableRipple>
                  </View>
                ) : null}
              </View>
            ) : null}

            {item.actionSummary && nextMoveExpanded ? (
              <View style={styles.detailBlock}>
                <Text variant="bodyMedium" style={styles.detailText}>
                  {item.actionSummary}
                </Text>
              </View>
            ) : null}

            {item.suggestedActions.length > 0 && suggestedActionsExpanded ? (
              <View style={styles.detailBlock}>
                {item.suggestedActions.map((action) => (
                  <View key={action.id} style={styles.listRow}>
                    <MaterialCommunityIcons name="arrow-right" size={14} color={themeTokens.palette.primary} />
                    <View style={styles.listBody}>
                      <Text variant="bodyMedium" style={styles.listTitle}>
                        {action.title}
                      </Text>
                      <Text variant="bodySmall" style={styles.listMeta}>
                        {action.kind}
                        {action.dueDate ? ` · due ${action.dueDate}` : ""}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {item.keyDates.length > 0 ? (
              <View style={styles.detailBlock}>
                <Text variant="labelMedium" style={styles.detailLabel}>
                  Key dates
                </Text>
                <View style={styles.dateWrap}>
                  {item.keyDates.map((date) => (
                    <View key={`${date.label}-${date.date}`} style={styles.dateChip}>
                      <Text variant="labelSmall" style={styles.dateLabel}>
                        {date.label}
                      </Text>
                      <Text variant="bodySmall" style={styles.dateValue}>
                        {date.date}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.buttonRow}>
              <Button
                mode="contained-tonal"
                onPress={() => onToggleDone(item)}
                disabled={disabled}
                compact
              >
                {item.done ? "Mark active" : "Mark done"}
              </Button>
              <Button
                mode="text"
                onPress={() => onRemove(item)}
                disabled={disabled}
                compact
                textColor={themeTokens.palette.danger}
              >
                Remove
              </Button>
            </View>
          </View>
        ) : null}
      </Surface>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  swipeActionWrap: {
    justifyContent: "center",
    alignItems: "flex-end",
    paddingLeft: themeTokens.spacing.sm
  },
  swipeAction: {
    borderRadius: themeTokens.radii.card
  },
  swipeActionContent: {
    minHeight: 42
  },
  card: {
    borderRadius: themeTokens.radii.card,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(167, 142, 226, 0.14)",
    overflow: "hidden",
    position: "relative"
  },
  accentRail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
    zIndex: 2
  },
  accentRailActionable: {
    backgroundColor: themeTokens.palette.primary
  },
  accentRailNeutral: {
    backgroundColor: "#E7DDFE"
  },
  cardGradient: {
    padding: themeTokens.spacing.sm,
    paddingLeft: themeTokens.spacing.md
  },
  cardDone: {
    opacity: 0.72
  },
  touchArea: {
    borderRadius: themeTokens.radii.card
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: themeTokens.spacing.sm
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: themeTokens.spacing.xs
  },
  categoryText: {
    color: themeTokens.palette.textSecondary,
    textTransform: "capitalize"
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: themeTokens.spacing.xs
  },
  priorityBadge: {
    borderRadius: themeTokens.radii.chip,
    paddingHorizontal: themeTokens.spacing.xs,
    paddingVertical: themeTokens.spacing.xxs
  },
  priorityText: {
    fontSize: 10,
    textTransform: "uppercase",
    fontWeight: "700"
  },
  timeText: {
    color: themeTokens.palette.textSecondary
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: themeTokens.spacing.xs,
    marginTop: themeTokens.spacing.xs
  },
  title: {
    flex: 1,
    color: themeTokens.palette.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600"
  },
  titleDone: {
    textDecorationLine: "line-through"
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: "#C9BFB0"
  },
  metaText: {
    color: themeTokens.palette.textSecondary,
    flexShrink: 1
  },
  summary: {
    marginTop: themeTokens.spacing.xs,
    color: themeTokens.palette.textSecondary,
    lineHeight: 18
  },
  summaryCollapsed: {
    minHeight: 36
  },
  actionStrip: {
    marginTop: themeTokens.spacing.xs,
    paddingHorizontal: themeTokens.spacing.sm,
    paddingVertical: 6,
    borderRadius: themeTokens.radii.chip,
    backgroundColor: "#F4EEFF",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: themeTokens.spacing.xs,
    borderWidth: 1,
    borderColor: "#E2D5FF"
  },
  actionStripText: {
    color: themeTokens.palette.primary,
    fontWeight: "700"
  },
  actionMeta: {
    color: "#71689A"
  },
  expandedArea: {
    marginTop: themeTokens.spacing.sm,
    paddingTop: themeTokens.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "#EEE7FB",
    gap: themeTokens.spacing.sm
  },
  dualColumnRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: themeTokens.spacing.sm
  },
  toggleColumn: {
    flex: 1
  },
  detailBlock: {
    gap: themeTokens.spacing.xs,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: themeTokens.spacing.sm,
    borderWidth: 1,
    borderColor: "#EEE7FB"
  },
  sectionToggle: {
    borderRadius: 18,
    backgroundColor: "#F7F3FF",
    borderWidth: 1,
    borderColor: "#E7DCFF"
  },
  sectionToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: themeTokens.spacing.xs
  },
  detailLabel: {
    color: themeTokens.palette.primary,
    textTransform: "uppercase",
    letterSpacing: 0.4
  },
  detailText: {
    color: themeTokens.palette.textPrimary,
    lineHeight: 20
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: themeTokens.spacing.xs
  },
  listBody: {
    flex: 1
  },
  listTitle: {
    color: themeTokens.palette.textPrimary
  },
  listMeta: {
    color: themeTokens.palette.textSecondary,
    marginTop: 2
  },
  dateWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: themeTokens.spacing.xs
  },
  dateChip: {
    borderRadius: themeTokens.radii.badge,
    backgroundColor: "#F6F1FF",
    paddingHorizontal: themeTokens.spacing.sm,
    paddingVertical: themeTokens.spacing.xs
  },
  dateLabel: {
    color: themeTokens.palette.textSecondary,
    textTransform: "uppercase"
  },
  dateValue: {
    color: themeTokens.palette.textPrimary
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: themeTokens.spacing.xs
  }
});
