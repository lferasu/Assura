import React, { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import {
  acknowledgeExpectationAlert,
  createExpectation,
  deleteExpectation,
  fetchExpectationAlerts,
  fetchExpectations,
  fetchInbox,
  removeInboxItem,
  searchInbox,
  updateInboxItem
} from "./src/api/client";
import type {
  ExpectationAlert,
  ImportanceLevel,
  MobileAssessment,
  MobileExpectation
} from "./src/types";

const IMPORTANCE_OPTIONS: Array<"all" | ImportanceLevel> = ["all", "low", "medium", "high", "critical"];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

type CategoryFilter = "all" | string;
type ImportanceFilter = "all" | ImportanceLevel;
type ScreenView = "inbox" | "attention";

function importanceRank(level: ImportanceLevel): number {
  if (level === "critical") return 0;
  if (level === "high") return 1;
  if (level === "medium") return 2;
  return 3;
}

function sortByPriority(items: MobileAssessment[]): MobileAssessment[] {
  return [...items].sort((left, right) => {
    const priorityGap = importanceRank(left.importance) - importanceRank(right.importance);
    if (priorityGap !== 0) return priorityGap;

    const leftTime = new Date(left.storedAt).getTime();
    const rightTime = new Date(right.storedAt).getTime();
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return left.subject.localeCompare(right.subject);
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

function FilterChip({
  label,
  selected,
  onPress
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipActive : styles.chipIdle]}
    >
      <Text style={[styles.chipLabel, selected ? styles.chipLabelActive : styles.chipLabelIdle]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ImportanceBadge({ level }: { level: ImportanceLevel }) {
  const tone =
    level === "critical"
      ? styles.badgeCritical
      : level === "high"
        ? styles.badgeHigh
        : level === "medium"
          ? styles.badgeMedium
          : styles.badgeLow;

  return (
    <View style={[styles.badge, tone]}>
      <Text style={styles.badgeText}>{level.toUpperCase()}</Text>
    </View>
  );
}

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function StatusActions({
  urgentCount,
  syncCount,
  syncing,
  urgentActive,
  onPressUrgent,
  onPressSync
}: {
  urgentCount: number;
  syncCount: number;
  syncing: boolean;
  urgentActive: boolean;
  onPressUrgent: () => void;
  onPressSync: () => void;
}) {
  return (
    <View style={styles.statusActions} accessibilityRole="toolbar">
      <Pressable
        onPress={onPressUrgent}
        accessibilityRole="button"
        accessibilityLabel="Urgent actions"
        hitSlop={8}
        style={[
          styles.statusActionButton,
          urgentActive ? styles.statusActionButtonActive : null
        ]}
      >
        <View
          style={[
            styles.statusActionIconWrap,
            urgentActive ? styles.statusActionIconWrapActive : null
          ]}
        >
          <Text
            style={[
              styles.statusActionGlyph,
              urgentActive ? styles.statusActionGlyphActive : null
            ]}
          >
            !
          </Text>
          {urgentCount > 0 ? (
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>{formatBadgeCount(urgentCount)}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        onPress={onPressSync}
        accessibilityRole="button"
        accessibilityLabel="Sync"
        disabled={syncing}
        hitSlop={8}
        style={[
          styles.statusActionButton,
          syncing ? styles.statusActionButtonDisabled : null
        ]}
      >
        <View
          style={[
            styles.statusActionIconWrap,
            syncing ? styles.statusActionIconWrapActive : null
          ]}
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#fff8ef" />
          ) : (
            <Text style={styles.statusActionGlyph}>↻</Text>
          )}
          {syncCount > 0 ? (
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>{formatBadgeCount(syncCount)}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

function priorityDotStyle(level: ImportanceLevel) {
  if (level === "critical") return styles.priorityDotCritical;
  if (level === "high") return styles.priorityDotHigh;
  if (level === "medium") return styles.priorityDotMedium;
  return styles.priorityDotLow;
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

function MessageCard({
  item,
  expanded,
  disabled,
  onToggleExpand,
  onToggleDone,
  onRemove,
  forceExpanded = false
}: {
  item: MobileAssessment;
  expanded: boolean;
  disabled: boolean;
  onToggleExpand: (item: MobileAssessment) => void;
  onToggleDone: (item: MobileAssessment) => void;
  onRemove: (item: MobileAssessment) => void;
  forceExpanded?: boolean;
}) {
  const visibleExpanded = forceExpanded || expanded;
  const actionCount = item.suggestedActions.length;
  const compactMeta = `${formatStoredAt(item.storedAt)}  |  ${item.from}`;

  return (
    <View style={[styles.card, item.done ? styles.cardDone : null, visibleExpanded ? styles.cardExpanded : null]}>
      <Pressable
        onPress={() => {
          if (!forceExpanded) onToggleExpand(item);
        }}
        style={styles.cardPressArea}
      >
        <View style={styles.cardGrid}>
          <View style={styles.leftRail}>
            <View style={[styles.priorityDot, priorityDotStyle(item.importance)]} />
            <Text style={styles.categoryPill}>{item.category}</Text>
          </View>

          <View style={styles.cardMain}>
            <View style={styles.cardTopLine}>
              <Text style={[styles.cardTitle, item.done ? styles.cardTitleDone : null]} numberOfLines={1}>
                {item.subject}
              </Text>
              <ImportanceBadge level={item.importance} />
            </View>

            <Text style={styles.compactMeta} numberOfLines={1}>
              {compactMeta}
            </Text>

            <Text style={styles.compactSummary} numberOfLines={visibleExpanded ? 3 : 2}>
              {item.summary}
            </Text>

            <View style={styles.signalRow}>
              <Text style={[styles.signalTag, item.needsAction ? styles.signalAction : styles.signalInfo]}>
                {item.needsAction ? "Action" : "Info"}
              </Text>
              {actionCount > 0 ? (
                <Text style={styles.signalText}>{actionCount} suggested {actionCount === 1 ? "step" : "steps"}</Text>
              ) : (
                <Text style={styles.signalText}>No action items</Text>
              )}
              {item.keyDates.length > 0 ? (
                <Text style={styles.signalText}>{item.keyDates.length} key date{item.keyDates.length === 1 ? "" : "s"}</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.expandRail}>
            <Text style={styles.expandGlyph}>{expanded ? "−" : "+"}</Text>
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <View style={styles.expandedPanel}>
          {item.actionSummary ? (
            <View style={styles.inlineCallout}>
              <Text style={styles.inlineCalloutLabel}>Next best move</Text>
              <Text style={styles.inlineCalloutText}>{item.actionSummary}</Text>
            </View>
          ) : null}

          {item.suggestedActions.length > 0 ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Suggested Actions</Text>
              {item.suggestedActions.map((action) => (
                <View key={action.id} style={styles.detailRow}>
                  <Text style={styles.detailBullet}>•</Text>
                  <View style={styles.detailBody}>
                    <Text style={styles.detailTitle}>{action.title}</Text>
                    <Text style={styles.detailMeta}>
                      {action.kind}
                      {action.dueDate ? ` | due ${action.dueDate}` : ""}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {item.keyDates.length > 0 ? (
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Key Dates</Text>
              <View style={styles.dateStrip}>
                {item.keyDates.map((date) => (
                  <View key={`${date.label}-${date.date}`} style={styles.dateTag}>
                    <Text style={styles.dateTagLabel}>{date.label}</Text>
                    <Text style={styles.dateTagValue}>{date.date}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              onPress={() => onToggleDone(item)}
              disabled={disabled}
              style={[
                styles.actionButton,
                item.done ? styles.actionButtonDone : styles.actionButtonPrimary,
                disabled ? styles.actionButtonDisabled : null
              ]}
            >
              <Text style={styles.actionButtonLabel}>{item.done ? "Mark Active" : "Mark Done"}</Text>
            </Pressable>
            <Pressable
              onPress={() => onRemove(item)}
              disabled={disabled}
              style={[
                styles.actionButton,
                styles.actionButtonDanger,
                disabled ? styles.actionButtonDisabled : null
              ]}
            >
              <Text style={styles.actionButtonLabel}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenView>("inbox");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [importanceFilter, setImportanceFilter] = useState<ImportanceFilter>("all");
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
  const [items, setItems] = useState<MobileAssessment[]>([]);
  const [expectations, setExpectations] = useState<MobileExpectation[]>([]);
  const [alerts, setAlerts] = useState<ExpectationAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [expectationQuery, setExpectationQuery] = useState("");
  const [expectationBusy, setExpectationBusy] = useState(false);
  const notifiedAlertIdsRef = useRef<string[]>([]);

  const deferredCategory = useDeferredValue(categoryFilter);
  const deferredImportance = useDeferredValue(importanceFilter);
  const deferredNeedsAction = useDeferredValue(needsActionOnly);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (
      Platform.OS === "android" &&
      typeof UIManager.setLayoutAnimationEnabledExperimental === "function"
    ) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  async function notifyExpectedEmail(item: ExpectationAlert): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Expected email arrived",
        body: `${item.query}\n${item.message.subject}`
      },
      trigger: null
    });
  }

  const filteredItems = sortByPriority(
    items.filter((item) => {
      if (deferredCategory !== "all" && item.category !== deferredCategory) return false;
      if (deferredImportance !== "all" && item.importance !== deferredImportance) return false;
      if (deferredNeedsAction && !item.needsAction) return false;
      return true;
    })
  );
  const expectedAlertCount = alerts.length;
  const urgentItems = sortByPriority(items.filter(
    (item) =>
      !item.done &&
      item.needsAction &&
      (item.importance === "critical" || item.importance === "high")
  ));
  const urgentActionCount = urgentItems.length;
  const syncCount = items.length;

  const categoryOptions = [
    "all",
    ...Array.from(new Set(items.map((item) => item.category))).sort((left, right) =>
      left.localeCompare(right)
    )
  ];

  async function loadItems(mode: "initial" | "manual" | "background" = "initial"): Promise<void> {
    if (mode === "manual") {
      setRefreshing(true);
    } else if (mode === "initial") {
      setLoading(true);
    }

    try {
      const trimmedQuery = deferredSearchQuery.trim();
      const [nextItems, nextExpectations, nextAlerts] = await Promise.all([
        trimmedQuery ? searchInbox(trimmedQuery, 60) : fetchInbox(60),
        fetchExpectations(),
        fetchExpectationAlerts()
      ]);
      const nextSortedItems = sortByPriority(nextItems);

      if (mode !== "initial") {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }

      startTransition(() => {
        setItems((current) => mergeInboxItems(current, nextSortedItems));
        setExpectations(nextExpectations);
        setAlerts(nextAlerts);
        setExpandedIds((current) =>
          current.filter((id) => nextSortedItems.some((item) => item.id === id))
        );
        setError(null);
      });

      const unseenAlerts = nextAlerts.filter(
        (item) => !notifiedAlertIdsRef.current.includes(item.id)
      );

      for (const item of unseenAlerts) {
        void notifyExpectedEmail(item);
      }

      notifiedAlertIdsRef.current = nextAlerts.map((item) => item.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (mode === "initial") {
        setLoading(false);
      }

      if (mode === "manual") {
        setRefreshing(false);
      }
    }
  }

  function toggleExpanded(item: MobileAssessment): void {
    setExpandedIds((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]
    );
  }

  function markPending(id: string): void {
    setPendingIds((current) => (current.includes(id) ? current : [...current, id]));
  }

  function clearPending(id: string): void {
    setPendingIds((current) => current.filter((value) => value !== id));
  }

  async function handleToggleDone(item: MobileAssessment): Promise<void> {
    markPending(item.id);

    try {
      await updateInboxItem(item.id, { done: !item.done });
      startTransition(() => {
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, done: !entry.done } : entry
          )
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
        setExpectations((current) =>
          current.map((entry) =>
            entry.id === item.expectationId
              ? {
                  ...entry,
                  lastAcknowledgedMessageId: item.matchedMessageId,
                  lastAcknowledgedAt: item.matchedAt
                }
              : entry
          )
        );
      });
      notifiedAlertIdsRef.current = notifiedAlertIdsRef.current.filter((id) => id !== item.id);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setExpectationBusy(false);
    }
  }

  useEffect(() => {
    void Notifications.requestPermissionsAsync();
  }, []);

  useEffect(() => {
    void loadItems("initial");

    const intervalId = setInterval(() => {
      void loadItems("background");
    }, 15000);

    return () => {
      clearInterval(intervalId);
    };
  }, [deferredSearchQuery]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadItems("manual")}
            tintColor="#1d5f57"
          />
        }
      >
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroLeft}>
              <Text style={styles.eyebrow}>
                {currentScreen === "inbox" ? "Information Inbox" : "Attention Center"}
              </Text>
              <Text style={styles.heroTitle}>
                {currentScreen === "inbox"
                  ? "Scan quickly. Open only what matters."
                  : "Resolve urgent items with full focus."}
              </Text>
              <Text style={styles.heroSubtle}>
                {currentScreen === "inbox"
                  ? "This page is optimized for information density and fast scanning."
                  : "Expected matches and urgent tasks are isolated here so you can act without inbox noise."}
              </Text>
            </View>
            <View style={styles.heroRight}>
              <StatusActions
                urgentCount={urgentActionCount}
                syncCount={syncCount}
                syncing={refreshing}
                urgentActive={currentScreen === "attention"}
                onPressUrgent={() => setCurrentScreen("attention")}
                onPressSync={() => void loadItems("manual")}
              />
            </View>
          </View>

          <View style={styles.viewSwitcher}>
            <Pressable
              onPress={() => setCurrentScreen("inbox")}
              style={[styles.viewTab, currentScreen === "inbox" ? styles.viewTabActive : null]}
            >
              <Text style={[styles.viewTabLabel, currentScreen === "inbox" ? styles.viewTabLabelActive : null]}>
                Inbox
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setCurrentScreen("attention")}
              style={[styles.viewTab, currentScreen === "attention" ? styles.viewTabActive : null]}
            >
              <Text style={[styles.viewTabLabel, currentScreen === "attention" ? styles.viewTabLabelActive : null]}>
                Attention
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.filtersShell}>
          {currentScreen === "attention" ? (
          <View style={styles.watchShell}>
            <Text style={styles.watchTitle}>Watch For Expected Emails</Text>
            <View style={styles.watchComposer}>
              <TextInput
                value={expectationQuery}
                onChangeText={setExpectationQuery}
                placeholder="e.g. HOA dues notice or school closure"
                placeholderTextColor="#7f8a88"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.watchInput}
              />
              <Pressable
                onPress={() => void handleCreateExpectation()}
                disabled={expectationBusy}
                style={[styles.watchButton, expectationBusy ? styles.actionButtonDisabled : null]}
              >
                <Text style={styles.watchButtonLabel}>Watch</Text>
              </Pressable>
            </View>

            {expectations.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.watchRow}>
                {expectations.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => void handleDeleteExpectation(item)}
                    style={styles.watchChip}
                  >
                    <Text style={styles.watchChipText}>{item.query}</Text>
                    <Text style={styles.watchChipClose}>×</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.watchHint}>No active watches yet.</Text>
            )}

            {alerts.length > 0 ? (
              <View style={styles.alertStack}>
                {alerts.map((item) => (
                  <View key={item.id} style={styles.alertCard}>
                    <View style={styles.alertBody}>
                      <Text style={styles.alertTitle}>Matched: {item.query}</Text>
                      <Text style={styles.alertText} numberOfLines={2}>
                        {item.message.subject}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => void handleAcknowledgeAlert(item)}
                      disabled={expectationBusy}
                      style={[styles.alertButton, expectationBusy ? styles.actionButtonDisabled : null]}
                    >
                      <Text style={styles.alertButtonLabel}>Seen</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          ) : null}

          {currentScreen === "inbox" ? (
          <>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search relevant emails"
            placeholderTextColor="#7f8a88"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {categoryOptions.map((category) => (
              <FilterChip
                key={category}
                label={category}
                selected={categoryFilter === category}
                onPress={() => setCategoryFilter(category)}
              />
            ))}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowTight}>
            {IMPORTANCE_OPTIONS.map((level) => (
              <FilterChip
                key={level}
                label={level}
                selected={importanceFilter === level}
                onPress={() => setImportanceFilter(level)}
              />
            ))}
            <FilterChip
              label={needsActionOnly ? "action only" : "all items"}
              selected={needsActionOnly}
              onPress={() => setNeedsActionOnly((current) => !current)}
            />
          </ScrollView>
          </>
          ) : null}
        </View>

        {currentScreen === "attention" ? (
          <>
            <View style={styles.focusSection}>
              <View style={styles.focusHeader}>
                <Text style={styles.focusTitle}>Urgent Action Queue</Text>
                <Text style={styles.focusMeta}>{urgentActionCount} pending</Text>
              </View>

              {urgentItems.length === 0 ? (
                <View style={styles.focusEmptyCard}>
                  <Text style={styles.focusEmptyTitle}>No urgent actions right now.</Text>
                  <Text style={styles.focusEmptyText}>High-priority actionable messages will collect here automatically.</Text>
                </View>
              ) : (
                <View style={styles.listStack}>
                  {urgentItems.map((item) => (
                    <MessageCard
                      key={item.id}
                      item={item}
                      expanded={true}
                      forceExpanded={true}
                      disabled={pendingIds.includes(item.id)}
                      onToggleExpand={toggleExpanded}
                      onToggleDone={(entry) => void handleToggleDone(entry)}
                      onRemove={(entry) => void handleRemove(entry)}
                    />
                  ))}
                </View>
              )}
            </View>
          </>
        ) : null}

        {currentScreen === "inbox" ? (
        <>
        <View style={styles.resultsBar}>
          <Text style={styles.resultsTitle}>Live Inbox</Text>
          <Text style={styles.resultsMeta}>
            {filteredItems.length} shown • {expandedIds.length} expanded
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerLabel}>API Error</Text>
            <Text style={styles.errorBannerText}>{error}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loadingShell}>
            <ActivityIndicator size="large" color="#1d5f57" />
            <Text style={styles.loadingLabel}>Pulling the latest summaries...</Text>
          </View>
        ) : null}

        <View style={styles.listStack}>
          {!loading && filteredItems.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>Nothing matches this view</Text>
              <Text style={styles.emptyStateText}>
                Widen your filters or clear search to bring more messages back into scope.
              </Text>
            </View>
          ) : (
            filteredItems.map((item) => (
              <MessageCard
                key={item.id}
                item={item}
                expanded={expandedIds.includes(item.id)}
                disabled={pendingIds.includes(item.id)}
                onToggleExpand={toggleExpanded}
                onToggleDone={(entry) => void handleToggleDone(entry)}
                onRemove={(entry) => void handleRemove(entry)}
              />
            ))
          )}
        </View>
        </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#dfe5dc"
  },
  screen: {
    flex: 1
  },
  content: {
    paddingHorizontal: 14,
    paddingBottom: 36
  },
  hero: {
    marginTop: 10,
    marginBottom: 12,
    borderRadius: 26,
    padding: 16,
    backgroundColor: "#102d2a",
    gap: 14
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14
  },
  heroLeft: {
    flex: 1
  },
  heroRight: {
    alignItems: "flex-end",
    justifyContent: "flex-start"
  },
  eyebrow: {
    color: "#9bc9bf",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6
  },
  heroTitle: {
    color: "#f6f8f1",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
    marginBottom: 6
  },
  heroSubtle: {
    color: "#bad4ce",
    fontSize: 13,
    lineHeight: 18
  },
  statusActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#183733",
    borderWidth: 1,
    borderColor: "#2a534d"
  },
  statusActionButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999
  },
  statusActionButtonActive: {
    backgroundColor: "#8a4e3d"
  },
  statusActionButtonDisabled: {
    opacity: 0.7
  },
  statusActionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#224640",
    position: "relative"
  },
  statusActionIconWrapActive: {
    backgroundColor: "#8a4e3d"
  },
  statusActionGlyph: {
    color: "#d7e9e4",
    fontSize: 21,
    lineHeight: 21,
    fontWeight: "900"
  },
  statusActionGlyphActive: {
    color: "#fff8ef"
  },
  statusBadge: {
    position: "absolute",
    top: -2,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#d36e53",
    borderWidth: 1,
    borderColor: "#102d2a"
  },
  statusBadgeText: {
    color: "#fffaf2",
    fontSize: 9,
    lineHeight: 10,
    fontWeight: "900"
  },
  viewSwitcher: {
    backgroundColor: "#183733",
    borderRadius: 16,
    padding: 4,
    flexDirection: "row",
    gap: 6
  },
  viewTab: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center"
  },
  viewTabActive: {
    backgroundColor: "#f7f5ee"
  },
  viewTabLabel: {
    color: "#9fc1ba",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  viewTabLabelActive: {
    color: "#183531"
  },
  notificationCluster: {
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1
  },
  notificationClusterIdle: {
    backgroundColor: "#163834",
    borderColor: "#29524b"
  },
  notificationClusterHot: {
    backgroundColor: "#3a2118",
    borderColor: "#8f5a42"
  },
  notificationIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#f6b35c",
    alignItems: "center",
    justifyContent: "center"
  },
  notificationIconLabel: {
    color: "#1d251f",
    fontSize: 14,
    fontWeight: "900"
  },
  notificationTextWrap: {
    flex: 1
  },
  notificationLabel: {
    color: "#f6f8f1",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  notificationMeta: {
    color: "#c2d5cf",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "700"
  },
  notificationBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  notificationBadgeIdle: {
    backgroundColor: "#27443f"
  },
  notificationBadgeHot: {
    backgroundColor: "#d36e53"
  },
  notificationBadgeText: {
    color: "#f8faf5",
    fontSize: 11,
    fontWeight: "900"
  },
  filtersShell: {
    backgroundColor: "#f7f5ee",
    borderRadius: 22,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#d7d9ce"
  },
  watchShell: {
    backgroundColor: "#e9efe6",
    borderRadius: 18,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#d2ddd6"
  },
  watchTitle: {
    color: "#223b36",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8
  },
  watchComposer: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8
  },
  watchInput: {
    flex: 1,
    backgroundColor: "#fbfcf8",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#1b302c",
    fontSize: 13
  },
  watchButton: {
    backgroundColor: "#1d5f57",
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: "center"
  },
  watchButtonLabel: {
    color: "#f8faf5",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4
  },
  watchRow: {
    flexDirection: "row",
    gap: 8
  },
  watchChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#173a35",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  watchChipText: {
    color: "#e8f5f0",
    fontSize: 11,
    fontWeight: "800"
  },
  watchChipClose: {
    color: "#9bd0c3",
    fontSize: 14,
    lineHeight: 14,
    fontWeight: "700"
  },
  watchHint: {
    color: "#5b6a66",
    fontSize: 12,
    fontWeight: "600"
  },
  alertStack: {
    marginTop: 8,
    gap: 6
  },
  alertCard: {
    backgroundColor: "#fff7e7",
    borderRadius: 14,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  alertBody: {
    flex: 1
  },
  alertTitle: {
    color: "#6f4518",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 3
  },
  alertText: {
    color: "#4c3820",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700"
  },
  alertSubtle: {
    color: "#776552",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2
  },
  alertButton: {
    backgroundColor: "#f0b35b",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  alertButtonLabel: {
    color: "#2d2b22",
    fontSize: 11,
    fontWeight: "900"
  },
  searchInput: {
    backgroundColor: "#e6eadf",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: "#1b302c",
    fontSize: 14,
    marginBottom: 10
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8
  },
  chipRowTight: {
    flexDirection: "row",
    gap: 8
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1
  },
  chipIdle: {
    backgroundColor: "#edf0e7",
    borderColor: "#d8ddcf"
  },
  chipActive: {
    backgroundColor: "#1d5f57",
    borderColor: "#1d5f57"
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "lowercase"
  },
  chipLabelIdle: {
    color: "#4c5d59"
  },
  chipLabelActive: {
    color: "#f8faf5"
  },
  focusSection: {
    marginBottom: 12,
    backgroundColor: "#eef2e9",
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: "#d6ddd2"
  },
  focusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  },
  focusTitle: {
    color: "#213631",
    fontSize: 18,
    fontWeight: "800"
  },
  focusMeta: {
    color: "#143330",
    fontSize: 11,
    fontWeight: "900",
    backgroundColor: "#d9e8e1",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  focusEmptyCard: {
    backgroundColor: "#f7f5ee",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#dde1d7"
  },
  focusEmptyTitle: {
    color: "#243632",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4
  },
  focusEmptyText: {
    color: "#61706d",
    fontSize: 13,
    lineHeight: 18
  },
  resultsBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  },
  resultsTitle: {
    color: "#1c302c",
    fontSize: 20,
    fontWeight: "800"
  },
  resultsMeta: {
    color: "#5e6b69",
    fontSize: 12,
    fontWeight: "700"
  },
  errorBanner: {
    backgroundColor: "#f6d5c5",
    borderRadius: 18,
    padding: 12,
    marginBottom: 10
  },
  errorBannerLabel: {
    color: "#7f2b12",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4
  },
  errorBannerText: {
    color: "#60291b",
    fontSize: 13,
    lineHeight: 18
  },
  loadingShell: {
    backgroundColor: "#f7f5ee",
    borderRadius: 20,
    padding: 18,
    alignItems: "center",
    marginBottom: 10
  },
  loadingLabel: {
    color: "#4a5b56",
    marginTop: 10,
    fontSize: 13,
    fontWeight: "700"
  },
  listStack: {
    gap: 8
  },
  card: {
    backgroundColor: "#fbfcf8",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#d7ddd1",
    overflow: "hidden"
  },
  cardExpanded: {
    borderColor: "#aac7bc",
    backgroundColor: "#ffffff"
  },
  cardDone: {
    opacity: 0.82
  },
  cardPressArea: {
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  cardGrid: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10
  },
  leftRail: {
    width: 56,
    alignItems: "flex-start"
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginBottom: 8
  },
  priorityDotLow: {
    backgroundColor: "#7ab76d"
  },
  priorityDotMedium: {
    backgroundColor: "#d7a33f"
  },
  priorityDotHigh: {
    backgroundColor: "#d37d33"
  },
  priorityDotCritical: {
    backgroundColor: "#b93f27"
  },
  categoryPill: {
    color: "#8b4d35",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  cardMain: {
    flex: 1
  },
  cardTopLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4
  },
  cardTitle: {
    flex: 1,
    color: "#182a27",
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "800"
  },
  cardTitleDone: {
    textDecorationLine: "line-through",
    color: "#60706d"
  },
  compactMeta: {
    color: "#63726f",
    fontSize: 11,
    marginBottom: 5
  },
  compactSummary: {
    color: "#344542",
    fontSize: 12,
    lineHeight: 17
  },
  signalRow: {
    marginTop: 7,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center"
  },
  signalTag: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  signalAction: {
    backgroundColor: "#f6d4b3",
    color: "#6d401a"
  },
  signalInfo: {
    backgroundColor: "#dfe9e4",
    color: "#31514a"
  },
  signalText: {
    color: "#647572",
    fontSize: 11,
    fontWeight: "700"
  },
  expandRail: {
    width: 22,
    alignItems: "center",
    paddingTop: 2
  },
  expandGlyph: {
    color: "#23433d",
    fontSize: 20,
    lineHeight: 20,
    fontWeight: "500"
  },
  expandedPanel: {
    borderTopWidth: 1,
    borderTopColor: "#e4e8de",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#f7faf4"
  },
  inlineCallout: {
    backgroundColor: "#e8efe5",
    borderRadius: 14,
    padding: 10,
    marginBottom: 10
  },
  inlineCalloutLabel: {
    color: "#4d5c58",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4
  },
  inlineCalloutText: {
    color: "#203633",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600"
  },
  detailSection: {
    marginBottom: 10
  },
  detailLabel: {
    color: "#51625e",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 6
  },
  detailBullet: {
    color: "#1d5f57",
    fontSize: 15,
    lineHeight: 18,
    marginRight: 8
  },
  detailBody: {
    flex: 1
  },
  detailTitle: {
    color: "#203431",
    fontSize: 13,
    fontWeight: "700"
  },
  detailMeta: {
    color: "#677774",
    fontSize: 11,
    marginTop: 1
  },
  dateStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  dateTag: {
    backgroundColor: "#123733",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  dateTagLabel: {
    color: "#a9d0c3",
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 2
  },
  dateTagValue: {
    color: "#f7faf5",
    fontSize: 11,
    fontWeight: "800"
  },
  actionRow: {
    flexDirection: "row",
    gap: 8
  },
  actionButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: "center"
  },
  actionButtonPrimary: {
    backgroundColor: "#1d5f57"
  },
  actionButtonDone: {
    backgroundColor: "#7d6858"
  },
  actionButtonDanger: {
    backgroundColor: "#9f4b30"
  },
  actionButtonDisabled: {
    opacity: 0.6
  },
  actionButtonLabel: {
    color: "#f8faf5",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12
  },
  badgeLow: {
    backgroundColor: "#d8ead2"
  },
  badgeMedium: {
    backgroundColor: "#f0dfb2"
  },
  badgeHigh: {
    backgroundColor: "#efc08a"
  },
  badgeCritical: {
    backgroundColor: "#d36e53"
  },
  badgeText: {
    color: "#202c2a",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7
  },
  emptyState: {
    backgroundColor: "#f7f5ee",
    borderRadius: 20,
    padding: 20,
    alignItems: "center"
  },
  emptyStateTitle: {
    color: "#233834",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6
  },
  emptyStateText: {
    color: "#61706d",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center"
  }
});
