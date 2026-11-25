// Uzbek texts for the parent Telegram bot. Pure functions (no imports with
// "@/" or "server-only") so `npm run test:ts` can load this file directly.
// Messages use Telegram's HTML parse mode: every value from the database
// goes through esc().

export type Json = Record<string, unknown>;
export const DEFAULT_TZ = "Asia/Tashkent";

export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 1250000 -> "1 250 000 so‘m". Whole UZS only. */
export function som(n: unknown): string {
  const v = Math.round(Number(n ?? 0));
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${v < 0 ? "−" : ""}${s} so‘m`;
}

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const WEEKDAYS = ["Yakshanba", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"];
// group_schedule_slots.weekday: 1 = Monday ... 7 = Sunday
const ISO_WEEKDAYS = ["", "Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"];

function parts(iso: unknown, tz: string) {
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz || DEFAULT_TZ, year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: get("year"), m: Number(get("month")), d: Number(get("day")), hh: get("hour"), mm: get("minute"), wd };
}

/** "3-dekabr" (date only; a plain date like "2026-12-03" is not shifted by time zone). */
export function day(v: unknown, tz = DEFAULT_TZ): string {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [, m, d] = s.split("-").map(Number);
    return `${d}-${MONTHS[m - 1]}`;
  }
  const p = parts(s, tz);
  return p ? `${p.d}-${MONTHS[p.m - 1]}` : "—";
}

/** "Seshanba, 3-dekabr, 14:00" in the centre's time zone. */
export function when(v: unknown, tz = DEFAULT_TZ): string {
  const p = parts(v, tz);
  return p ? `${WEEKDAYS[p.wd]}, ${p.d}-${MONTHS[p.m - 1]}, ${p.hh}:${p.mm}` : "—";
}

export function time(v: unknown, tz = DEFAULT_TZ): string {
  const p = parts(v, tz);
  return p ? `${p.hh}:${p.mm}` : "—";
}

export function month(period: unknown): string {
  const s = String(period ?? "");
  const m = /^(\d{4})-(\d{2})/.exec(s);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
}

const ATTENDANCE: Record<string, string> = { present: "✅ keldi", late: "⏰ kechikdi", absent: "❌ kelmadi", excused: "📝 sababli" };
const PAY_STATUS: Record<string, string> = { pending: "to‘lanmagan", partial: "qisman to‘langan", overdue: "muddati o‘tgan", paid: "to‘langan" };
const HW_STATUS: Record<string, string> = { not_started: "boshlanmagan", in_progress: "bajarilmoqda", submitted: "topshirildi", reviewed: "tekshirildi" };
const SKILLS: Record<string, string> = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking", vocabulary: "Lug‘at", grammar: "Grammatika" };
const METHODS: Record<string, string> = { cash: "naqd", card: "karta", bank_transfer: "bank o‘tkazmasi", click: "Click", payme: "Payme", uzum: "Uzum" };

export const MENU: { key: Section; label: string }[] = [
  { key: "prof", label: "👨‍🎓 Farzandim" },
  { key: "sch", label: "📅 Dars jadvali" },
  { key: "att", label: "✅ Davomat" },
  { key: "pay", label: "💳 To‘lovlar" },
  { key: "hw", label: "📚 Uy vazifalari" },
  { key: "res", label: "📊 Natijalar" },
  { key: "grp", label: "👨‍🏫 Guruh va mentor" },
  { key: "con", label: "☎️ Markaz bilan aloqa" },
];
export type Section = "prof" | "sch" | "att" | "pay" | "hw" | "res" | "grp" | "con";

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function renderSection(section: Section, child: string, d: Json): string {
  const tz = String(d.timezone ?? DEFAULT_TZ);
  const head = `<b>${esc(child)}</b>\n`;
  switch (section) {
    case "prof": {
      const groups = list<Json>(d.groups);
      return head + [
        `🏫 ${esc(d.center)}`,
        groups.length ? groups.map((g) => `👥 ${esc(g.group)} — ${esc(g.course)}${g.level ? ` (${esc(g.level)})` : ""}`).join("\n") : "Hozircha guruhga yozilmagan.",
        d.joined_on ? `📆 Markazda: ${day(d.joined_on)} dan` : "",
      ].filter(Boolean).join("\n");
    }
    case "grp": {
      const groups = list<Json>(d.groups);
      if (!groups.length) return head + "Hozircha guruhga yozilmagan.";
      return head + groups.map((g) => {
        const slots = list<Json>(g.slots).map((s) => `   • ${ISO_WEEKDAYS[Number(s.weekday)] ?? "—"} ${esc(s.start)}–${esc(s.end)}${s.room ? `, ${esc(s.room)}` : ""}`);
        return [`👥 <b>${esc(g.group)}</b>`, `👨‍🏫 Mentor: ${esc(g.mentor ?? "—")}`, slots.length ? `🗓 Haftalik jadval:\n${slots.join("\n")}` : ""].filter(Boolean).join("\n");
      }).join("\n\n");
    }
    case "sch": {
      const lessons = list<Json>(d.lessons);
      if (!lessons.length) return head + "Keyingi 14 kunda dars yo‘q.";
      return head + "📅 <b>Yaqin darslar</b>\n" + lessons.slice(0, 12).map((l) =>
        `${l.cancelled ? "🚫 <s>" : "• "}${when(l.starts_at, tz)}–${time(l.ends_at, tz)} · ${esc(l.group)}${l.room ? ` · ${esc(l.room)}` : ""}${l.cancelled ? "</s> (bekor qilindi)" : ""}`).join("\n");
    }
    case "att": {
      const recent = list<Json>(d.recent);
      const c = (d.counts_90d ?? {}) as Json;
      const rate = d.rate_90d == null ? "—" : `${esc(d.rate_90d)}%`;
      return head + [
        `✅ <b>Davomat (90 kun): ${rate}</b>`,
        `Keldi: ${esc(c.present ?? 0)} · Kechikdi: ${esc(c.late ?? 0)} · Kelmadi: ${esc(c.absent ?? 0)} · Sababli: ${esc(c.excused ?? 0)}`,
        recent.length ? "\nOxirgi darslar:\n" + recent.map((r) => `• ${day(r.at, tz)} · ${esc(r.group)} — ${ATTENDANCE[String(r.status)] ?? esc(r.status)}`).join("\n") : "Hali davomat belgilanmagan.",
      ].join("\n");
    }
    case "pay": {
      const open = list<Json>(d.open);
      const recent = list<Json>(d.recent);
      const lines = [`💳 <b>To‘lanishi kerak: ${som(d.due_total)}</b>`];
      if (Number(d.overdue_total ?? 0) > 0) lines.push(`⚠️ Muddati o‘tgan: ${som(d.overdue_total)}`);
      if (d.next_due) lines.push(`📆 Keyingi muddat: ${day(d.next_due)}`);
      if (open.length) lines.push("\nOchiq hisoblar:\n" + open.map((i) => `• ${month(i.period)}: ${som(i.balance)} (${PAY_STATUS[String(i.status)] ?? esc(i.status)}, muddat ${day(i.due)})`).join("\n"));
      lines.push(recent.length ? "\nOxirgi to‘lovlar:\n" + recent.map((p) => `• ${day(p.at)}: ${p.kind === "refund" ? "qaytarildi " : ""}${som(p.amount)} — ${METHODS[String(p.method)] ?? esc(p.method)}, chek ${esc(p.receipt)}`).join("\n") : "\nHali to‘lov qayd etilmagan.");
      lines.push("\n<i>To‘lov markazda qabul qilinadi. Bot orqali to‘lov qilinmaydi.</i>");
      return head + lines.join("\n");
    }
    case "hw": {
      const items = list<Json>(d.items);
      if (!items.length) return head + "Oxirgi 30 kunda uy vazifasi yo‘q.";
      return head + "📚 <b>Uy vazifalari</b>\n" + items.map((h) => {
        const st = h.late ? "⚠️ topshirilmadi" : HW_STATUS[String(h.status)] ?? esc(h.status);
        return `• ${esc(h.title)} (${SKILLS[String(h.skill)] ?? esc(h.skill)}) — muddat ${when(h.due, tz)} — ${st}${h.score != null ? `, ${esc(h.score)}%` : ""}`;
      }).join("\n");
    }
    case "res": {
      const mocks = list<Json>(d.mocks);
      const done = (d.homework_done_30d ?? {}) as Json;
      const lines = ["📊 <b>Natijalar</b>"];
      if (d.homework_avg_30d != null) lines.push(`Uy vazifalari o‘rtacha bali (30 kun): ${esc(d.homework_avg_30d)}%`);
      if (Number(done.set ?? 0) > 0) lines.push(`Bajarilgan vazifalar (30 kun): ${esc(done.done)} / ${esc(done.set)}`);
      lines.push(mocks.length ? "\nMock imtihonlar:\n" + mocks.map((m) =>
        m.status === "absent" ? `• ${esc(m.name)} (${day(m.at)}): qatnashmadi`
          : `• ${esc(m.name)} (${day(m.at)}): umumiy <b>${esc(m.overall ?? "—")}</b> — R ${esc(m.reading ?? "—")}, L ${esc(m.listening ?? "—")}, W ${esc(m.writing ?? "—")}, S ${esc(m.speaking ?? "—")}`).join("\n")
        : "\nE’lon qilingan mock natijasi hali yo‘q.");
      return head + lines.join("\n");
    }
    case "con": {
      const mentors = list<string>(d.mentors);
      return head + [
        `🏫 <b>${esc(d.center)}</b>${d.branch ? ` (${esc(d.branch)})` : ""}`,
        d.phone ? `☎️ ${esc(d.phone)}` : "☎️ Telefon kiritilmagan",
        d.address ? `📍 ${esc(d.address)}` : "",
        mentors.length ? `👨‍🏫 Mentor: ${mentors.map(esc).join(", ")}` : "",
        "\nSavollar bo‘yicha markazga qo‘ng‘iroq qiling.",
      ].filter(Boolean).join("\n");
    }
  }
}

/** Text of a notification for Telegram, from its data (never the English title). */
export function renderNotification(kind: string, d: Json, tz = DEFAULT_TZ): string | null {
  const who = esc(d.student ?? "Farzandingiz");
  switch (kind) {
    case "attendance":
      if (d.status === "absent") return `❌ <b>${who}</b> darsga kelmadi.\n👥 ${esc(d.group ?? "")} · ${when(d.at, tz)}`;
      if (d.status === "late") return `⏰ <b>${who}</b> darsga kechikdi.\n👥 ${esc(d.group ?? "")} · ${when(d.at, tz)}`;
      return null;
    case "payment_due":
      return `💳 Eslatma: <b>${who}</b> uchun ${som(d.balance ?? d.amount)} to‘lov muddati yaqinlashmoqda${d.due ? ` (${day(d.due)})` : ""}.`;
    case "payment_overdue":
      return `⚠️ <b>${who}</b> uchun ${som(d.balance ?? d.amount)} to‘lov muddati o‘tgan${d.due ? ` (${day(d.due)})` : ""}. Iltimos, markazda to‘lang.`;
    case "payment":
      return `✅ To‘lov qabul qilindi: <b>${who}</b> — ${som(d.amount)}${d.receipt ? `, chek ${esc(d.receipt)}` : ""}. Rahmat!`;
    case "lesson_cancelled":
      return `🚫 Dars bekor qilindi: ${esc(d.group ?? "")} · ${when(d.at, tz)}.`;
    case "lesson_moved":
      return `🔁 Dars vaqti o‘zgardi: ${esc(d.group ?? "")}\n${d.from ? `Avval: ${when(d.from, tz)}\n` : ""}Yangi vaqt: ${when(d.at, tz)}`;
    case "mock_released":
      return `📊 Mock natijasi e’lon qilindi${d.name ? `: «${esc(d.name)}»` : ""}${d.overall != null ? `, umumiy ball <b>${esc(d.overall)}</b>` : ""}.\nBatafsil: “📊 Natijalar”.`;
    default:
      return null;
  }
}
