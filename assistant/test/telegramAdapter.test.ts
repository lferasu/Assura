import assert from "node:assert/strict";
import test from "node:test";
import {
  TelegramSourceAdapter,
  mapTelegramUpdateToNormalizedMessage
} from "../src/sources/telegramAdapter.js";

test("Telegram adapter maps update.message into a NormalizedMessage", () => {
  const message = mapTelegramUpdateToNormalizedMessage({
    update_id: 401,
    message: {
      message_id: 99,
      chat: { id: 777 },
      from: { id: 123, first_name: "Sura", last_name: "Mamo" },
      date: 1_772_589_200,
      text: "Need to reply to this."
    }
  });

  assert.ok(message);
  assert.equal(message?.source, "telegram");
  assert.equal(message?.accountId, "telegram:bot");
  assert.equal(message?.externalId, "99");
  assert.equal(message?.conversationId, "777");
  assert.equal(message?.senderId, "123");
  assert.equal(message?.senderName, "Sura Mamo");
  assert.equal(message?.subject, undefined);
  assert.equal(message?.bodyText, "Need to reply to this.");
  assert.equal(message?.receivedAt, new Date(1_772_589_200 * 1000).toISOString());
});

test("Telegram adapter advances cursor to the max processed update_id", async () => {
  let requestedUrl = "";
  const adapter = new TelegramSourceAdapter({
    botToken: "test-token",
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                message_id: 1,
                chat: { id: 50 },
                from: { id: 51, first_name: "A" },
                date: 1_772_589_200,
                text: "First"
              }
            },
            {
              update_id: 14,
              message: {
                message_id: 2,
                chat: { id: 50 },
                from: { id: 52, first_name: "B" },
                date: 1_772_589_260,
                caption: "Second"
              }
            }
          ]
        }),
        { status: 200 }
      );
    }
  });

  const result = await adapter.fetchNew({ lastUpdateId: 8 });
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.nextCursor, { lastUpdateId: 14 });
  assert.match(requestedUrl, /offset=9/);
});

test("Telegram adapter keeps cursor unchanged when there are no updates", async () => {
  const adapter = new TelegramSourceAdapter({
    botToken: "test-token",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          result: []
        }),
        { status: 200 }
      )
  });

  const result = await adapter.fetchNew({ lastUpdateId: 22 });
  assert.equal(result.messages.length, 0);
  assert.deepEqual(result.nextCursor, { lastUpdateId: 22 });
});

test("Telegram adapter ignores slash commands as source messages", () => {
  const message = mapTelegramUpdateToNormalizedMessage({
    update_id: 500,
    message: {
      message_id: 100,
      chat: { id: 777 },
      from: { id: 123, first_name: "Sura" },
      date: 1_772_589_200,
      text: "/start"
    }
  });

  assert.equal(message, null);
});
