/**
 * Turns a stored notification into text in the reader's language and a
 * link. The database keeps an English title/body as a fallback plus
 * data.kind and the values used here.
 */
import type { T } from "@/i18n";

export type Note = { id: string; title: string; body: string | null; created_at: string; read: boolean; data: Record<string, unknown> };
export type Audience = "staff" | "student" | "parent";

const TZ = "Asia/Tashkent";

export function describe(n: Note, t: T, locale: string, audience: Audience): { title: string; body: string; who?: string; href: string | null } {
  const r = describeRaw(n, t, locale, audience);
  // A date like "5 дек." already ends in a dot.
  return { ...r, body: r.body.replace(/\.\.$/, ".") };
}

function describeRaw(n: Note, t: T, locale: string, audience: Audience): { title: string; body: string; who?: string; href: string | null } {
  const d = n.data;
  const s = (k: string) => (d[k] == null ? "" : String(d[k]));
  const when = (k: string) => (d[k] ? new Date(String(d[k])).toLocaleString(locale, { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const day = (k: string) => (d[k] ? new Date(`${String(d[k]).slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short" }) : "");
  const month = (k: string) => (d[k] ? new Date(`${String(d[k]).slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric" }) : "");
  const money = (k: string) => Number(d[k] ?? 0).toLocaleString("ru-RU").replace(/ /g, " ");
  const base = audience === "staff" ? "" : `/${audience}`;
  const child = audience === "parent" && d.student_id ? `?child=${s("student_id")}` : "";

  switch (s("kind")) {
    case "mock_left":
      return { title: t("A student left a mock test"), who: [s("student_name"), s("group_name")].filter(Boolean).join(" · ") || undefined,
        body: t("Left the {skill} test of \"{session}\" ({reason}). That part ended with a score of 0.", {
          skill: t(s("skill") === "reading" ? "Reading" : "Listening"), session: s("session_name"),
          reason: t(s("reason") === "left_fullscreen" ? "left full screen" : "left the page") }),
        href: d.session_id ? `/mocks/${s("session_id")}` : null };
    case "attendance":
      return { title: t("Attendance"), body: t("{student} was marked {status} for the {group} lesson on {date}.", {
        student: s("student"), status: t(s("status")), group: s("group"), date: when("at") }), href: `${base}/attendance${child}` };
    case "invoice":
      return { title: t("New invoice"), body: t("{student}: {amount} UZS for {month}, due {date}.", {
        student: s("student"), amount: money("amount"), month: month("period"), date: day("due") }), href: `${base}/payments${child}` };
    case "payment":
      return { title: t("Payment received"), body: t("{amount} UZS received for {student}.", { amount: money("amount"), student: s("student") }), href: `${base}/payments${child}` };
    case "homework_new":
      return { title: t("New homework"), body: t("{title}, due {date}.", { title: s("title"), date: when("due") }),
        href: audience === "student" ? `/student/homework/${s("homework_id")}` : null };
    case "homework_reviewed":
      return { title: t("Homework reviewed"), body: t("{title}: {score}%.", { title: s("title"), score: s("score") || "—" }),
        href: audience === "student" ? `/student/homework/${s("homework_id")}` : null };
    case "mock_scheduled":
      return { title: t("Mock scheduled"), body: t("{name} on {date}.", { name: s("name"), date: when("at") }), href: audience === "student" ? "/student/mocks" : null };
    case "mock_released":
      return { title: t("Mock results"), body: t("{name}: overall band {band}.", { name: s("name"), band: d.overall == null ? "—" : Number(d.overall).toFixed(1) }),
        href: `${base}/progress${child}` };
    case "lesson_cancelled":
      return { title: t("Lesson cancelled"), body: t("The {group} lesson on {date} is cancelled.", { group: s("group"), date: when("at") }),
        href: audience === "student" ? "/student/schedule" : null };
    case "lesson_moved":
      return { title: t("Lesson moved"), body: t("The {group} lesson on {from} moved to {date}.", { group: s("group"), from: when("from"), date: when("at") }),
        href: audience === "student" ? "/student/schedule" : null };
    default:
      return { title: t(n.title), body: n.body ?? "", href: null };
  }
}
