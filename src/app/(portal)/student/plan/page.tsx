import Link from "next/link";
import { BookOpen, CalendarDays, ClipboardList, Dumbbell, ChevronRight, Lightbulb } from "lucide-react";
import { getPortalContext } from "@/lib/portal/context";
import { PortalCard } from "@/components/portal/cards";
import { Badge } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";
import { loadProgress } from "@/lib/progress";
import { suggest } from "@/lib/suggestions";

export const metadata = { title: "My plan" };
const TZ = "Asia/Tashkent";

/** The rest of the week in the order it matters: homework by due date, lessons, mocks, and a practice suggestion. */
export default async function PlanPage() {
  const ctx = await getPortalContext("student");
  const { supabase, t } = ctx;
  const L = intlLocale(ctx.locale);
  const me = ctx.children[0];
  if (!me) return <PortalCard><p className="text-[13px] text-muted-foreground">{t("Your account is not linked to a student yet. Ask the centre to check your invitation.")}</p></PortalCard>;
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const { data: enr } = await supabase.from("enrollments").select("group_id").eq("student_id", me.id).eq("status", "active");
  const groups = (enr ?? []).map((e) => e.group_id);
  const [hw, subs, lessons, mocks, results] = await Promise.all([
    groups.length ? supabase.from("homework").select("id, due_at, assignments(title, skill)").in("group_id", groups).gte("due_at", new Date(now.getTime() - 3 * 86_400_000).toISOString()).order("due_at") : Promise.resolve({ data: [] }),
    supabase.from("submissions").select("homework_id, status").eq("student_id", me.id),
    groups.length ? supabase.from("lessons").select("id, starts_at, groups(name)").in("group_id", groups).neq("status", "cancelled").gte("starts_at", now.toISOString()).lte("starts_at", weekEnd).order("starts_at") : Promise.resolve({ data: [] }),
    supabase.from("mock_sessions").select("id, name, scheduled_at").gte("scheduled_at", now.toISOString()).order("scheduled_at").limit(3),
    supabase.from("mock_result_scores").select("reading_band, listening_band, writing_band, speaking_band, released_at").eq("student_id", me.id).not("released_at", "is", null).order("released_at", { ascending: false }).limit(1),
  ]);
  // Suggestions from the student's own records only (RLS: their session).
  const prog = await loadProgress(supabase, me.id);
  const lastMock = prog.mocks[prog.mocks.length - 1] ?? null;
  const tips = suggest({
    now: now.toISOString(), attendancePct: prog.attendancePct, attendanceCounted: prog.attendanceCounted,
    homework: prog.homework, bySkill: prog.bySkill, latestMock: lastMock,
  });
  const skillName = (v: string | number) => (typeof v === "string" && /^(reading|listening|writing|speaking)$/.test(v) ? t(v[0].toUpperCase() + v.slice(1)) : v);
  const done = new Set((subs.data ?? []).filter((s) => s.status === "submitted" || s.status === "reviewed").map((s) => s.homework_id));
  const todo = (hw.data ?? []).filter((h) => !done.has(h.id));
  const last = results.data?.[0];
  const skills = last ? ([["reading", last.reading_band], ["listening", last.listening_band], ["writing", last.writing_band], ["speaking", last.speaking_band]] as [string, number | null][]).filter(([, b]) => b != null) : [];
  const weakest = skills.sort((a, b) => Number(a[1]) - Number(b[1]))[0];
  const when = (iso: string) => new Date(iso).toLocaleString(L, { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <PortalCard icon={Lightbulb} title={t("Suggestions for you")}>
        <ul className="space-y-2.5">
          {tips.map((tip) => (
            <li key={tip.kind} className="text-[13px] leading-relaxed">
              {t(tip.text, Object.fromEntries(Object.entries(tip.vars).map(([k, v]) => [k, k === "skill" ? skillName(v) : v])))}
              {tip.href && <> <Link href={tip.href} className="font-medium text-[#12392B] underline-offset-2 hover:underline">{t("Open")}</Link></>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground">{t("Based on your attendance, homework and released mock results.")}</p>
      </PortalCard>
      <PortalCard icon={BookOpen} title={t("Homework to do")}>
        {todo.length === 0 ? <p className="text-[13px] text-[#3F6B4A]">{t("Nothing is waiting on you. A practice session is the best use of today.")}</p> : (
          <ul className="divide-y divide-border/60">
            {todo.map((h) => {
              const late = new Date(h.due_at) < now;
              const a = h.assignments as unknown as { title: string } | null;
              return (
                <li key={h.id}><Link href={`/student/homework/${h.id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span><span className="block text-[13.5px] font-medium">{a?.title ?? "—"}</span><span className="text-[11.5px] text-muted-foreground">{t("due {date}", { date: when(h.due_at) })}</span></span>
                  {late ? <Badge tone="red">{t("Late")}</Badge> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </Link></li>
              );
            })}
          </ul>
        )}
      </PortalCard>
      <PortalCard icon={Dumbbell} title={t("Practice")}>
        <p className="text-[13px]">{weakest ? t("Your weakest skill in the last mock was {skill} ({band}). Practise it today.", { skill: t(weakest[0][0].toUpperCase() + weakest[0].slice(1)), band: Number(weakest[1]).toFixed(1) }) : t("Practise a little every day: one reading and one listening.")}</p>
        <Link href={`/student/practice${weakest && (weakest[0] === "reading" || weakest[0] === "listening") ? `?kind=${weakest[0] === "reading" ? "article" : "podcast"}` : ""}`} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[#12392B] px-3.5 text-[12.5px] font-medium text-[#FAF5EF]">{t("Start practice")}</Link>
      </PortalCard>
      <PortalCard icon={CalendarDays} title={t("Lessons this week")}>
        {(lessons.data ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">{t("No lessons in the next 7 days.")}</p> : (
          <ul className="divide-y divide-border/60">{(lessons.data ?? []).map((l) => <li key={l.id} className="flex justify-between py-2 text-[13px]"><span>{(l.groups as unknown as { name: string } | null)?.name}</span><span className="text-muted-foreground">{when(l.starts_at)}</span></li>)}</ul>
        )}
      </PortalCard>
      {(mocks.data ?? []).length > 0 && (
        <PortalCard icon={ClipboardList} title={t("Upcoming mocks")}>
          <ul className="divide-y divide-border/60">{(mocks.data ?? []).map((m) => <li key={m.id} className="flex justify-between py-2 text-[13px]"><span>{m.name}</span><span className="text-muted-foreground">{when(m.scheduled_at)}</span></li>)}</ul>
        </PortalCard>
      )}
    </>
  );
}
