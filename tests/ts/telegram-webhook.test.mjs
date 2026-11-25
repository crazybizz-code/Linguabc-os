// Webhook reliability (src/lib/telegram/webhook.ts): a 2xx only when the
// update is fully handled and recorded. Fake database follows 0031:
// claimed / busy / done, claim ids, 90-second takeover.
// Run: npm run test:ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { processWebhook } from "../../src/lib/telegram/webhook.ts";

const SECRET = "s".repeat(40);
const BOT_TOKEN = "123456:SECRET-BOT-TOKEN-never-logged";

/** In-memory telegram_updates with the same rules as tg_claim/finish_update. */
function updatesTable() {
  const rows = new Map();
  let n = 0;
  return {
    rows,
    age(id, seconds) { rows.get(id).at -= seconds * 1000; },
    claim(id) {
      const r = rows.get(id);
      const claim = `c${++n}`;
      if (!r) { rows.set(id, { status: "processing", claim, at: Date.now() }); return { state: "claimed", claim }; }
      if (r.status === "processing" && Date.now() - r.at > 90_000) { Object.assign(r, { claim, at: Date.now() }); return { state: "claimed", claim }; }
      return { state: r.status === "done" ? "done" : "busy" };
    },
    finish(id, claim, ok) {
      const r = rows.get(id);
      if (!r || r.claim !== claim || r.status !== "processing") return false;
      if (ok) r.status = "done"; else rows.delete(id);
      return true;
    },
  };
}

function deps(table, { finishError = false, finishThrows = false, claimError = false } = {}) {
  const calls = [];
  return {
    calls,
    send: async () => ({ ok: true, status: 200 }),
    rpc: async (fn, a) => {
      calls.push(fn);
      if (fn === "tg_claim_update") return claimError ? { data: null, error: { message: "db down" } } : { data: table.claim(a.p_update_id), error: null };
      if (fn === "tg_finish_update") {
        if (finishThrows) throw new Error("network");
        if (finishError && a.p_ok) return { data: null, error: { message: "db down for user 5001 Aziz" } };
        return { data: table.finish(a.p_update_id, a.p_claim, a.p_ok), error: null };
      }
      return { data: [], error: null };
    },
  };
}
const req = (update, secret = SECRET) => ({ secretHeader: secret, contentLength: null, body: async () => JSON.stringify(update) });
const update = (id) => ({ update_id: id, message: { message_id: 1, from: { id: 5001 }, chat: { id: 5001, type: "private" }, text: "Aziz +998901112233" } });
const env = { webhookSecret: SECRET };
const ok = async () => {};
const boom = async () => { throw new Error(`failed for Aziz +998901112233 ${BOT_TOKEN}`); };

test("wrong or missing secret: 401 before the body or database is touched", async () => {
  const t = updatesTable(); const d = deps(t);
  let read = false;
  for (const s of [null, "", "x".repeat(40), SECRET + "x"]) {
    assert.equal(await processWebhook({ secretHeader: s, contentLength: null, body: async () => { read = true; return "{}"; } }, env, d, () => {}, ok), 401);
  }
  assert.equal(read, false);
  assert.equal(d.calls.length, 0);
  assert.equal(await processWebhook(req(update(1)), { webhookSecret: undefined }, d, () => {}, ok), 401, "no configured secret: refuse");
});

test("handled and finalised: 200, and a later retry is 200 without handling again", async () => {
  const t = updatesTable(); const d = deps(t);
  let handled = 0;
  const h = async () => { handled++; };
  assert.equal(await processWebhook(req(update(10)), env, d, () => {}, h), 200);
  assert.equal(await processWebhook(req(update(10)), env, d, () => {}, h), 200);
  assert.equal(handled, 1);
});

