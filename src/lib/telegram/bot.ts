// Parent bot: turns one verified Telegram update into replies. Pure: the
// database and Telegram are passed in, so tests drive it with fakes.
//
// Trust: the webhook route checks Telegram's secret header BEFORE calling
// this, so `from.id` is the real Telegram user. Every data read goes through
// a tg_* database function that re-checks this user against the student id,
// so a forged or old button (callback data) gets "forbidden" and nothing else.
// Only private chats are answered; groups, channels and forwarded chats are
// ignored, so family data is never posted where others can read it.

import type { TgSend } from "./api.ts";
import { esc, MENU, renderSection, type Json, type Section } from "./format.ts";

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type BotDeps = { rpc: Rpc; send: TgSend; botName?: string };

type Child = { student_id: string; full_name: string; center_name: string };
type TgUser = { id: number; is_bot?: boolean; username?: string };
type TgChat = { id: number; type: string };
export type TgUpdate = {
  update_id: number;
  message?: { message_id: number; from?: TgUser; chat: TgChat; text?: string };
  callback_query?: { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: TgChat } };
  my_chat_member?: { from: TgUser; chat: TgChat; new_chat_member?: { status?: string } };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECTION_RPC: Record<Section, string> = {
  prof: "tg_child_profile", grp: "tg_child_profile", sch: "tg_child_schedule", att: "tg_child_attendance",
  pay: "tg_child_payments", hw: "tg_child_homework", res: "tg_child_results", con: "tg_center_contact",
};
const MAX_TEXT = 3900;

export const TEXT = {
  notLinked: "👋 Assalomu alaykum! Bu LinguABC ota-onalar boti.\n\nHisobingiz hali ulanmagan. Markaz administratoridan <b>Telegram havola</b> so‘rang va uni shu telefonda oching.",
  badLink: "⚠️ Havola yaroqsiz yoki muddati o‘tgan. Markazdan yangi havola so‘rang.",
  linked: (center: string) => `✅ Hisobingiz ulandi: <b>${esc(center)}</b>.\nEndi farzandingiz haqidagi ma’lumotlarni shu yerda ko‘rasiz va muhim xabarlarni olasiz.`,
  forbidden: "⛔ Bu ma’lumot sizga ochiq emas. Kerak bo‘lsa, markaz bilan bog‘laning.",
  pickChild: "Farzandingizni tanlang:",
  unlinkAsk: "Botni hisobingizdan uzasizmi? Shundan keyin ma’lumot va xabarlar kelmaydi. Qayta ulanish uchun markazdan yangi havola kerak bo‘ladi.",
  unlinked: "🔌 Hisob uzildi. Qayta ulanish uchun markazdan yangi havola so‘rang.",
};

type Keyboard = { text: string; callback_data: string }[][];

export async function handleUpdate(u: TgUpdate, deps: BotDeps): Promise<void> {
  if (u.my_chat_member) {
    const m = u.my_chat_member;
    if (m.chat.type !== "private" || m.from.id !== m.chat.id) return;
    const st = m.new_chat_member?.status;
    if (st === "kicked") await must(deps.rpc("tg_set_blocked", { p_tg_user: m.from.id, p_blocked: true }));
    else if (st === "member") await must(deps.rpc("tg_set_blocked", { p_tg_user: m.from.id, p_blocked: false }));
    return;
  }

  if (u.message) {
    const { from, chat, text } = u.message;
    if (!from || from.is_bot || chat.type !== "private" || from.id !== chat.id) return;
    await must(deps.rpc("tg_set_blocked", { p_tg_user: from.id, p_blocked: false }));
    const t = (text ?? "").trim();
    const start = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{20,64}))?$/.exec(t);
    if (start?.[1]) {
      const { data, error } = await deps.rpc("tg_redeem_link", { p_token: start[1], p_tg_user: from.id, p_chat: chat.id, p_username: from.username ?? null });
      if (error) throw new Error(`redeem: ${error.message}`);
      const r = (data ?? {}) as Json;
      if (!r.ok) return void (await reply(deps, chat.id, TEXT.badLink));
      await reply(deps, chat.id, TEXT.linked(String(r.center ?? "")));
      return showChildren(deps, from.id, chat.id);
    }
    if (/^\/stop\b/.test(t)) return void (await reply(deps, chat.id, TEXT.unlinkAsk, unlinkKeyboard()));
    return showChildren(deps, from.id, chat.id);
  }

  if (u.callback_query) {
    const q = u.callback_query;
    const chat = q.message?.chat;
    if (!chat || chat.type !== "private" || q.from.id !== chat.id || q.from.is_bot) {
      await deps.send("answerCallbackQuery", { callback_query_id: q.id });
      return;
    }
    await deps.send("answerCallbackQuery", { callback_query_id: q.id });
    await must(deps.rpc("tg_set_blocked", { p_tg_user: q.from.id, p_blocked: false }));
    const edit = q.message!.message_id;
    const data = q.data ?? "";
    if (data === "k") return showChildren(deps, q.from.id, chat.id, edit);
    if (data === "u") return void (await reply(deps, chat.id, TEXT.unlinkAsk, unlinkKeyboard(), edit));
    if (data === "u!") {
      await must(deps.rpc("tg_unlink", { p_tg_user: q.from.id }));
      return void (await reply(deps, chat.id, TEXT.unlinked, [], edit));
    }
    const sm = /^s:(.+)$/.exec(data);
    if (sm && UUID.test(sm[1])) return showChildMenu(deps, q.from.id, chat.id, sm[1], edit);
    const vm = /^v:([a-z]+):(.+)$/.exec(data);
    if (vm && vm[1] in SECTION_RPC && UUID.test(vm[2])) return showSection(deps, q.from.id, chat.id, vm[1] as Section, vm[2], edit);
    return showChildren(deps, q.from.id, chat.id, edit);
  }
}

