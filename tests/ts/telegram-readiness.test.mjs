// Bot readiness (src/lib/telegram/readiness.ts). Run: npm run test:ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReadiness } from "../../src/lib/telegram/readiness.ts";
import { telegramApiBase } from "../../src/lib/telegram/api.ts";

const env = { token: "123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjj", username: "linguabc_bot", webhookSecret: "w".repeat(40), hasServiceKey: true };
const ok = { dbReady: async () => true, getMe: async () => "LinguABC_bot" };

test("ready only when everything holds", async () => {
  assert.deepEqual(await checkReadiness(env, ok), { ready: true, reason: "ready", username: "linguabc_bot" });
});

test("each missing piece gives its own reason, without calling the database or Telegram first", async () => {
  let calls = 0;
  const spy = { dbReady: async () => { calls++; return true; }, getMe: async () => { calls++; return "linguabc_bot"; } };
  for (const [patch, reason] of [[{ token: undefined }, "missing_token"], [{ token: "not-a-token" }, "missing_token"],
                                 [{ username: undefined }, "missing_username"], [{ username: "x" }, "missing_username"],
                                 [{ webhookSecret: "short" }, "missing_webhook_secret"], [{ hasServiceKey: false }, "missing_service_key"]]) {
    const r = await checkReadiness({ ...env, ...patch }, spy);
    assert.equal(r.reason, reason); assert.equal(r.ready, false); assert.equal(r.username, null);
  }
  assert.equal(calls, 0);
});

test("database functions missing (migrations not applied)", async () => {
  assert.equal((await checkReadiness(env, { ...ok, dbReady: async () => false })).reason, "db_not_ready");
  assert.equal((await checkReadiness(env, { ...ok, dbReady: async () => { throw new Error("x"); } })).reason, "db_not_ready");
});

test("Telegram rejects the token, or it belongs to another bot", async () => {
  assert.equal((await checkReadiness(env, { ...ok, getMe: async () => null })).reason, "bot_unreachable");
  assert.equal((await checkReadiness(env, { ...ok, getMe: async () => "someone_else_bot" })).reason, "username_mismatch");
});

test("the Telegram API host can only be overridden to localhost (local QA)", () => {
  assert.equal(telegramApiBase(undefined), "https://api.telegram.org");
  assert.equal(telegramApiBase("http://127.0.0.1:8081"), "http://127.0.0.1:8081");
  assert.equal(telegramApiBase("https://evil.example"), "https://api.telegram.org");
  assert.equal(telegramApiBase("http://localhost.evil.example:80"), "https://api.telegram.org");
});