test("finalisation fails: 500 (never 200), and Telegram's retry handles it after the claim expires", async () => {
  const t = updatesTable();
  const logs = [];
  assert.equal(await processWebhook(req(update(20)), env, deps(t, { finishError: true }), (r) => logs.push(r), ok), 500);
  assert.equal(await processWebhook(req(update(20)), env, deps(t, { finishThrows: true }), (r) => logs.push(r), ok), 503, "fresh claim: busy");
  t.age(20, 91);
  assert.equal(await processWebhook(req(update(20)), env, deps(t), (r) => logs.push(r), ok), 200, "retry after 90 s succeeds");
  assert.equal(t.rows.get(20).status, "done");
  assert.deepEqual(logs, ["finalise failed"]);
});

test("finalise throws (network): 500", async () => {
  const t = updatesTable();
  assert.equal(await processWebhook(req(update(21)), env, deps(t, { finishThrows: true }), () => {}, ok), 500);
});

test("concurrent duplicate delivery is 503 while the first is processing; nothing is lost if the first fails", async () => {
  const t = updatesTable(); const d = deps(t);
  let release;
  const slow = () => new Promise((_, reject) => { release = () => reject(new Error("boom")); });
  const first = processWebhook(req(update(30)), env, d, () => {}, slow);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await processWebhook(req(update(30)), env, d, () => {}, ok), 503, "duplicate is not acknowledged");
  release();
  assert.equal(await first, 500, "the original failed");
  assert.equal(t.rows.has(30), false, "its claim was released");
  assert.equal(await processWebhook(req(update(30)), env, d, () => {}, ok), 200, "Telegram's retry is handled");
});

test("processing timeout: an overtaken request cannot report success", async () => {
  const t = updatesTable(); const d = deps(t);
  let finishSlow;
  const slow = () => new Promise((r) => { finishSlow = r; });
  const first = processWebhook(req(update(40)), env, d, () => {}, slow);
  await new Promise((r) => setTimeout(r, 5));
  t.age(40, 91);
  assert.equal(await processWebhook(req(update(40)), env, d, () => {}, ok), 200, "the retry took over and finished");
  finishSlow();
  assert.equal(await first, 500, "the old request's finish is refused");
  assert.equal(t.rows.get(40).status, "done");
});

test("handler error: claim released, 500, retry handled", async () => {
  const t = updatesTable(); const d = deps(t);
  assert.equal(await processWebhook(req(update(50)), env, d, () => {}, boom), 500);
  assert.equal(await processWebhook(req(update(50)), env, d, () => {}, ok), 200);
});

test("claim error: 500; bad bodies: 400/413; not configured: 503", async () => {
  const t = updatesTable();
  assert.equal(await processWebhook(req(update(60)), env, deps(t, { claimError: true }), () => {}, ok), 500);
  assert.equal(await processWebhook({ secretHeader: SECRET, contentLength: null, body: async () => "not json" }, env, deps(t), () => {}, ok), 400);
  assert.equal(await processWebhook(req({ nope: 1 }), env, deps(t), () => {}, ok), 400);
  assert.equal(await processWebhook({ secretHeader: SECRET, contentLength: String(10 ** 6), body: async () => "{}" }, env, deps(t), () => {}, ok), 413);
  assert.equal(await processWebhook(req(update(61)), env, null, () => {}, ok), 503);
});

test("logs never contain the token, the parent, the child, a phone or a database message", async () => {
  const t = updatesTable();
  const logs = [];
  const orig = console.error; const consoleLines = [];
  console.error = (...a) => consoleLines.push(a.join(" "));
  try {
    await processWebhook(req(update(70)), env, deps(t), (r) => logs.push(r), boom);
    await processWebhook(req(update(71)), env, deps(t, { finishError: true }), (r) => logs.push(r), ok);
    await processWebhook(req(update(72)), env, deps(t, { claimError: true }), undefined, ok);
  } finally { console.error = orig; }
  const all = [...logs, ...consoleLines].join("\n");
  assert.ok(all.length > 0);
  for (const secret of [BOT_TOKEN, "SECRET-BOT", "Aziz", "998901112233", "5001", "db down", SECRET]) assert.ok(!all.includes(secret), `log leaks ${secret}`);
});
