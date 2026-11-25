// Integration: the real bot code (src/lib/telegram/bot.ts, dispatch.ts)
// against the real tg_* functions in the local test database left by
// supabase/tests/run.sh, called as service_role through psql. Telegram is
// faked. Synthetic data only; never point this at production.
//   su postgres -c "node --test tests/ts/telegram.db.e2e.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { handleUpdate, TEXT } from "../../src/lib/telegram/bot.ts";
import { dispatchOutbox } from "../../src/lib/telegram/dispatch.ts";

const DB = process.env.DB ?? "linguabc_test";
const SETOF = new Set(["tg_children", "tg_outbox_claim"]);
const lit = (v) => v === null || v === undefined ? "null"
  : typeof v === "number" || typeof v === "boolean" ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`;
function sql(q) {
  return execFileSync("psql", ["-qtA", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", `set role service_role; ${q}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const rpc = async (fn, args) => {
  if (!/^tg_[a-z_]+$/.test(fn)) throw new Error("bot may only call tg_* functions");
  const call = `public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ")})`;
  try {
    const out = sql(SETOF.has(fn) ? `select coalesce(jsonb_agg(t), '[]') from ${call} t` : `select to_jsonb(${call})`);
    return { data: out === "" ? null : JSON.parse(out), error: null };
  } catch (e) {
    return { data: null, error: { message: String(e.stderr ?? e.message) } };
  }
};
function telegram() {
  const sent = [];
  return { sent, send: async (method, body) => { sent.push([method, body]); return { ok: true, status: 200 }; } };
}
const kid = (name) => sql(`reset role; select id from students where full_name = '${name}'`);
const cb = (from, data) => ({ update_id: 1, callback_query: { id: "q", from: { id: from }, data, message: { message_id: 1, chat: { id: from, type: "private" } } } });
const lastText = (t) => t.sent.filter(([m]) => m !== "answerCallbackQuery").at(-1)?.[1].text;

// Fresh link for the parent of Aziz and Dilnoza, through the real /start flow.
const TOKEN = "e2e-token-e2e-token-e2e-token-01";
const PARENT = () => sql(`reset role; select g.membership_id from guardians g join students s on s.id = g.student_id
  where s.full_name = 'Aziz Karimov' and g.membership_id is not null limit 1`);

test("/start <token> links the parent; the same token cannot link anyone else", async () => {
  const m = PARENT();
  sql(`reset role; insert into telegram_link_tokens (center_id, membership_id, token_hash, expires_at)
       select center_id, id, app.tg_hash('${TOKEN}'), now() + interval '1 hour' from memberships where id = '${m}'`);
  const t = telegram();
  await handleUpdate({ update_id: 1, message: { message_id: 1, from: { id: 111 }, chat: { id: 111, type: "private" }, text: `/start ${TOKEN}` } }, { rpc, send: t.send });
  assert.match(t.sent[0][1].text, /ulandi/);
  await handleUpdate({ update_id: 2, message: { message_id: 2, from: { id: 999 }, chat: { id: 999, type: "private" }, text: `/start ${TOKEN}` } }, { rpc, send: t.send });
  assert.equal(lastText(t), TEXT.badLink);
});

test("linked parent: two children, every menu reads real data", async () => {
  const t = telegram();
  await handleUpdate({ update_id: 1, message: { message_id: 1, from: { id: 111 }, chat: { id: 111, type: "private" }, text: "/start" } }, { rpc, send: t.send });
  const buttons = t.sent.at(-1)[1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(buttons.includes(`s:${kid("Aziz Karimov")}`) && buttons.includes(`s:${kid("Dilnoza Rahimova")}`), "both children offered");
  for (const sec of ["prof", "grp", "sch", "att", "pay", "hw", "res", "con"]) {
    await handleUpdate(cb(111, `v:${sec}:${kid("Aziz Karimov")}`), { rpc, send: t.send });
    const text = lastText(t);
    assert.ok(text.startsWith("<b>Aziz Karimov</b>"), `${sec} shows the child`);
    assert.notEqual(text, TEXT.forbidden);
  }
  assert.match(lastText(t), /\+998712000000/, "centre phone from 0032");
});

test("unrelated Telegram user and another family's child are refused by the database", async () => {
  const t = telegram();
  await handleUpdate(cb(999, `v:pay:${kid("Aziz Karimov")}`), { rpc, send: t.send });
  assert.equal(lastText(t), TEXT.forbidden);
  await handleUpdate(cb(111, `v:pay:${kid("Third Student")}`), { rpc, send: t.send });
  assert.equal(lastText(t), TEXT.forbidden);
  const direct = await rpc("tg_child_payments", { p_tg_user: 999, p_student: kid("Aziz Karimov") });
  assert.match(direct.error?.message ?? "", /forbidden/);
});

test("dispatch sends a queued notice once and records it", async () => {
  const st = kid("Aziz Karimov");
  sql(`reset role; select app.notify(center_id, array['${PARENT()}']::uuid[], 'payment', 'Payment received', 'x',
       jsonb_build_object('student', 'Aziz Karimov', 'student_id', '${st}', 'amount', 250000, 'receipt', 'E2E-1')) from students where id = '${st}'`);
  const t = telegram();
  const r = await dispatchOutbox({ rpc, send: t.send }, { gapMs: 0 });
  assert.equal(r.sent, 1, "the payment notice");
  assert.match(t.sent[0][1].text, /To‘lov qabul qilindi/);
  const again = await dispatchOutbox({ rpc, send: t.send }, { gapMs: 0 });
  assert.equal(again.claimed, 0, "nothing sent twice");
});
