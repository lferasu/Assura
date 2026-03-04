import "react-native-gesture-handler";
import React, { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { FlashList } from "@shopify/flash-list";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  ActivityIndicator,
  Button,
  Modal,
  PaperProvider,
  Portal,
  Searchbar,
  SegmentedButtons,
  Snackbar,
  Surface,
  Text,
  TextInput
} from "react-native-paper";
import {
  areLocalNotificationsAvailable,
  configureNotifications,
  requestNotificationPermissions,
  scheduleLocalNotification
} from "./src/notifications";
import { shouldAllowInboxMessage } from "./src/inboxPolicy";
import {
  acknowledgeExpectationAlert,
  applySuppressionRulePrompt,
  createExpectation,
  deleteSuppressionRule,
  deleteExpectation,
  fetchExpectationAlerts,
  fetchExpectations,
  fetchInboxWindow,
  fetchSuppressionRules,
  removeInboxItem,
  sendNotInterestedFeedback,
  searchInboxWindow,
  updateSuppressionRule,
  updateInboxItem
} from "./src/api/client";
import { hasToolCallableActions } from "./src/actionSemantics";
import { FilterSheet } from "./src/components/FilterSheet";
import { MessageCard } from "./src/components/MessageCard";
import { StatusActions } from "./src/components/StatusActions";
import { appTheme, themeTokens } from "./src/theme";
import type {
  ExpectationAlert,
  ImportanceLevel,
  MobileAssessment,
  MobileExpectation,
  MobileSuppressionRule
} from "./src/types";

type CategoryFilter = "all" | string;
type ImportanceFilter = "all" | ImportanceLevel;
type ScreenView = "inbox" | "attention" | "rules";

const INBOX_LOOKBACK_HOURS = 24;
const SEARCH_LOOKBACK_DAYS = 7;
const INBOX_FETCH_LIMIT = 250;
const SEARCH_FETCH_LIMIT = 250;

configureNotifications();

function importanceRank(level: ImportanceLevel): number {
  if (level === "critical") return 0;
  if (level === "high") return 1;
  if (level === "medium") return 2;
  return 3;
}

function sortByPriority(items: MobileAssessment[]): MobileAssessment[] {
  return [...items].sort((left, right) => {
    if (left.done !== right.done) {
      return left.done ? 1 : -1;
    }

    const leftActionable = hasToolCallableActions(left);
    const rightActionable = hasToolCallableActions(right);
    if (leftActionable !== rightActionable) {
      return leftActionable ? -1 : 1;
    }

    const priorityGap = importanceRank(left.importance) - importanceRank(right.importance);
    if (priorityGap !== 0) return priorityGap;
    return new Date(right.storedAt).getTime() - new Date(left.storedAt).getTime();
  });
}

function shouldSurfaceInFocusedInbox(item: MobileAssessment): boolean {
  return shouldAllowInboxMessage({
    category: item.category,
    subject: item.subject,
    from: item.from,
    summary: item.summary,
    actionSummary: item.actionSummary,
    hasToolCallableAction: hasToolCallableActions(item)
  });
}

function mergeInboxItems(current: MobileAssessment[], incoming: MobileAssessment[]): MobileAssessment[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const merged: MobileAssessment[] = [];

  for (const item of current) {
    const replacement = incomingById.get(item.id);
    if (replacement) {
      merged.push(replacement);
      incomingById.delete(item.id);
    }
  }

  for (const item of incoming) {
    if (incomingById.has(item.id)) {
      merged.push(item);
    }
  }

  return sortByPriority(merged);
}

