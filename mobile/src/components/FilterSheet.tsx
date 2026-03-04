import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Chip, Modal, Portal, Switch, Text } from "react-native-paper";
import type { ImportanceLevel } from "../types";
import { themeTokens } from "../theme";

type CategoryFilter = "all" | string;
type ImportanceFilter = "all" | ImportanceLevel;

export function FilterSheet({
  visible,
  categoryOptions,
  currentFocusMode,
  currentCategory,
  currentImportance,
  currentNeedsActionOnly,
  onDismiss,
  onApply,
  onClear
}: {
  visible: boolean;
  categoryOptions: string[];
  currentFocusMode: boolean;
  currentCategory: CategoryFilter;
  currentImportance: ImportanceFilter;
  currentNeedsActionOnly: boolean;
  onDismiss: () => void;
  onApply: (filters: {
    focusMode: boolean;
    category: CategoryFilter;
    importance: ImportanceFilter;
    needsActionOnly: boolean;
  }) => void;
  onClear: () => void;
}) {
  const [focusMode, setFocusMode] = useState(currentFocusMode);
  const [category, setCategory] = useState<CategoryFilter>(currentCategory);
  const [importance, setImportance] = useState<ImportanceFilter>(currentImportance);
  const [needsActionOnly, setNeedsActionOnly] = useState(currentNeedsActionOnly);

  useEffect(() => {
    if (!visible) return;
    setFocusMode(currentFocusMode);
    setCategory(currentCategory);
    setImportance(currentImportance);
    setNeedsActionOnly(currentNeedsActionOnly);
  }, [visible, currentFocusMode, currentCategory, currentImportance, currentNeedsActionOnly]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text variant="titleMedium" style={styles.title}>
            Filters
          </Text>

          <Text variant="labelLarge" style={styles.sectionLabel}>
            Category
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {categoryOptions.map((option) => (
              <Chip
                key={option}
                compact
                selected={category === option}
                onPress={() => setCategory(option)}
                style={styles.chip}
              >
                {option}
              </Chip>
            ))}
          </ScrollView>

          <Text variant="labelLarge" style={styles.sectionLabel}>
            Priority
          </Text>
          <View style={styles.wrapRow}>
            {(["all", "low", "medium", "high", "critical"] as ImportanceFilter[]).map((option) => (
              <Chip
                key={option}
                compact
                selected={importance === option}
                onPress={() => setImportance(option)}
                style={styles.chip}
              >
                {option}
              </Chip>
            ))}
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text variant="labelLarge" style={styles.sectionLabel}>
                Focus inbox
              </Text>
              <Text variant="bodySmall" style={styles.supportText}>
                Hide low-value updates like promotions, newsletters, and other likely noise.
              </Text>
            </View>
            <Switch value={focusMode} onValueChange={setFocusMode} />
          </View>

          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text variant="labelLarge" style={styles.sectionLabel}>
                Only actionable
              </Text>
              <Text variant="bodySmall" style={styles.supportText}>
                Keep the inbox focused on messages that need a next step.
              </Text>
            </View>
            <Switch value={needsActionOnly} onValueChange={setNeedsActionOnly} />
          </View>

          <View style={styles.actionRow}>
            <Button
              mode="text"
              onPress={() => {
                onClear();
                onDismiss();
              }}
            >
              Clear
            </Button>
            <Button
              mode="contained"
              onPress={() => {
                onApply({ focusMode, category, importance, needsActionOnly });
                onDismiss();
              }}
            >
              Apply
            </Button>
          </View>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    justifyContent: "flex-end",
    margin: 0
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: themeTokens.spacing.md,
    paddingTop: themeTokens.spacing.sm,
    paddingBottom: themeTokens.spacing.xl,
    borderTopWidth: 1,
    borderColor: "#EEE7FB"
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: themeTokens.palette.border,
    alignSelf: "center",
    marginBottom: themeTokens.spacing.sm
  },
  title: {
    color: themeTokens.palette.textPrimary,
    marginBottom: themeTokens.spacing.md
  },
  sectionLabel: {
    color: themeTokens.palette.textPrimary,
    marginBottom: themeTokens.spacing.xs
  },
  chipRow: {
    gap: themeTokens.spacing.xs,
    paddingBottom: themeTokens.spacing.sm
  },
  wrapRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: themeTokens.spacing.xs,
    marginBottom: themeTokens.spacing.md
  },
  chip: {
    backgroundColor: "#F7F4FF"
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: themeTokens.spacing.md,
    paddingVertical: themeTokens.spacing.sm,
    marginBottom: themeTokens.spacing.md
  },
  switchCopy: {
    flex: 1
  },
  supportText: {
    color: themeTokens.palette.textSecondary
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: themeTokens.spacing.xs
  }
});
