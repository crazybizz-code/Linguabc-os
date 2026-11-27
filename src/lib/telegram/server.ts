import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { telegramApiBase, telegramSender, type TgSend } from "./api.ts";
import { checkReadiness, type Readiness } from "./readiness.ts";
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
  const send: TgSend = telegramSender(token, fetch, 10_000, telegramApiBase(process.env.TELEGRAM_API_BASE));
  return { rpc, send };
}

// Cached per server instance: a working bot for 5 minutes, a failure for 30 s.
let cached: { at: number; value: Readiness } | null = null;

/**
 * Can parents be linked right now? Checks configuration, the database
 * functions (0031/0032) and the token with Telegram (getMe). Returns only a
 * reason code and the public bot username; never a secret.
 */
export async function telegramReadiness(): Promise<Readiness> {
  if (cached && Date.now() - cached.at < (cached.value.ready ? 300_000 : 30_000)) return cached.value;
  const admin = createAdminClient();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const value = await checkReadiness(
    { token, username: process.env.TELEGRAM_BOT_USERNAME, webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET, hasServiceKey: admin !== null },
    {
      // Telegram user 0 never has a link: an empty list means the functions exist.
      dbReady: async () => { const { error } = await admin!.rpc("tg_children" as never, { p_tg_user: 0 } as never); return !error; },
      getMe: async () => {
        const r = await telegramSender(token!, fetch, 5_000, telegramApiBase(process.env.TELEGRAM_API_BASE))("getMe", {});
        const u = (r.result as { username?: string } | undefined)?.username;
        return r.ok && u ? u : null;
      },
    },
  );
  cached = { at: Date.now(), value };
  return value;
}

/** Send what is queued now (after a staff action). Never throws: the cron run retries. */
export async function kickTelegramDispatch() {
  const cfg = telegramConfig();
  if (!cfg) return;
  try {
    await dispatchOutbox(cfg, { limit: 25, maxMs: 8_000 });
  } catch {
    console.error("telegram dispatch failed");   // fixed text: error messages can carry data
  }
}