function describeSuppressionRule(rule: MobileSuppressionRule): { title: string; detail: string } {
  if (rule.type === "THREAD") {
    return { title: "Muted thread", detail: rule.threadId || "Specific thread" };
  }

  if (rule.type === "SENDER") {
    return { title: "Muted sender", detail: rule.senderEmail || "Unknown sender" };
  }

  const topic = rule.context.topic || "Similar message pattern";
  const keywords = rule.context.keywords?.length ? rule.context.keywords.join(", ") : "No keywords";
  return {
    title: `Muted similar messages from ${rule.senderEmail || "sender"}`,
    detail: `${topic} · ${keywords}`
  };
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenView>("inbox");
  const [focusMode, setFocusMode] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>("all");
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
  const [items, setItems] = useState<MobileAssessment[]>([]);
  const [expectations, setExpectations] = useState<MobileExpectation[]>([]);
  const [alerts, setAlerts] = useState<ExpectationAlert[]>([]);
  const [rules, setRules] = useState<MobileSuppressionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [ruleSearchQuery, setRuleSearchQuery] = useState("");
  const [rulePrompt, setRulePrompt] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [expectationQuery, setExpectationQuery] = useState("");
  const [expectationBusy, setExpectationBusy] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [muteTarget, setMuteTarget] = useState<MobileAssessment | null>(null);
  const [undoItem, setUndoItem] = useState<{ item: MobileAssessment; ruleId: string | null } | null>(null);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const notifiedAlertIdsRef = useRef<string[]>([]);
  const undoneBeforeResponseRef = useRef(new Set<string>());

  const deferredCategory = useDeferredValue(categoryFilter);
  const deferredFocusMode = useDeferredValue(focusMode);
  const deferredImportance = useDeferredValue(importanceFilter);
  const deferredNeedsAction = useDeferredValue(needsActionOnly);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const deferredRuleSearchQuery = useDeferredValue(ruleSearchQuery);
  const quietedCount = deferredFocusMode
    ? items.filter((item) => !shouldSurfaceInFocusedInbox(item)).length
    : 0;

  const filteredItems = sortByPriority(
    items.filter((item) => {
      if (!hasToolCallableActions(item)) return false;
      if (deferredFocusMode && !shouldSurfaceInFocusedInbox(item)) return false;
      if (deferredCategory !== "all" && item.category !== deferredCategory) return false;
      if (deferredImportance !== "all" && item.importance !== deferredImportance) return false;
      return true;
    })
  );

  const urgentItems = sortByPriority(
    items.filter(
      (item) =>
        !item.done &&
        hasToolCallableActions(item) &&
        (item.importance === "critical" || item.importance === "high")
    )
  );
  const categoryOptions = [
    "all",
    ...Array.from(new Set(items.map((item) => item.category))).sort((left, right) =>
      left.localeCompare(right)
    )
  ];

  const activeRuleCount = rules.filter((rule) => rule.isActive).length;
  const headerTitle =
    currentScreen === "inbox"
      ? "Inbox"
      : currentScreen === "attention"
        ? "Attention"
        : "Rules";
  const headerSubtitle =
    currentScreen === "inbox"
      ? `${filteredItems.length} messages · ${filteredItems.filter((item) => hasToolCallableActions(item)).length} actionable${deferredFocusMode ? ` · ${quietedCount} quieted` : ""}`
      : currentScreen === "attention"
        ? `${urgentItems.length} urgent items · ${alerts.length} expected alerts`
        : `${rules.length} rules · ${activeRuleCount} active`;

  function showSnackbar(message: string): void {
    setSnackbarMessage(message);
    setSnackbarVisible(true);
  }

  function markPending(id: string): void {
    setPendingIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  function clearPending(id: string): void {
    setPendingIds((current) => current.filter((value) => value !== id));
  }

  function toggleExpanded(item: MobileAssessment): void {
    setExpandedIds((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]
    );
  }

  async function notifyExpectedEmail(item: ExpectationAlert): Promise<void> {
    await scheduleLocalNotification(
      "Expected email arrived",
      `${item.query}\n${item.message.subject}`
    );
  }

  async function loadItems(mode: "initial" | "manual" | "background" = "initial"): Promise<void> {
    if (mode === "manual") setRefreshing(true);
    if (mode === "initial") setLoading(true);

    try {
      const query = deferredSearchQuery.trim();
      const inboxRequest = query
        ? searchInboxWindow(query, {
            limit: SEARCH_FETCH_LIMIT,
            daysBack: SEARCH_LOOKBACK_DAYS,
            attentionOnly: true
          })
        : fetchInboxWindow({
            limit: INBOX_FETCH_LIMIT,
            hoursBack: INBOX_LOOKBACK_HOURS,
            attentionOnly: true
          });
      const [itemsResult, expectationsResult, alertsResult] = await Promise.allSettled([
        inboxRequest,
        fetchExpectations(),
        fetchExpectationAlerts()
      ]);

      if (itemsResult.status !== "fulfilled") {
        throw itemsResult.reason;
      }

      const nextItems = itemsResult.value;
      const nextExpectations =
        expectationsResult.status === "fulfilled" ? expectationsResult.value : expectations;
      const nextAlerts = alertsResult.status === "fulfilled" ? alertsResult.value : alerts;
      const sorted = sortByPriority(nextItems);

      startTransition(() => {
        setItems((current) => mergeInboxItems(current, sorted));
        setExpectations(nextExpectations);
        setAlerts(nextAlerts);
        setExpandedIds((current) => current.filter((id) => sorted.some((item) => item.id === id)));
      });
      setError(null);

      const unseen = nextAlerts.filter((item) => !notifiedAlertIdsRef.current.includes(item.id));
      for (const item of unseen) {
        void notifyExpectedEmail(item);
      }
      notifiedAlertIdsRef.current = nextAlerts.map((item) => item.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadRules(query = ruleSearchQuery): Promise<void> {
    setRulesLoading(true);
    try {
      const nextRules = await fetchSuppressionRules(query);
      startTransition(() => {
        setRules(nextRules);
        setSelectedRuleId((current) =>
          current && nextRules.some((rule) => rule.id === current) ? current : null
        );
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setRulesLoading(false);
    }
  }

  async function handleToggleDone(item: MobileAssessment): Promise<void> {
    markPending(item.id);
    try {
      await Haptics.selectionAsync();
      await updateInboxItem(item.id, { done: !item.done });
      startTransition(() => {
        setItems((current) =>
          current.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry))
        );
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      clearPending(item.id);
    }
  }

  async function handleRemove(item: MobileAssessment): Promise<void> {
    markPending(item.id);
    try {
      await updateInboxItem(item.id, { removed: true });
      await removeInboxItem(item.id);
      startTransition(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        setExpandedIds((current) => current.filter((id) => id !== item.id));
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      clearPending(item.id);
    }
  }

  async function handleMarkRead(item: MobileAssessment): Promise<void> {
    markPending(item.id);
    try {
      await Haptics.selectionAsync();
      await updateInboxItem(item.id, { done: true, removed: true });
      await removeInboxItem(item.id);
      startTransition(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
        setExpandedIds((current) => current.filter((id) => id !== item.id));
      });
      setError(null);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      clearPending(item.id);
    }
  }

  async function handleMute(mode: "SENDER_ONLY" | "SENDER_AND_CONTEXT"): Promise<void> {
    if (!muteTarget) return;

    const item = muteTarget;
    setMuteTarget(null);
    markPending(item.id);
    await Haptics.selectionAsync();

    startTransition(() => {
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setExpandedIds((current) => current.filter((id) => id !== item.id));
    });
    setUndoItem({ item, ruleId: null });
    showSnackbar("Message hidden. Undo to restore it.");

    try {
      const result = await sendNotInterestedFeedback(item, mode);
      if (undoneBeforeResponseRef.current.has(item.id)) {
        undoneBeforeResponseRef.current.delete(item.id);
        await deleteSuppressionRule(result.ruleId);
      } else {
        setUndoItem((current) =>
          current && current.item.id === item.id ? { ...current, ruleId: result.ruleId } : current
        );
      }
      setError(null);
    } catch (mutationError) {
      startTransition(() => {
        setItems((current) => mergeInboxItems(current, [item]));
      });
      setUndoItem((current) => (current?.item.id === item.id ? null : current));
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      clearPending(item.id);
    }
  }

  async function handleUndoMute(): Promise<void> {
    if (!undoItem) return;
    const restored = undoItem;
    setUndoItem(null);
    setSnackbarVisible(false);
    startTransition(() => {
      setItems((current) => mergeInboxItems(current, [restored.item]));
    });

    if (restored.ruleId) {
      try {
        await deleteSuppressionRule(restored.ruleId);
      } catch {
        setError("Message restored locally, but the suppression rule could not be removed.");
      }
    } else {
      undoneBeforeResponseRef.current.add(restored.item.id);
    }
  }

  async function handleToggleRule(rule: MobileSuppressionRule): Promise<void> {
    markPending(rule.id);
    try {
      const updated = await updateSuppressionRule(rule.id, { isActive: !rule.isActive });
      startTransition(() => {
        setRules((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      clearPending(rule.id);
    }
  }

  async function handleDeleteRule(rule: MobileSuppressionRule): Promise<void> {
    markPending(rule.id);
    try {
      await deleteSuppressionRule(rule.id);
      startTransition(() => {
        setRules((current) => current.filter((entry) => entry.id !== rule.id));
        setSelectedRuleId((current) => (current === rule.id ? null : current));
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      clearPending(rule.id);
    }
  }

  async function handleApplyRulePrompt(): Promise<void> {
    const trimmed = rulePrompt.trim();
    if (!trimmed) return;

    setRulesLoading(true);
    try {
      const payload = await applySuppressionRulePrompt(trimmed, selectedRuleId || undefined);
      setRulePrompt("");
      setSelectedRuleId(payload.operation === "deleted" ? null : payload.item?.id || selectedRuleId);
      await loadRules(ruleSearchQuery);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setRulesLoading(false);
    }
  }

  async function handleCreateExpectation(): Promise<void> {
    const trimmed = expectationQuery.trim();
    if (!trimmed) return;
    setExpectationBusy(true);
    try {
      const created = await createExpectation(trimmed);
      startTransition(() => {
        setExpectations((current) => [created, ...current]);
        setExpectationQuery("");
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setExpectationBusy(false);
    }
  }

  async function handleDeleteExpectation(item: MobileExpectation): Promise<void> {
    setExpectationBusy(true);
    try {
      await deleteExpectation(item.id);
      startTransition(() => {
        setExpectations((current) => current.filter((entry) => entry.id !== item.id));
        setAlerts((current) => current.filter((entry) => entry.expectationId !== item.id));
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setExpectationBusy(false);
    }
  }

  async function handleAcknowledgeAlert(item: ExpectationAlert): Promise<void> {
    setExpectationBusy(true);
    try {
      await acknowledgeExpectationAlert(item.expectationId, item.matchedMessageId, item.matchedAt);
      startTransition(() => {
        setAlerts((current) => current.filter((entry) => entry.id !== item.id));
      });
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setExpectationBusy(false);
    }
  }

  useEffect(() => {
    if (!areLocalNotificationsAvailable()) {
      return;
    }

    void requestNotificationPermissions();
  }, []);

  useEffect(() => {
    void loadItems("initial");
    void loadRules("");
    const intervalId = setInterval(() => {
      void loadItems("background");
    }, 15000);
    return () => clearInterval(intervalId);
  }, [deferredSearchQuery]);

  useEffect(() => {
    if (currentScreen === "rules") {
      void loadRules(deferredRuleSearchQuery);
    }
  }, [currentScreen, deferredRuleSearchQuery]);

  const header = (
    <Surface style={styles.header} elevation={0}>
      <LinearGradient
        colors={["#7C35FF", "#A53EF1", "#E255C7"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text variant="headlineSmall" style={styles.title}>
              {headerTitle}
            </Text>
            <Text variant="bodySmall" style={styles.subtle}>
              {headerSubtitle}
            </Text>
          </View>
          <StatusActions
            urgentCount={urgentItems.length}
            syncCount={items.length}
            syncing={refreshing}
            onPressUrgent={() => setCurrentScreen("attention")}
            onPressSync={() => void loadItems("manual")}
          />
        </View>

        <SegmentedButtons
          value={currentScreen}
          onValueChange={(value) => setCurrentScreen(value as ScreenView)}
          buttons={[
            {
              value: "inbox",
              label: "Inbox",
              checkedColor: themeTokens.palette.textPrimary,
              uncheckedColor: themeTokens.palette.heroText
            },
            {
              value: "attention",
              label: "Attention",
              checkedColor: themeTokens.palette.textPrimary,
              uncheckedColor: themeTokens.palette.heroText
            },
            {
              value: "rules",
              label: "Rules",
              checkedColor: themeTokens.palette.textPrimary,
              uncheckedColor: themeTokens.palette.heroText
            }
          ]}
          style={styles.segmentedButtons}
        />
      </LinearGradient>
    </Surface>
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <PaperProvider theme={appTheme}>
        <SafeAreaView style={styles.safeArea}>
          <ExpoStatusBar style="dark" />
          <LinearGradient
            colors={["#FCFBFE", "#F4F2F8", "#EEEDF4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.appGradient}
          >
          {header}

          {error ? (
            <Surface style={styles.errorBanner} elevation={0}>
              <Text variant="labelMedium" style={styles.errorTitle}>
                Connection issue
              </Text>
              <Text variant="bodySmall" style={styles.errorText}>
                {error}
              </Text>
            </Surface>
          ) : null}

          {currentScreen === "inbox" ? (
            <View style={styles.screen}>
              <View style={styles.toolbar}>
                <Searchbar
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search last 7 days"
                  style={styles.searchbar}
                />
                <Button mode="contained-tonal" icon="tune-variant" onPress={() => setFilterVisible(true)}>
                  Filter
                </Button>
              </View>

              <FlashList
                data={filteredItems}
                refreshing={refreshing}
                onRefresh={() => void loadItems("manual")}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                ItemSeparatorComponent={() => <View style={styles.spacer} />}
                ListHeaderComponent={
                  <Text variant="bodySmall" style={styles.metric}>
                    {filteredItems.length} shown · {filteredItems.filter((item) => hasToolCallableActions(item)).length} actionable{deferredFocusMode ? ` · ${quietedCount} quieted` : ""}
                  </Text>
                }
                ListEmptyComponent={
                  !loading ? (
                    <Surface style={styles.emptyCard} elevation={0}>
                      <Text variant="titleMedium" style={styles.emptyTitle}>
                        Nothing matches this view
                      </Text>
                      <Text variant="bodyMedium" style={styles.emptyText}>
                        Clear filters or search within the last 7 days.
                      </Text>
                    </Surface>
                  ) : <ActivityIndicator style={styles.loading} />
                }
                renderItem={({ item }) => (
                  <MessageCard
                    item={item}
                    expanded={expandedIds.includes(item.id)}
                    disabled={pendingIds.includes(item.id)}
                    onToggleExpand={toggleExpanded}
                    onMarkRead={(entry) => void handleMarkRead(entry)}
                    onToggleDone={(entry) => void handleToggleDone(entry)}
                    onRemove={(entry) => void handleRemove(entry)}
                    onOpenMute={setMuteTarget}
                  />
                )}
              />
            </View>
          ) : null}

          {currentScreen === "attention" ? (
            <ScrollView contentContainerStyle={styles.screen}>
              <Surface style={styles.card} elevation={0}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Watch expected messages
                </Text>
                <View style={styles.inlineRow}>
                  <TextInput
                    mode="outlined"
                    value={expectationQuery}
                    onChangeText={setExpectationQuery}
                    placeholder="HOA dues, payroll, school closure..."
                    style={styles.flexInput}
                  />
                  <Button mode="contained" onPress={() => void handleCreateExpectation()} disabled={expectationBusy}>
                    Watch
                  </Button>
                </View>
                <View style={styles.wrap}>
                  {expectations.map((item) => (
                    <Button key={item.id} compact mode="outlined" onPress={() => void handleDeleteExpectation(item)}>
                      {item.query}
                    </Button>
                  ))}
                </View>
                {alerts.map((item) => (
                  <Surface key={item.id} style={styles.alert} elevation={0}>
                    <View style={styles.flexInput}>
                      <Text variant="labelMedium">{item.query}</Text>
                      <Text variant="bodySmall" style={styles.subtle}>
                        {item.message.subject}
                      </Text>
                    </View>
                    <Button compact mode="contained-tonal" onPress={() => void handleAcknowledgeAlert(item)} disabled={expectationBusy}>
                      Seen
                    </Button>
                  </Surface>
                ))}
              </Surface>

              <Text variant="titleMedium" style={styles.sectionTitle}>
                Urgent action
              </Text>
              {urgentItems.length === 0 ? (
                <Surface style={styles.emptyCard} elevation={0}>
                  <Text variant="bodyMedium" style={styles.emptyText}>
                    No urgent messages right now.
                  </Text>
                </Surface>
              ) : null}
              {urgentItems.map((item) => (
                <View key={item.id} style={styles.spacerWrap}>
                  <MessageCard
                    item={item}
                    expanded={expandedIds.includes(item.id)}
                    disabled={pendingIds.includes(item.id)}
                    onToggleExpand={toggleExpanded}
                    onMarkRead={(entry) => void handleMarkRead(entry)}
                    onToggleDone={(entry) => void handleToggleDone(entry)}
                    onRemove={(entry) => void handleRemove(entry)}
                    onOpenMute={setMuteTarget}
                  />
                </View>
              ))}
            </ScrollView>
          ) : null}

          {currentScreen === "rules" ? (
            <ScrollView contentContainerStyle={styles.screen}>
              <Surface style={styles.card} elevation={0}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Manage suppression rules
                </Text>
                <Searchbar
                  value={ruleSearchQuery}
                  onChangeText={setRuleSearchQuery}
                  placeholder="Search rules"
                  style={styles.searchbar}
                />
                <TextInput
                  mode="outlined"
                  value={rulePrompt}
                  onChangeText={setRulePrompt}
                  multiline
                  numberOfLines={4}
                  placeholder={selectedRuleId ? "Update the selected rule in plain language" : "Create a rule in plain language"}
                />
                <View style={styles.inlineRow}>
                  <Button mode="contained" onPress={() => void handleApplyRulePrompt()} disabled={rulesLoading}>
                    {selectedRuleId ? "Update rule" : "Create rule"}
                  </Button>
                  {selectedRuleId ? (
                    <Button mode="text" onPress={() => setSelectedRuleId(null)}>
                      Clear
                    </Button>
                  ) : null}
                </View>
              </Surface>

              {rulesLoading ? <ActivityIndicator style={styles.loading} /> : null}
              {rules.map((rule) => {
                const description = describeSuppressionRule(rule);
                const selected = selectedRuleId === rule.id;

                return (
                  <Surface key={rule.id} style={[styles.card, selected ? styles.cardSelected : null]} elevation={0}>
                    <Button compact mode="text" onPress={() => setSelectedRuleId(selected ? null : rule.id)}>
                      {selected ? "Selected" : "Select"}
                    </Button>
                    <Text variant="titleSmall" style={styles.cardTitle}>
                      {description.title}
                    </Text>
                    <Text variant="bodySmall" style={styles.subtle}>
                      {description.detail}
                    </Text>
                    <Text variant="bodySmall" style={styles.subtle}>
                      {rule.threshold ? `Threshold ${rule.threshold.toFixed(2)}` : "Default threshold"}
                      {rule.searchScore ? ` · Score ${rule.searchScore.toFixed(2)}` : ""}
                    </Text>
                    <View style={styles.inlineRow}>
                      <Button mode="contained-tonal" onPress={() => void handleToggleRule(rule)} disabled={pendingIds.includes(rule.id)}>
                        {rule.isActive ? "Pause" : "Enable"}
                      </Button>
                      <Button mode="text" textColor={themeTokens.palette.danger} onPress={() => void handleDeleteRule(rule)} disabled={pendingIds.includes(rule.id)}>
                        Delete
                      </Button>
                    </View>
                  </Surface>
                );
              })}
            </ScrollView>
          ) : null}

          <FilterSheet
            visible={filterVisible}
            categoryOptions={categoryOptions}
            currentFocusMode={focusMode}
            currentCategory={categoryFilter}
            currentImportance={importanceFilter}
            currentNeedsActionOnly={needsActionOnly}
            onDismiss={() => setFilterVisible(false)}
            onApply={({ focusMode: nextFocusMode, category, importance, needsActionOnly: nextNeedsActionOnly }) => {
              setFocusMode(nextFocusMode);
              setCategoryFilter(category);
              setImportanceFilter(importance);
              setNeedsActionOnly(nextNeedsActionOnly);
            }}
            onClear={() => {
              setFocusMode(true);
              setCategoryFilter("all");
              setImportanceFilter("all");
              setNeedsActionOnly(false);
            }}
          />

          <Portal>
            <Modal visible={Boolean(muteTarget)} onDismiss={() => setMuteTarget(null)} contentContainerStyle={styles.modalWrap}>
              <Surface style={styles.sheet} elevation={0}>
                <Text variant="titleMedium" style={styles.cardTitle}>
                  Not interested
                </Text>
                <Text variant="bodySmall" style={styles.subtle}>
                  Choose how narrowly Assura should suppress messages like this.
                </Text>
                <Button mode="contained-tonal" style={styles.sheetButton} onPress={() => void handleMute("SENDER_ONLY")}>
                  Block sender only
                </Button>
                <Button mode="contained" style={styles.sheetButton} onPress={() => void handleMute("SENDER_AND_CONTEXT")}>
                  Block sender + similar context
                </Button>
                <Button mode="text" onPress={() => setMuteTarget(null)}>
                  Cancel
                </Button>
              </Surface>
            </Modal>
          </Portal>

          <Snackbar
            visible={snackbarVisible}
            onDismiss={() => setSnackbarVisible(false)}
            action={undoItem ? { label: "Undo", onPress: () => void handleUndoMute() } : undefined}
          >
            {snackbarMessage}
          </Snackbar>
          </LinearGradient>
        </SafeAreaView>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: themeTokens.palette.background },
  appGradient: { flex: 1 },
  header: {
    margin: themeTokens.spacing.md,
    marginBottom: themeTokens.spacing.sm,
    borderRadius: themeTokens.radii.card,
    overflow: "hidden",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: themeTokens.palette.heroMuted
  },
  headerGradient: {
    padding: themeTokens.spacing.lg,
    borderRadius: themeTokens.radii.card
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: themeTokens.spacing.sm, marginBottom: themeTokens.spacing.sm },
  headerCopy: { flex: 1 },
  segmentedButtons: {
    backgroundColor: "transparent"
  },
  title: { color: themeTokens.palette.heroText, fontWeight: "700", fontSize: 44, lineHeight: 48 },
  subtle: { color: "rgba(253, 251, 255, 0.92)", marginTop: themeTokens.spacing.xs },
  errorBanner: {
    marginHorizontal: themeTokens.spacing.md,
    marginBottom: themeTokens.spacing.sm,
    padding: themeTokens.spacing.sm,
    borderRadius: themeTokens.radii.card,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(167, 142, 226, 0.18)"
  },
  errorTitle: { color: themeTokens.palette.danger },
  errorText: { color: themeTokens.palette.textSecondary },
  screen: { flexGrow: 1, paddingHorizontal: themeTokens.spacing.md, paddingBottom: themeTokens.spacing.xl },
  toolbar: { flexDirection: "row", alignItems: "center", gap: themeTokens.spacing.sm, marginBottom: themeTokens.spacing.sm },
  searchbar: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: themeTokens.radii.card
  },
  listContent: { paddingBottom: themeTokens.spacing.xl },
  metric: { color: themeTokens.palette.primary, marginBottom: themeTokens.spacing.sm, fontWeight: "700" },
  emptyCard: {
    padding: themeTokens.spacing.lg,
    borderRadius: themeTokens.radii.card,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(167, 142, 226, 0.14)"
  },
  emptyTitle: { color: themeTokens.palette.textPrimary, fontWeight: "600" },
  emptyText: { color: themeTokens.palette.textSecondary, marginTop: themeTokens.spacing.xs },
  loading: { marginVertical: themeTokens.spacing.lg },
  spacer: { height: themeTokens.spacing.sm },
  card: {
    padding: themeTokens.spacing.md,
    borderRadius: themeTokens.radii.card,
    backgroundColor: "#FFFFFF",
    marginBottom: themeTokens.spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(167, 142, 226, 0.14)"
  },
  cardSelected: {
    backgroundColor: "#FBF8FF",
    borderWidth: 1,
    borderColor: themeTokens.palette.accent
  },
  cardTitle: { color: themeTokens.palette.textPrimary, fontWeight: "600" },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: themeTokens.spacing.sm, marginTop: themeTokens.spacing.sm },
  flexInput: { flex: 1 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: themeTokens.spacing.xs, marginTop: themeTokens.spacing.sm },
  alert: {
    marginTop: themeTokens.spacing.sm,
    padding: themeTokens.spacing.sm,
    borderRadius: themeTokens.radii.card,
    backgroundColor: "#F7F4FF",
    flexDirection: "row",
    alignItems: "center",
    gap: themeTokens.spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(167, 142, 226, 0.12)"
  },
  sectionTitle: { marginBottom: themeTokens.spacing.sm, color: themeTokens.palette.textPrimary, fontWeight: "600" },
  spacerWrap: { marginBottom: themeTokens.spacing.sm },
  modalWrap: { justifyContent: "flex-end", margin: 0 },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: themeTokens.spacing.lg,
    borderTopWidth: 1,
    borderColor: "rgba(167, 142, 226, 0.14)"
  },
  sheetButton: { marginTop: themeTokens.spacing.sm }
});
