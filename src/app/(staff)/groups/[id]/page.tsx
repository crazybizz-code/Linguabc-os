import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ClipboardCheck, BookOpen, ClipboardList } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Avatar, Badge, Card, buttonSecondary, cn } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Group" };
const TZ = "Asia/Tashkent";
const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** One group: who is in it, how they are doing, and what is coming up. RLS keeps mentors to their own groups. */
export default async function GroupPage({ params }: PageProps<"/groups/[id]">) {
  const { id } = await params;
  const { supabase, workspace, t, locale } = await getStaffContext();
  const L = intlLocale(locale);
  const center = workspace.centerId;
  const { data: g } = await supabase.from("group_overview").select("*").eq("id", id).eq("center_id", center).maybeSingle();
  if (!g) notFound();

  const nowIso = new Date().toISOString();
  const [course, branch, mentor, room, slots, enrollments, homework, lessons, mocks] = await Promise.all([
    supabase.from("courses").select("name, level").eq("id", g.course_id!).maybeSingle(),
    supabase.from("branches").select("id, name").eq("id", g.branch_id!).maybeSingle(),
    g.mentor_id ? supabase.from("memberships").select("full_name").eq("id", g.mentor_id).maybeSingle() : Promise.resolve({ data: null }),
    g.room_id ? supabase.from("rooms").select("name").eq("id", g.room_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("group_schedule_slots").select("weekday, start_time, end_time").eq("group_id", id).order("weekday"),
    supabase.from("enrollments").select("student_id").eq("group_id", id).eq("status", "active"),
    supabase.from("homework").select("id, due_at, assignments(title)").eq("group_id", id).order("due_at", { ascending: false }).limit(8),
    supabase.from("lessons").select("id, starts_at, status").eq("group_id", id).gte("starts_at", nowIso).neq("status", "cancelled").order("starts_at").limit(5),
    supabase.from("mock_sessions").select("id, name, scheduled_at, status").eq("group_id", id).order("scheduled_at", { ascending: false }).limit(5),
  ]);
  const studentIds = (enrollments.data ?? []).map((e) => e.student_id);
  const hwIds = (homework.data ?? []).map((h) => h.id);
  const [roster, subs] = await Promise.all([
    studentIds.length ? supabase.from("student_overview").select("id, full_name, attendance_pct, hw_assigned, hw_completed, last_overall_band, overdue_count").in("id", studentIds).order("full_name") : Promise.resolve({ data: [] }),
    hwIds.length ? supabase.from("submissions").select("homework_id, status").in("homework_id", hwIds) : Promise.resolve({ data: [] as { homework_id: string; status: string }[] }),
  ]);
  const done = new Map<string, number>();
  (subs.data ?? []).forEach((s) => ["submitted", "reviewed"].includes(s.status) && done.set(s.homework_id, (done.get(s.homework_id) ?? 0) + 1));
  const day = (iso: string) => new Date(iso).toLocaleString(L, { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const rows = roster.data ?? [];
  const attendance = avg(rows.map((r) => (r.attendance_pct == null ? null : Number(r.attendance_pct))));
  const hwRate = avg(rows.map((r) => (r.hw_assigned ? Math.round((100 * Number(r.hw_completed ?? 0)) / Number(r.hw_assigned)) : null)));

  return (
    <div className="space-y-5">
      <Link href="/groups" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Groups")}</Link>
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-[-0.03em]">{g.name}</h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {[course.data?.name, course.data?.level, branch.data?.name && t("{name} branch", { name: branch.data.name }), mentor.data?.full_name, room.data?.name].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-[12.5px] text-[#3B4A42]">
              {(slots.data ?? []).map((s) => `${t(WEEKDAYS[s.weekday])} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`).join(", ") || t("No weekly schedule yet")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/attendance" className={buttonSecondary}><ClipboardCheck className="h-4 w-4" /> {t("Attendance")}</Link>
            <Link href="/homework" className={buttonSecondary}><BookOpen className="h-4 w-4" /> {t("Homework")}</Link>
            <Link href="/mocks" className={buttonSecondary}><ClipboardList className="h-4 w-4" /> {t("Mocks")}</Link>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            [t("Students"), `${g.student_count ?? 0}${g.capacity ? ` / ${g.capacity}` : ""}`],
            [t("Attendance"), attendance == null ? "—" : `${attendance}%`],
            [t("Homework done"), hwRate == null ? "—" : `${hwRate}%`],
            [t("Next lesson"), g.next_lesson_at ? day(g.next_lesson_at) : "—"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[12px] bg-[#F5ECE8]/70 px-4 py-3">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{k}</p>
              <p className="mt-1 text-[17px] font-semibold">{v}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <h2 className="border-b border-border/60 px-5 py-4 text-[15px] font-semibold">{t("Students")}</h2>
          {rows.length === 0 ? <p className="px-5 py-4 text-[13px] text-muted-foreground">{t("No students in this group yet.")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[12.5px]">
                <thead><tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.1em] text-[#5F6B66]">
                  {["Student", "Attendance", "Homework", "Last band", ""].map((h, i) => <th key={i} className="px-4 py-3 font-medium first:pl-5">{h && t(h)}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((r) => {
                    const att = r.attendance_pct == null ? null : Number(r.attendance_pct);
                    return (
                      <tr key={r.id} className="hover:bg-white/50">
                        <td className="py-3 pl-5 pr-4"><Link href={`/students/${r.id}`} className="flex items-center gap-3 hover:underline"><Avatar name={r.full_name ?? ""} size="sm" /><span className="font-medium">{r.full_name}</span></Link></td>
                        <td className={cn("px-4 py-3", att != null && att < 70 && "font-medium text-[#B4483D]")}>{att == null ? "—" : `${att}%`}</td>
                        <td className="px-4 py-3">{r.hw_assigned ? `${r.hw_completed ?? 0}/${r.hw_assigned}` : "—"}</td>
                        <td className="px-4 py-3">{r.last_overall_band == null ? "—" : Number(r.last_overall_band).toFixed(1)}</td>
                        <td className="px-4 py-3 text-right">{Number(r.overdue_count ?? 0) > 0 && <Badge tone="red">{t("Overdue")}</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">{t("Upcoming lessons")}</h2>
            {(lessons.data ?? []).length === 0 ? <p className="mt-2 text-[12.5px] text-muted-foreground">{t("No lessons scheduled.")}</p> : (
              <ul className="mt-2 divide-y divide-border/50">
                {(lessons.data ?? []).map((l) => <li key={l.id}><Link href={`/attendance/${l.id}`} className="block py-2 text-[12.5px] hover:underline">{day(l.starts_at)}</Link></li>)}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">{t("Recent homework")}</h2>
            {(homework.data ?? []).length === 0 ? <p className="mt-2 text-[12.5px] text-muted-foreground">{t("No homework set yet.")}</p> : (
              <ul className="mt-2 divide-y divide-border/50">
                {(homework.data ?? []).map((h) => (
                  <li key={h.id}><Link href={`/homework/${h.id}`} className="flex items-center justify-between gap-3 py-2 text-[12.5px] hover:underline">
                    <span className="truncate">{(h.assignments as unknown as { title: string } | null)?.title ?? "—"}</span>
                    <span className="shrink-0 text-muted-foreground">{done.get(h.id) ?? 0}/{rows.length}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">{t("Mocks")}</h2>
            {(mocks.data ?? []).length === 0 ? <p className="mt-2 text-[12.5px] text-muted-foreground">{t("No mocks yet.")}</p> : (
              <ul className="mt-2 divide-y divide-border/50">
                {(mocks.data ?? []).map((m) => (
                  <li key={m.id}><Link href={`/mocks/${m.id}`} className="flex items-center justify-between gap-3 py-2 text-[12.5px] hover:underline">
                    <span className="truncate">{m.name}</span><span className="shrink-0 text-muted-foreground">{day(m.scheduled_at)}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
