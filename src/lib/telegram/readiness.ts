// Is the parent bot able to work right now? Pure (tests/ts/telegram-readiness.test.mjs).
//
// Linking is offered only when ALL of these hold, checked on the server:
//   token, username, webhook secret, service-role key are configured;
//   the database has the bot functions (migrations 0031/0032);
//   Telegram accepts the token (getMe) and it belongs to that username.
// Only a reason code reaches the browser, never a secret.

export type ReadinessReason =
  | "ready" | "missing_token" | "missing_username" | "missing_webhook_secret" | "missing_service_key"
  | "db_not_ready" | "bot_unreachable" | "username_mismatch";
export type Readiness = { ready: boolean; reason: ReadinessReason; username: string | null };

export type ReadinessEnv = { token?: string; username?: string; webhookSecret?: string; hasServiceKey: boolean };
export type ReadinessDeps = {
  /** true when the bot's database functions exist and answer */
  dbReady: () => Promise<boolean>;
  /** Telegram getMe with the configured token: the bot's username, or null on any failure */
  getMe: () => Promise<string | null>;
};

const USERNAME = /^[A-Za-z0-9_]{5,32}$/;

export async function checkReadiness(env: ReadinessEnv, deps: ReadinessDeps): Promise<Readiness> {
  const username = env.username?.replace(/^@/, "") ?? "";
  const no = (reason: ReadinessReason): Readiness => ({ ready: false, reason, username: null });
  if (!env.token || !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(env.token)) return no("missing_token");
  if (!USERNAME.test(username)) return no("missing_username");
  if (!env.webhookSecret || env.webhookSecret.length < 32) return no("missing_webhook_secret");
  if (!env.hasServiceKey) return no("missing_service_key");
  if (!(await deps.dbReady().catch(() => false))) return no("db_not_ready");
  const me = await deps.getMe().catch(() => null);
  if (!me) return no("bot_unreachable");
  if (me.toLowerCase() !== username.toLowerCase()) return no("username_mismatch");
  return { ready: true, reason: "ready", username };
}

export const READINESS_TEXT: Record<ReadinessReason, string> = {
  ready: "Telegram bot ready",
  missing_token: "Telegram bot not set up: the bot token is missing.",
  missing_username: "Telegram bot not set up: the bot username is missing.",
  missing_webhook_secret: "Telegram bot not set up: the webhook secret is missing.",
  missing_service_key: "Telegram bot not set up: the server key is missing.",
  db_not_ready: "Telegram bot not set up: the database update is not applied yet.",
  bot_unreachable: "Telegram bot not reachable: check the bot token.",
  username_mismatch: "Telegram bot not set up: the token belongs to a different bot.",
};
