export type TelegramProcessedPayload = {
  message: { from?: string; subject?: string };
  summary: string;
  calendarProposals?: Array<{ title?: string; date?: string }>;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTelegramMessage(payload: TelegramProcessedPayload): string {
  const lines = [
    "✅ <b>Schedule impact detected</b>",
    `From: ${escapeHtml(payload.message.from || "(unknown)")}`,
    `Subject: ${escapeHtml(payload.message.subject || "(no subject)")}`,
    "",
    `<b>Summary</b>\n${escapeHtml(payload.summary || "No summary")}`
  ];

  if (payload.calendarProposals?.length) {
    const proposals = payload.calendarProposals
      .map((item) => `• ${escapeHtml(item.title || "(untitled)")} (${escapeHtml(item.date || "unknown date")})`)
      .join("\n");
    lines.push("", `<b>Calendar proposals</b>\n${proposals}`);
  }

  return lines.join("\n");
}

export async function notifyTelegramProcessed(payload: TelegramProcessedPayload): Promise<{ sent: boolean; reason?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return { sent: false, reason: "missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" };
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: formatTelegramMessage(payload),
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    throw new Error(`telegram send failed (${response.status}): ${await response.text()}`);
  }

  return { sent: true };
}
