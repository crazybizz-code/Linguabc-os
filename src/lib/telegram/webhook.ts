// The webhook's decision logic, separate from Next.js so tests can drive it
// with fakes. Pure: no "@/" imports.
//
// Telegram keeps re-sending an update until it gets a 2xx, so a 2xx is
// returned ONLY when the update is known to be fully handled:
//   401  secret header missing or wrong (nothing in the body is read)
//   413  body too large;  400  not JSON / no update_id
//   200  handled and finalised now, or finalised before ('done')
//   503  another request is handling this update right now ('busy'), or
//        the bot is not configured: Telegram retries later
//   500  claim failed, handler failed, or the result could not be recorded
//        (finalise error or the claim was overtaken): Telegram retries
//
// Logs carry a fixed reason only: never the body, the Telegram user, a
// student, an error message from the database or Telegram, or a URL (the
// bot token is in Telegram API URLs).

import { sameSecret } from "./api.ts";
import { handleUpdate, type BotDeps, type TgUpdate } from "./bot.ts";

export const MAX_BODY_BYTES = 64 * 1024;
export type WebhookLog = (reason: string) => void;

export async function processWebhook(
  req: { secretHeader: string | null; contentLength: string | null; body: () => Promise<string> },
  env: { webhookSecret: string | undefined },
  deps: BotDeps | null,
  log: WebhookLog = (r) => console.error(`telegram webhook: ${r}`),
  handle: typeof handleUpdate = handleUpdate,
): Promise<number> {
  if (!sameSecret(req.secretHeader, env.webhookSecret)) return 401;
  if (!deps) return 503;
  if (Number(req.contentLength ?? 0) > MAX_BODY_BYTES) return 413;
  const body = await req.body();
  if (body.length > MAX_BODY_BYTES) return 413;
  let update: TgUpdate;
  try {
    update = JSON.parse(body);
  } catch {
    return 400;
  }
  if (!update || typeof update !== "object" || !Number.isSafeInteger(update.update_id)) return 400;

  const claimed = await deps.rpc("tg_claim_update", { p_update_id: update.update_id }).catch(() => null);
  if (!claimed || claimed.error) { log("claim failed"); return 500; }
  const c = (claimed.data ?? {}) as { state?: string; claim?: string };
  if (c.state === "done") return 200;
  if (c.state !== "claimed" || !c.claim) return 503;   // busy: never acknowledge

  try {
    await handle(update, deps);
  } catch {
    log("handler failed");
    const rel = await deps.rpc("tg_finish_update", { p_update_id: update.update_id, p_claim: c.claim, p_ok: false }).catch(() => null);
    // If the release fails too, the claim expires after 90 s and the retry takes it over.
    if (!rel || rel.error) log("release failed");
    return 500;
  }
  const fin = await deps.rpc("tg_finish_update", { p_update_id: update.update_id, p_claim: c.claim, p_ok: true }).catch(() => null);
  if (!fin || fin.error) { log("finalise failed"); return 500; }
  if (fin.data !== true) { log("claim overtaken"); return 500; }
  return 200;
}
