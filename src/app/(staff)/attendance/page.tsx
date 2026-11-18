import Link from "next/link";
import { CalendarCheck, ChevronRight } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { attendanceWindow, todayISO } from "@/lib/dates";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Attendance" };
const TZ = "Asia/Tashkent";
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

export default async function AttendancePage() {
  const { supabase, workspace } = await getStaffContext();
  const today = todayISO();
  const { now, from, to } = attendanceWindow();

  // RLS limits mentors to the groups they teach.
  const [lessons, groups, enrollments, marks] = await Promise.all([
    supabase.from("lessons").select("id, group_id, starts_at, ends_at, status").eq("center_id", workspace.centerId)
      .neq("status", "cancelled").gte("starts_at", from).lte("starts_at", to).order("starts_at", { ascending: false }),
    supabase.from("groups").select("id, name").eq("center_id", workspace.centerId),
    supabase.from("enrollments").select("group_id").eq("center_id", workspace.centerId).eq("status", "active"),
    supabase.from("attendance_records").select("lesson_id").eq("center_id", workspace.centerId).gte("marked_at", from),
  ]);
  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));
  const size = new Map<string, number>();
  (enrollments.data ?? []).forEach((e) => size.set(e.group_id, (size.get(e.group_id) ?? 0) + 1));
  const marked = new Map<string, number>();
  (marks.data ?? []).forEach((m) => marked.set(m.lesson_id, (marked.get(m.lesson_id) ?? 0) + 1));

  const visible = (lessons.data ?? []).filter((l) => dayKey(l.starts_at) <= today);
  const byDay = new Map<string, typeof visible>();
  visible.forEach((l) => byDay.set(dayKey(l.starts_at), [...(byDay.get(dayKey(l.starts_at)) ?? []), l]));
  const days = [...byDay.keys()].sort().reverse();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Daily operations" title="Attendance" description="Today's lessons first. Open a lesson to mark who came — it takes a few taps per student." />
      {days.length === 0 ? (
        <Card><EmptyState icon={CalendarCheck} title="No lessons yet" description="Lessons appear here once a group has a weekly schedule. Create a group on the Groups page." /></Card>
      ) : (
        days.map((d) => (
          <section key={d}>
            <h2 className="mb-2.5 text-[13px] font-semibold text-[#3B4A42]">{d === today ? "Today" : fmtDay(byDay.get(d)![0].starts_at)}</h2>
            <Card className="divide-y divide-border/60 overflow-hidden">
              {byDay.get(d)!.sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map((l) => {
                const total = size.get(l.group_id) ?? 0;
                const done = marked.get(l.id) ?? 0;
                const started = new Date(l.starts_at).getTime() <= now + 3600000;
                return (
                  <Link key={l.id} href={started ? `/attendance/${l.id}` : "#"} aria-disabled={!started}
                    className={`flex items-center gap-4 px-5 py-3.5 ${started ? "hover:bg-white/60" : "pointer-events-none opacity-60"}`}>
                    <div className="w-[92px] text-[13px] font-medium tabular-nums">{fmtTime(l.starts_at)}–{fmtTime(l.ends_at)}</div>
                    <div className="flex-1">
                      <p className="text-[13.5px] font-medium">{groupName.get(l.group_id) ?? "Group"}</p>
                      <p className="text-[11.5px] text-muted-foreground">{total} students</p>
                    </div>
                    {done > 0 && done >= total ? <Badge tone="green">Marked</Badge> : done > 0 ? <Badge tone="amber">{done}/{total} marked</Badge> : started ? <Badge tone="red">Not marked</Badge> : <Badge tone="neutral">Later today</Badge>}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                );
              })}
            </Card>
          </section>
        ))
      )}
    </div>
  );
}