async function children(deps: BotDeps, tgUser: number): Promise<Child[]> {
  const { data, error } = await deps.rpc("tg_children", { p_tg_user: tgUser });
  if (error) throw new Error(`children: ${error.message}`);
  return (data ?? []) as Child[];
}

async function showChildren(deps: BotDeps, tgUser: number, chat: number, edit?: number) {
  const kids = await children(deps, tgUser);
  if (!kids.length) return void (await reply(deps, chat, TEXT.notLinked, [], edit));
  if (kids.length === 1) return showChildMenu(deps, tgUser, chat, kids[0].student_id, edit, kids);
  await reply(deps, chat, TEXT.pickChild,
    [...kids.map((k) => [{ text: `👨‍🎓 ${k.full_name}`, callback_data: `s:${k.student_id}` }]), [{ text: "🔌 Botni uzish", callback_data: "u" }]], edit);
}

async function showChildMenu(deps: BotDeps, tgUser: number, chat: number, student: string, edit?: number, known?: Child[]) {
  const kids = known ?? (await children(deps, tgUser));
  const child = kids.find((k) => k.student_id === student);
  if (!child) return void (await reply(deps, chat, TEXT.forbidden, [[{ text: "⬅️ Orqaga", callback_data: "k" }]], edit));
  await reply(deps, chat, `<b>${esc(child.full_name)}</b> · ${esc(child.center_name)}\nBo‘limni tanlang:`, menuKeyboard(student, kids.length > 1), edit);
}

async function showSection(deps: BotDeps, tgUser: number, chat: number, section: Section, student: string, edit?: number) {
  const kids = await children(deps, tgUser);
  const child = kids.find((k) => k.student_id === student);
  const back: Keyboard = [[{ text: "⬅️ Menyu", callback_data: `s:${student}` }], ...(kids.length > 1 ? [[{ text: "👨‍👩‍👧 Boshqa farzand", callback_data: "k" }]] : [])];
  if (!child) return void (await reply(deps, chat, TEXT.forbidden, [[{ text: "⬅️ Orqaga", callback_data: "k" }]], edit));
  const { data, error } = await deps.rpc(SECTION_RPC[section], { p_tg_user: tgUser, p_student: student });
  if (error) {
    if (/forbidden/i.test(error.message)) return void (await reply(deps, chat, TEXT.forbidden, back, edit));
    throw new Error(`${section}: ${error.message}`);
  }
  await reply(deps, chat, renderSection(section, child.full_name, (data ?? {}) as Json), back, edit);
}

function menuKeyboard(student: string, many: boolean): Keyboard {
  const rows: Keyboard = [];
  for (let i = 0; i < MENU.length; i += 2) rows.push(MENU.slice(i, i + 2).map((m) => ({ text: m.label, callback_data: `v:${m.key}:${student}` })));
  if (many) rows.push([{ text: "👨‍👩‍👧 Boshqa farzand", callback_data: "k" }]);
  rows.push([{ text: "🔌 Botni uzish", callback_data: "u" }]);
  return rows;
}

function unlinkKeyboard(): Keyboard {
  return [[{ text: "Ha, uzish", callback_data: "u!" }, { text: "Yo‘q", callback_data: "k" }]];
}

async function reply(deps: BotDeps, chat: number, text: string, keyboard: Keyboard = [], edit?: number) {
  const body: Record<string, unknown> = {
    chat_id: chat, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
    parse_mode: "HTML", link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: keyboard },
  };
  let r = edit ? await deps.send("editMessageText", { ...body, message_id: edit }) : await deps.send("sendMessage", body);
  // An old message cannot be edited: send a new one instead.
  if (!r.ok && edit && r.status === 400 && !/not modified/i.test(r.description ?? "")) r = await deps.send("sendMessage", body);
  if (r.ok || (r.status === 400 && /not modified/i.test(r.description ?? ""))) return;
  if (r.blocked) { await deps.rpc("tg_set_blocked", { p_tg_user: chat, p_blocked: true }); return; }
  throw new Error(`telegram ${r.status}`);   // the webhook answers 500, Telegram retries
}

async function must(p: ReturnType<Rpc>) {
  const { error } = await p;
  if (error) throw new Error(error.message);
}
