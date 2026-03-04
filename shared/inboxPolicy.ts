export interface InboxPolicyMessage {
  category: string;
  subject: string;
  from: string;
  summary: string;
  actionSummary?: string | null;
  hasToolCallableAction: boolean;
}

export type InboxPolicyRule =
  | {
      id: string;
      effect: "deny";
      when: "missing_tool_action";
      reason: string;
    }
  | {
      id: string;
      effect: "deny";
      when: "category_match" | "text_match";
      values: string[];
      reason: string;
    };

export interface InboxPolicyEvaluation {
  allowed: boolean;
  matchedRules: InboxPolicyRule[];
  blockingRule: InboxPolicyRule | null;
}

export const INBOX_VISIBILITY_RULES: InboxPolicyRule[] = [
  {
    id: "require-tool-action",
    effect: "deny",
    when: "missing_tool_action",
    reason: "Messages without a supported tool-callable action do not belong in Assura."
  },
  {
    id: "mute-noisy-categories",
    effect: "deny",
    when: "category_match",
    values: [
      "promotion",
      "promotions",
      "promo",
      "marketing",
      "newsletter",
      "news",
      "social",
      "shopping",
      "job",
      "jobs",
      "career",
      "careers",
      "recruit",
      "hiring",
      "advert",
      "sale",
      "deal",
      "coupon",
      "spam"
    ],
    reason: "Known noisy categories are suppressed."
  },
  {
    id: "mute-noisy-copy",
    effect: "deny",
    when: "text_match",
    values: [
      "unsubscribe",
      "sale",
      "discount",
      "deal",
      "offer",
      "limited time",
      "save ",
      "coupon",
      "% off",
      "promo",
      "newsletter",
      "digest",
      "apply now",
      "job alert",
      "recommended jobs",
      "career opportunity",
      "hiring now",
      "open role",
      "open position",
      "shop now",
      "buy now"
    ],
    reason: "Known noise phrases are suppressed."
  }
];

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildSearchText(message: InboxPolicyMessage): string {
  return normalizeWhitespace(
    [message.subject, message.from, message.summary, message.actionSummary || ""].join(" ")
  );
}

function ruleMatches(rule: InboxPolicyRule, message: InboxPolicyMessage): boolean {
  if (rule.when === "missing_tool_action") {
    return !message.hasToolCallableAction;
  }

  if (rule.when === "category_match") {
    const category = normalizeWhitespace(message.category);
    return rule.values.some((value) => category.includes(normalizeWhitespace(value)));
  }

  const text = buildSearchText(message);
  return rule.values.some((value) => text.includes(normalizeWhitespace(value)));
}

export function evaluateInboxPolicy(message: InboxPolicyMessage): InboxPolicyEvaluation {
  const matchedRules = INBOX_VISIBILITY_RULES.filter((rule) => ruleMatches(rule, message));
  const blockingRule = matchedRules.find((rule) => rule.effect === "deny") || null;

  return {
    allowed: !blockingRule,
    matchedRules,
    blockingRule
  };
}

export function shouldAllowInboxMessage(message: InboxPolicyMessage): boolean {
  return evaluateInboxPolicy(message).allowed;
}
