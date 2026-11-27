import { sameSecret } from "@/lib/telegram/api";
import { dispatchOutbox } from "@/lib/telegram/dispatch";
import { telegramConfig } from "@/lib/telegram/server";

export const maxDuration = 30;

/**
 * Sends queued parent notifications. Called by pg_cron through pg_net
 * (migration 0033) only when messages are due, with
 * `Authorization: Bearer <TELEGRAM_DISPATCH_SECRET>`. One bounded batch per
 * call; whatever is left is taken by the next call.
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!sameSecret(auth.startsWith("Bearer ") ? auth.slice(7) : null, process.env.TELEGRAM_DISPATCH_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const cfg = telegramConfig();
  if (!cfg) return new Response(null, { status: 503 });
  try {
    return Response.json(await dispatchOutbox(cfg, { limit: 25, maxMs: 20_000 }));
  } catch {
    console.error("telegram dispatch failed");   // fixed text: error messages can carry data
    return new Response(null, { status: 500 });
  }
}
