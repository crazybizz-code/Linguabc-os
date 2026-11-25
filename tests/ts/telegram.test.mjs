// Parent Telegram bot (src/lib/telegram/*) with a fake database and a fake
// Telegram. The fake database follows the 0031/0032 rules: a Telegram user
// sees only their linked children, anything else is "forbidden".
// Run: npm run test:ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUpdate, TEXT } from "../../src/lib/telegram/bot.ts";
import { dispatchOutbox } from "../../src/lib/telegram/dispatch.ts";
import { sameSecret } from "../../src/lib/telegram/api.ts";
import { renderNotification, renderSection, som, when, esc } from "../../src/lib/telegram/format.ts";

const KID1 = "11111111-1111-4111-8111-111111111111";
const KID2 = "22222222-2222-4222-8222-222222222222";
const STRANGER_KID = "33333333-3333-4333-8333-333333333333";
const PARENT = 5001;

function world({ kids = { [PARENT]: [KID1, KID2] }, tokens = { "good-token-good-token-good-tok": PARENT } } = {}) {
  const sent = [];
  const calls = [];
  const blocked = new Map();
  const names = { [KID1]: "Aziz", [KID2]: "Dilnoza", [STRANGER_KID]: "Other" };
  const rpc = async (fn, args) => {
    calls.push([fn, args]);
    const mine = kids[args.p_tg_user] ?? [];
    switch (fn) {
      case "tg_set_blocked": blocked.set(args.p_tg_user, args.p_blocked); return { data: null, error: null };
      case "tg_children": return { data: mine.map((id) => ({ student_id: id, full_name: names[id], center_name: "Alpha" })), error: null };
      case "tg_redeem_link": {
        const ok = tokens[args.p_token] === args.p_tg_user && args.p_chat === args.p_tg_user;
        if (ok) delete tokens[args.p_token];
        return { data: ok ? { ok: true, center: "Alpha", children: mine.length } : { ok: false }, error: null };
      }
      case "tg_unlink": kids[args.p_tg_user] = []; return { data: 1, error: null };
      default:
        if (fn.startsWith("tg_child_") || fn === "tg_center_contact") {
          if (!mine.includes(args.p_student)) return { data: null, error: { message: "forbidden" } };
          return { data: { center: "Alpha", groups: [], recent: [], lessons: [], open: [], items: [], mocks: [] }, error: null };
        }
        throw new Error(`unexpected rpc ${fn}`);
    }
  };
  const send = async (method, body) => { sent.push([method, body]); return { ok: true, status: 200 }; };
  return { rpc, send, sent, calls, blocked };
}
const msg = (text, { from = PARENT, chat = PARENT, type = "private" } = {}) =>
  ({ update_id: 1, message: { message_id: 9, from: { id: from }, chat: { id: chat, type }, text } });
const cb = (data, { from = PARENT, chat = PARENT, type = "private" } = {}) =>
  ({ update_id: 2, callback_query: { id: "q", from: { id: from }, data, message: { message_id: 7, chat: { id: chat, type } } } });
const texts = (w) => w.sent.filter(([m]) => m !== "answerCallbackQuery").map(([, b]) => b.text);

test("sameSecret: exact match only, and never with a short or missing secret", () => {
  const s = "x".repeat(32);
  assert.equal(sameSecret(s, s), true);
  assert.equal(sameSecret(s + "y", s), false);
  assert.equal(sameSecret("x".repeat(31) + "y", s), false);
  assert.equal(sameSecret(null, s), false);
  assert.equal(sameSecret("short", "short"), false);
  assert.equal(sameSecret("", undefined), false);
});

test("group chats and forwarded identities are ignored: nothing is read or sent", async () => {
  for (const u of [msg("/start", { type: "group", chat: -100 }), msg("/start", { chat: 999 }), cb(`v:pay:${KID1}`, { type: "supergroup", chat: -100 })]) {
    const w = world();
    await handleUpdate(u, w);
    assert.equal(texts(w).length, 0);
    assert.ok(!w.calls.some(([fn]) => fn.startsWith("tg_child") || fn === "tg_children"));
  }
});

test("/start with a valid token links once; the second use is refused", async () => {
  const w = world({ kids: { [PARENT]: [KID1] } });
  await handleUpdate(msg("/start good-token-good-token-good-tok"), w);
  assert.match(texts(w)[0], /ulandi/);
  await handleUpdate(msg("/start good-token-good-token-good-tok"), w);
  assert.equal(texts(w).at(-1), TEXT.badLink);
});

test("not linked: the bot explains how to connect and shows no data", async () => {
  const w = world({ kids: {} });
  await handleUpdate(msg("salom", { from: 42, chat: 42 }), w);
  assert.equal(texts(w)[0], TEXT.notLinked);
});

