import { API_BASE_URL, APP_USER_ID, SUPPRESSION_API_BASE_URL } from "../config";
import type {
  ExpectationAlert,
  MobileAssessment,
  MobileExpectation,
  MobileSuppressionRule
} from "../types";

interface InboxResponse {
  items: MobileAssessment[];
}

interface ExpectationListResponse {
  items: MobileExpectation[];
}

interface ExpectationResponse {
  item: MobileExpectation;
}

interface AlertListResponse {
  items: ExpectationAlert[];
}

interface RuleListResponse {
  items: MobileSuppressionRule[];
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallback = `Request failed with status ${response.status}`;

    try {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || fallback);
    } catch {
      throw new Error(fallback);
    }
  }

  return (await response.json()) as T;
}

export async function fetchInbox(limit = 50): Promise<MobileAssessment[]> {
  const response = await fetch(`${API_BASE_URL}/api/messages?limit=${limit}`);
  const payload = await readJson<InboxResponse>(response);
  return payload.items;
}

export async function searchInbox(query: string, limit = 50): Promise<MobileAssessment[]> {
  const searchParams = new URLSearchParams({
    limit: String(limit),
    q: query
  });
  const response = await fetch(`${API_BASE_URL}/api/messages?${searchParams.toString()}`);
  const payload = await readJson<InboxResponse>(response);
  return payload.items;
}

export async function updateInboxItem(
  id: string,
  updates: { done?: boolean; removed?: boolean }
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(updates)
  });

  await readJson<{ ok: true }>(response);
}

export async function removeInboxItem(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/messages/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  await readJson<{ ok: true }>(response);
}

export async function fetchExpectations(): Promise<MobileExpectation[]> {
  const response = await fetch(`${API_BASE_URL}/api/expectations`);
  const payload = await readJson<ExpectationListResponse>(response);
  return payload.items;
}

export async function createExpectation(query: string): Promise<MobileExpectation> {
  const response = await fetch(`${API_BASE_URL}/api/expectations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  const payload = await readJson<ExpectationResponse>(response);
  return payload.item;
}

export async function deleteExpectation(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/expectations/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  await readJson<{ ok: true }>(response);
}

export async function fetchExpectationAlerts(): Promise<ExpectationAlert[]> {
  const response = await fetch(`${API_BASE_URL}/api/expectations/alerts`);
  const payload = await readJson<AlertListResponse>(response);
  return payload.items;
}

export async function acknowledgeExpectationAlert(
  expectationId: string,
  messageId: string,
  matchedAt: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/expectations/${encodeURIComponent(expectationId)}/acknowledge`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messageId, matchedAt })
    }
  );

  await readJson<{ ok: true }>(response);
}

export async function sendNotInterestedFeedback(
  item: MobileAssessment,
  mode: "SENDER_ONLY" | "SENDER_AND_CONTEXT"
): Promise<{ ok: true; ruleId: string }> {
  const bodyText = [
    item.actionSummary || "",
    ...item.suggestedActions.map((action) => action.title)
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(`${SUPPRESSION_API_BASE_URL}/api/feedback/not-interested`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userId: APP_USER_ID,
      messageId: item.id,
      mode,
      senderEmail: item.from,
      subject: item.subject,
      snippet: item.summary,
      bodyText
    })
  });

  return readJson<{ ok: true; ruleId: string }>(response);
}

export async function fetchSuppressionRules(query = ""): Promise<MobileSuppressionRule[]> {
  const searchParams = new URLSearchParams({
    userId: APP_USER_ID,
    includeInactive: "true"
  });
  if (query.trim()) {
    searchParams.set("q", query.trim());
  }

  const response = await fetch(`${SUPPRESSION_API_BASE_URL}/api/rules?${searchParams.toString()}`);
  const payload = await readJson<RuleListResponse>(response);
  return payload.items;
}

export async function updateSuppressionRule(
  id: string,
  updates: { isActive?: boolean; threshold?: number }
): Promise<MobileSuppressionRule> {
  const response = await fetch(`${SUPPRESSION_API_BASE_URL}/api/rules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userId: APP_USER_ID,
      ...updates
    })
  });

  const payload = await readJson<{ ok: true; item: MobileSuppressionRule }>(response);
  return payload.item;
}

export async function deleteSuppressionRule(id: string): Promise<void> {
  const searchParams = new URLSearchParams({
    userId: APP_USER_ID
  });
  const response = await fetch(
    `${SUPPRESSION_API_BASE_URL}/api/rules/${encodeURIComponent(id)}?${searchParams.toString()}`,
    {
      method: "DELETE"
    }
  );

  await readJson<{ ok: true }>(response);
}

export async function applySuppressionRulePrompt(
  prompt: string,
  targetRuleId?: string
): Promise<{
  operation: "created" | "updated" | "deleted";
  item: MobileSuppressionRule | null;
  message: string;
}> {
  const response = await fetch(`${SUPPRESSION_API_BASE_URL}/api/rules`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userId: APP_USER_ID,
      prompt,
      targetRuleId
    })
  });

  return readJson<{
    ok: true;
    operation: "created" | "updated" | "deleted";
    item: MobileSuppressionRule | null;
    message: string;
  }>(response);
}
