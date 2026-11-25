import { sameSecret } from "@/lib/telegram/api";
import { handleUpdate, type TgUpdate } from "@/lib/telegram/bot";
import { telegramConfig } from "@/lib/telegram/server";

export const maxDuration = 30;
const MAX_BYTES = 64 * 1024;

/**
 * Telegram webhook (parent bot). Order matters:
 *  1. the secret header must match TELEGRAM_WEBHOOK_SECRET (constant time),
 *     so nothing in the body, including the Telegram user id, is trusted
 *     before that;
 *  2. size and shape checks;
 *  3. tg_claim_update: a repeat or an update another request is handling
 *     gets 200 and is dropped;
 *  4. handle; on success the claim is closed for good; on failure it is
 *     released and we answer 500, so Telegram delivers the update again.
 * Nothing from the body is logged.
 */
export async function POST(request: Request) {
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const cfg = telegramConfig();
  if (!cfg) return new Response(null, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return new Response(null, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BYTES) return new Response(null, { status: 413 });
  let update: TgUpdate;
  try {
    update = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!update || !Number.isSafeInteger(update.update_id)) return new Response(null, { status: 400 });

  const claim = await cfg.rpc("tg_claim_update", { p_update_id: update.update_id });
  if (claim.error) return new Response(null, { status: 500 });
  if (!claim.data) return new Response(null, { status: 200 });
  try {
    await handleUpdate(update, cfg);
    await cfg.rpc("tg_finish_update", { p_update_id: update.update_id, p_ok: true });
    return new Response(null, { status: 200 });
  } catch (e) {
    console.error("telegram update failed", e instanceof Error ? e.message.slice(0, 120) : "error");
    await cfg.rpc("tg_finish_update", { p_update_id: update.update_id, p_ok: false });
    return new Response(null, { status: 500 });
  }
}
