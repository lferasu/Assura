import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

dotenv.config({ path: path.join(projectRoot, ".env") });

export function getTelegramConfigStatus(): { enabled: boolean; chatId?: string; message: string } {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      enabled: false,
      message: "Telegram delivery disabled. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in assistant/.env"
    };
  }

  return {
    enabled: true,
    chatId,
    message: `Telegram delivery enabled for chat ${chatId}`
  };
}