test("two children: a picker first, then each child's own menu", async () => {
  const w = world();
  await handleUpdate(msg("/start"), w);
  const picker = w.sent.at(-1)[1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(picker.slice(0, 2), [`s:${KID1}`, `s:${KID2}`]);
  await handleUpdate(cb(`s:${KID2}`), w);
  assert.match(texts(w).at(-1), /Dilnoza/);
  await handleUpdate(cb(`v:pay:${KID2}`), w);
  assert.ok(w.calls.some(([fn, a]) => fn === "tg_child_payments" && a.p_student === KID2 && a.p_tg_user === PARENT));
});

test("a forged button for another family's child gets 'forbidden' and no data", async () => {
  const w = world();
  await handleUpdate(cb(`v:pay:${STRANGER_KID}`), w);
  assert.equal(texts(w).at(-1), TEXT.forbidden);
  assert.ok(!w.calls.some(([fn]) => fn === "tg_child_payments"));
  await handleUpdate(cb("v:pay:not-a-uuid"), w);
  assert.ok(!w.calls.some(([fn]) => fn === "tg_child_payments"));
});

test("blocking and unblocking the bot is recorded", async () => {
  const w = world();
  await handleUpdate({ update_id: 3, my_chat_member: { from: { id: PARENT }, chat: { id: PARENT, type: "private" }, new_chat_member: { status: "kicked" } } }, w);
  assert.equal(w.blocked.get(PARENT), true);
  await handleUpdate({ update_id: 4, my_chat_member: { from: { id: PARENT }, chat: { id: PARENT, type: "private" }, new_chat_member: { status: "member" } } }, w);
  assert.equal(w.blocked.get(PARENT), false);
});

test("unlink asks first, then disconnects", async () => {
  const w = world();
  await handleUpdate(cb("u"), w);
  assert.equal(texts(w).at(-1), TEXT.unlinkAsk);
  await handleUpdate(cb("u!"), w);
  assert.equal(texts(w).at(-1), TEXT.unlinked);
  assert.ok(w.calls.some(([fn]) => fn === "tg_unlink"));
});

test("a Telegram failure throws so the webhook answers 500 and Telegram retries", async () => {
  const w = world();
  w.send = async () => ({ ok: false, status: 502 });
  await assert.rejects(handleUpdate(msg("/start"), w));
});

test("dispatch: sent, blocked (403), and 429 retry_after stops the run", async () => {
  const rows = [
    { id: "a", claim: "c1", chat_id: 1, kind: "attendance", data: { status: "absent", student: "Aziz", group: "B2", at: "2026-12-01T09:00:00Z" }, attempts: 1 },
    { id: "b", claim: "c2", chat_id: 2, kind: "payment", data: { student: "Aziz", amount: 500000, receipt: "R-7" }, attempts: 1 },
    { id: "c", claim: "c3", chat_id: 3, kind: "payment_due", data: { student: "Dilnoza", amount: 800000, due: "2026-12-05" }, attempts: 1 },
    { id: "d", claim: "c4", chat_id: 4, kind: "attendance", data: { status: "present" }, attempts: 1 },
  ];
  const done = [];
  const rpc = async (fn, a) => {
    if (fn === "tg_outbox_claim") return { data: rows, error: null };
    if (fn === "tg_outbox_done") { done.push(a); return { data: null, error: null }; }
    throw new Error(fn);
  };
  const send = async (_m, body) => body.chat_id === 1 ? { ok: true, status: 200 }
    : body.chat_id === 2 ? { ok: false, status: 403, blocked: true, description: "Forbidden: bot was blocked by the user" }
    : { ok: false, status: 429, retryAfter: 30, description: "Too Many Requests" };
  const r = await dispatchOutbox({ rpc, send }, { gapMs: 0 });
  assert.deepEqual(r, { claimed: 4, sent: 1, retry: 1, blocked: 1, skipped: 0 });
  assert.deepEqual(done.map((d) => [d.p_id, d.p_claim, d.p_ok, d.p_blocked, d.p_retry_after]),
    [["a", "c1", true, false, null], ["b", "c2", false, true, null], ["c", "c3", false, false, 30]]);
});

test("Uzbek texts: money, Tashkent time, HTML escaping, no English titles", () => {
  assert.equal(som(1250000), "1 250 000 so‘m");
  assert.equal(when("2026-12-01T09:00:00Z"), "Seshanba, 1-dekabr, 14:00");
  assert.equal(esc("<b>&"), "&lt;b&gt;&amp;");
  assert.match(renderNotification("attendance", { status: "absent", student: "<Aziz>", group: "B2", at: "2026-12-01T09:00:00Z" }), /&lt;Aziz&gt;.*kelmadi/s);
  assert.equal(renderNotification("attendance", { status: "present" }), null);
  assert.equal(renderNotification("homework_new", {}), null);
  assert.match(renderSection("pay", "Aziz", { due_total: 720000, overdue_total: 0, open: [], recent: [] }), /720 000 so‘m/);
});
