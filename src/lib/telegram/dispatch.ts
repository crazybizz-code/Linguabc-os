// Sends queued Telegram notifications (telegram_outbox, migration 0031).
// Pure: the database and Telegram are passed in.
//
// At least once: a message Telegram accepted is sent again only if this run
// dies before tg_outbox_done (the 2-minute lease then expires). Calls are
// sequential with a small gap to stay far below Telegram's limits, and a
// run stops after `maxMs` so it fits the serverless time limit.

import type { TgSend } from "./api.ts";
import { DEFAULT_TZ, renderNotification, type Json } from "./format.ts";
import type { Rpc } from "./bot.ts";

type Claimed = { id: string; claim: string; chat_id: number; kind: string; data: Json; attempts: number };
export type DispatchResult = { claimed: number; sent: number; retry: number; blocked: number; skipped: number };

export async function dispatchOutbox(deps: { rpc: Rpc; send: TgSend }, opts: { limit?: number; maxMs?: number; gapMs?: number; tz?: string } = {}): Promise<DispatchResult> {
  const started = Date.now();
  const out: DispatchResult = { claimed: 0, sent: 0, retry: 0, blocked: 0, skipped: 0 };
  const { data, error } = await deps.rpc("tg_outbox_claim", { p_limit: opts.limit ?? 25 });
  if (error) throw new Error(`claim: ${error.message}`);
  const rows = (data ?? []) as Claimed[];
  out.claimed = rows.length;
  for (const r of rows) {
    // Out of time: leave the rest; their lease expires and the next run takes them.
    if (Date.now() - started > (opts.maxMs ?? 20_000)) break;
    const text = renderNotification(r.kind, r.data ?? {}, opts.tz ?? DEFAULT_TZ);
    if (!text) {
      await done(deps, r, { p_ok: true });   // nothing to say for this kind: close it
      out.skipped++;
      continue;
    }
    const res = await deps.send("sendMessage", { chat_id: r.chat_id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    if (res.ok) { await done(deps, r, { p_ok: true }); out.sent++; }
    else if (res.blocked) { await done(deps, r, { p_ok: false, p_error: (res.description ?? "forbidden").slice(0, 200), p_blocked: true }); out.blocked++; }
    else {
      await done(deps, r, { p_ok: false, p_error: `${res.status} ${(res.description ?? "").slice(0, 200)}`, p_retry_after: res.retryAfter ?? null });
      out.retry++;
      if (res.status === 429) break;   // Telegram asked us to slow down: stop this run
    }
    if (opts.gapMs !== 0) await new Promise((ok) => setTimeout(ok, opts.gapMs ?? 50));
  }
  return out;
}

async function done(deps: { rpc: Rpc }, r: Claimed, args: Record<string, unknown>) {
  // Retried a few times: losing this answer would mean sending the message again.
  for (let i = 0; i < 3; i++) {
    const { error } = await deps.rpc("tg_outbox_done", { p_id: r.id, p_claim: r.claim, p_error: null, p_retry_after: null, p_blocked: false, ...args });
    if (!error) return;
  }
  throw new Error("could not record a Telegram send");
}
