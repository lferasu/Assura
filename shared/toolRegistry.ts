export interface ToolCallableActionDefinition {
  toolName: string;
  label: string;
  icon: string;
  badgeColor: string;
  badgeTextColor: string;
  badgeBorderColor: string;
  parameterSchema: {
    required: string[];
    optional: string[];
  };
  aliases: string[];
}

export const TOOL_CALLABLE_ACTION_REGISTRY = {
  reply_email: {
    toolName: "gmail.reply",
    label: "Reply",
    icon: "reply-outline",
    badgeColor: "#EEF4FF",
    badgeTextColor: "#2A5CAA",
    badgeBorderColor: "#C9DBFF",
    parameterSchema: {
      required: ["threadId", "body"],
      optional: ["to", "cc", "bcc"]
    },
    aliases: ["reply", "reply email", "respond", "respond by", "send response"]
  },
  draft_email: {
    toolName: "gmail.draft",
    label: "Draft",
    icon: "file-document-edit-outline",
    badgeColor: "#EEF7FF",
    badgeTextColor: "#266C8F",
    badgeBorderColor: "#C8E5F8",
    parameterSchema: {
      required: ["subject", "body"],
      optional: ["to", "cc", "bcc"]
    },
    aliases: ["draft", "draft email", "compose draft", "write draft"]
  },
  create_task: {
    toolName: "tasks.create",
    label: "Create task",
    icon: "checkbox-marked-circle-outline",
    badgeColor: "#EEFCEF",
    badgeTextColor: "#2E7D45",
    badgeBorderColor: "#CBEFD4",
    parameterSchema: {
      required: ["title"],
      optional: ["dueDate", "notes"]
    },
    aliases: ["task", "todo", "to do", "create task", "add task"]
  },
  schedule_event: {
    toolName: "calendar.create_event",
    label: "Schedule",
    icon: "calendar-clock-outline",
    badgeColor: "#FFF5E8",
    badgeTextColor: "#B86A09",
    badgeBorderColor: "#FFDDB1",
    parameterSchema: {
      required: ["title", "startAt"],
      optional: ["endAt", "location", "attendees", "notes"]
    },
    aliases: [
      "calendar",
      "meeting",
      "appointment",
      "schedule",
      "scheduled",
      "rsvp",
      "interview"
    ]
  },
  set_reminder: {
    toolName: "reminders.create",
    label: "Reminder",
    icon: "bell-ring-outline",
    badgeColor: "#F7EEFF",
    badgeTextColor: "#7A3FB4",
    badgeBorderColor: "#E7D1FF",
    parameterSchema: {
      required: ["title", "remindAt"],
      optional: ["notes"]
    },
    aliases: ["remind", "reminder", "follow up", "followup", "deadline", "due date"]
  },
  update_contact: {
    toolName: "contacts.update",
    label: "Update contact",
    icon: "account-edit-outline",
    badgeColor: "#EEF9F8",
    badgeTextColor: "#21756B",
    badgeBorderColor: "#C8ECE7",
    parameterSchema: {
      required: ["contactRef", "changes"],
      optional: ["notes"]
    },
    aliases: ["update contact", "edit contact", "contact info", "address book"]
  },
  pay_bill: {
    toolName: "payments.schedule",
    label: "Pay bill",
    icon: "credit-card-clock-outline",
    badgeColor: "#FFF0F0",
    badgeTextColor: "#B14848",
    badgeBorderColor: "#FFD2D2",
    parameterSchema: {
      required: ["payee", "amount"],
      optional: ["dueDate", "accountRef", "memo"]
    },
    aliases: ["pay", "payment", "pay bill", "bill due", "payment due", "invoice due"]
  }
} as const satisfies Record<string, ToolCallableActionDefinition>;

export type ToolCallableActionKind = keyof typeof TOOL_CALLABLE_ACTION_REGISTRY;

export interface ToolCallableActionLike {
  kind: string;
  title: string;
  details?: string | null;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getToolCallableActionKinds(): ToolCallableActionKind[] {
  return Object.keys(TOOL_CALLABLE_ACTION_REGISTRY) as ToolCallableActionKind[];
}

export function normalizeToolCallableActionKind(value: string): ToolCallableActionKind | null {
  const normalized = normalizeWhitespace(value);
  return getToolCallableActionKinds().find((kind) => kind === normalized) || null;
}

export function inferToolCallableActionKind(
  action: ToolCallableActionLike
): ToolCallableActionKind | null {
  const explicitKind = normalizeToolCallableActionKind(action.kind);
  if (explicitKind) {
    return explicitKind;
  }

  const haystack = normalizeWhitespace([action.kind, action.title, action.details || ""].join(" "));

  return getToolCallableActionKinds().find((kind) => {
    const definition = TOOL_CALLABLE_ACTION_REGISTRY[kind];
    return definition.aliases.some((alias) => haystack.includes(normalizeWhitespace(alias)));
  }) || null;
}

export function getToolCallableActionLabel(kind: ToolCallableActionKind): string {
  return TOOL_CALLABLE_ACTION_REGISTRY[kind].label;
}

export function getToolCallableActionToolName(kind: ToolCallableActionKind): string {
  return TOOL_CALLABLE_ACTION_REGISTRY[kind].toolName;
}

export function getToolCallableActionDefinition(
  kind: ToolCallableActionKind
): ToolCallableActionDefinition {
  return TOOL_CALLABLE_ACTION_REGISTRY[kind];
}
