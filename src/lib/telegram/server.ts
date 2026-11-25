import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramSender, type TgSend } from "./api.ts";
import type { Rpc } from "./bot.ts";
import { dispatchOutbox } from "./dispatch.ts";

/**
 * Server-side wiring for the parent bot. Secrets come only from server
 * environment variables (never NEXT_PUBLIC_):
 *   TELEGRAM_BOT_TOKEN        from BotFather
 *   TELEGRAM_WEBHOOK_SECRET   sent by Telegram in X-Telegram-Bot-Api-Secret-Token
 *   TELEGRAM_DISPATCH_SECRET  bearer token for /api/telegram/dispatch (pg_cron)
 *   TELEGRAM_BOT_USERNAME     the bot's @name, for t.me links (not secret)
 * The service-role client is used only to call the tg_* database functions,
 * which re-check the Telegram user on every read.
 */
export function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const admin = createAdminClient();
  if (!token || !admin) return null;
  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await admin.rpc(fn as never, args as never);
    return { data, error: error ? { message: error.message } : null };
  };
  const send: TgSend = telegramSender(token);
  return { rpc, send };
}

export function botUsername(): string | null {
  const name = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  return name && /^[A-Za-z0-9_]{5,32}$/.test(name) ? name : null;
}

/** Send what is queued now (after a staff action). Never throws: the cron run retries. */
export async function kickTelegramDispatch() {
  const cfg = telegramConfig();
  if (!cfg) return;
  try {
    await dispatchOutbox(cfg, { limit: 25, maxMs: 8_000 });
  } catch (e) {
    console.error("telegram dispatch failed", e instanceof Error ? e.message : "error");
  }
}
