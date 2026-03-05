function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTelegramMessage({ message, summary, calendarProposals }) {
  const lines = [
    "✅ <b>Schedule impact detected</b>",
    `From: ${escapeHtml(message.from || "(unknown)")}`,
    `Subject: ${escapeHtml(message.subject || "(no subject)")}`,
    "",
    `<b>Summary</b>\n${escapeHtml(summary || "No summary")}`
  ];

  if (Array.isArray(calendarProposals) && calendarProposals.length > 0) {
    const proposals = calendarProposals
      .map((item) => `• ${escapeHtml(item.title)} (${escapeHtml(item.date)})`)
      .join("\n");
    lines.push("", `<b>Calendar proposals</b>\n${proposals}`);
  }

  return lines.join("\n");
}

function parseEnvChatIds() {
  const raw = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_IDS || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function fetchDiscoveredChatIds(token) {
  const url = `https://api.telegram.org/bot${token}/getUpdates`;
  const response = await fetch(url);
  if (!response.ok) return [];

  const payload = await response.json();
  if (!payload?.ok || !Array.isArray(payload.result)) return [];

  const chatIds = new Set();
  for (const update of payload.result) {
    const messageChat = update?.message?.chat?.id;
    const channelPostChat = update?.channel_post?.chat?.id;

    if (messageChat !== undefined && messageChat !== null) chatIds.add(String(messageChat));
    if (channelPostChat !== undefined && channelPostChat !== null) chatIds.add(String(channelPostChat));
  }

  return [...chatIds];
}

export async function resolveTelegramChatIds() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { tokenMissing: true, chatIds: [], source: "none" };

  const fromEnv = parseEnvChatIds();
  if (fromEnv.length > 0) {
    return { tokenMissing: false, chatIds: fromEnv, source: "env" };
  }

  const discovered = await fetchDiscoveredChatIds(token);
  return { tokenMissing: false, chatIds: discovered, source: "discovered" };
}

export async function notifyTelegramProcessed({ message, summary, calendarProposals }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { sent: false, reason: "telegram bot token not configured" };
  }

  const { chatIds } = await resolveTelegramChatIds();
  if (!chatIds.length) {
    return { sent: false, reason: "no target chats found (set TELEGRAM_CHAT_ID or message bot and retry)" };
  }

  const text = formatTelegramMessage({ message, summary, calendarProposals });
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  for (const chatId of chatIds) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`telegram send failed (${response.status}) for chat ${chatId}: ${body}`);
    }
  }

  return { sent: true, deliveredChats: chatIds.length };
}
