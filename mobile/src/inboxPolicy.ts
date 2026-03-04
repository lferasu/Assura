export interface InboxPolicyMessage {
  category: string;
  subject: string;
  from: string;
  summary: string;
  actionSummary?: string | null;
  hasToolCallableAction: boolean;
}

type InboxPolicyRule =
  | {
      when: "missing_tool_action";
    }
  | {
      when: "category_match" | "text_match";
      values: string[];
    };

const INBOX_VISIBILITY_RULES: InboxPolicyRule[] = [
  {
    when: "missing_tool_action"
  },
  {
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
    ]
  },
  {
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
    ]
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

export function shouldAllowInboxMessage(message: InboxPolicyMessage): boolean {
  return !INBOX_VISIBILITY_RULES.some((rule) => ruleMatches(rule, message));
}
