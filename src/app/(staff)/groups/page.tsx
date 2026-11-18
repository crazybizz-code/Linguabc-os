import Link from "next/link";
import { BookOpen, CalendarDays, Layers, Users } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card, EmptyState, PageHeader, Progress, cn, formatUZS } from "@/components/ui/primitives";
import { CreateCourse, CreateGroup } from "./create-group";

export const metadata = { title: "Groups & courses" };
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hhmm = (t: string) => t.slice(0, 5);

export default async function GroupsPage({ searchParams }: PageProps<"/groups">) {
  const { tab } = await searchParams;
  const showCourses = tab === "courses";
  const { supabase, workspace, isStaff } = await getStaffContext();
  const center = workspace.centerId;

  const [groups, courses, branches, mentors, rooms, slots, attendance] = await Promise.all([
    supabase.from("group_overview").select("*").eq("center_id", center).eq("status", "active").order("name"),
    supabase.from("courses").select("id, name, code, level, duration_weeks, default_monthly_fee").eq("center_id", center).order("name"),
    supabase.from("branches").select("id, name").eq("center_id", center).eq("status", "active").order("name"),
    supabase.from("memberships").select("id, full_name").eq("center_id", center).eq("role", "mentor").in("status", ["active", "invited"]).order("full_name"),
    supabase.from("rooms").select("id, name").eq("center_id", center),
    supabase.from("group_schedule_slots").select("group_id, weekday, start_time, end_time").eq("center_id", center),
    supabase.from("attendance_records").select("status, lessons!inner(group_id)").eq("center_id", center),
  ]);

  const name = <T extends { id: string }>(rows: T[] | null, key: keyof T) => new Map((rows ?? []).map((r) => [r.id, String(r[key])]));
  const courseName = name(courses.data, "name");
  const branchName = name(branches.data, "name");
  const mentorName = name(mentors.data, "full_name");
  const roomName = name(rooms.data, "name");
  const gr = groups.data ?? [];

  const tabs = (
    <div className="flex rounded-[11px] border border-border/70 bg-[#FCF8F4] p-1 text-[12.5px]">
      {[["Groups", "/groups", !showCourses], ["Courses", "/groups?tab=courses", showCourses]].map(([label, href, on]) => (
        <Link key={label as string} href={href as string} className={cn("rounded-[8px] px-3 py-1.5", on ? "bg-[#F5ECE8] font-medium text-[#17211D]" : "text-muted-foreground")}>
          {label as string}
        </Link>
      ))}
    </div>
  );
  const createGroup = isStaff && (
    <CreateGroup
      courses={(courses.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
      branches={(branches.data ?? []).map((b) => ({ id: b.id, name: b.name }))}
      mentors={(mentors.data ?? []).map((m) => ({ id: m.id, name: m.full_name }))}
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Academic operations"
        title="Groups & courses"
        description="Every running group, its mentor, room and rhythm — and the course structure behind them."
        actions={<>{tabs}{isStaff && (showCourses ? <CreateCourse /> : createGroup)}</>}
      />

      {showCourses ? (
        (courses.data ?? []).length === 0 ? (
          <Card><EmptyState icon={BookOpen} title="No courses yet" description="Create the programmes you teach — e.g. IELTS Foundation, General English B1. Every group follows one course." action={isStaff && <CreateCourse />} /></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(courses.data ?? []).map((c) => (
              <Card key={c.id} className="p-5">
                <div className="flex items-start justify-between">
                  <h3 className="text-[15px] font-semibold">{c.name}</h3>
                  {c.level && <Badge tone="neutral" dot={false}>{c.level}</Badge>}
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{c.code}</p>
                <div className="mt-4 space-y-1.5 text-[12.5px] text-muted-foreground">
                  <p>{c.duration_weeks ? `${c.duration_weeks} weeks` : "Open-ended"}</p>
                  <p>{formatUZS(c.default_monthly_fee)} / month</p>
                  <p>{gr.filter((g) => g.course_id === c.id).length} groups running</p>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : gr.length === 0 ? (
        <Card><EmptyState icon={Layers} title="No groups yet" description="Create your first group to start scheduling lessons and enrolling students." action={createGroup} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {gr.map((g) => {
            const gs = (slots.data ?? []).filter((s) => s.group_id === g.id);
            const days = [...new Set(gs.map((s) => s.weekday))].sort().map((d) => DAY[d]).join(" / ");
            const time = gs[0] ? `${hhmm(gs[0].start_time)}–${hhmm(gs[0].end_time)}` : null;
            const att = (attendance.data ?? []).filter((a) => a.lessons?.group_id === g.id);
            const marked = att.filter((a) => a.status !== "excused");
            const pct = marked.length ? Math.round((100 * marked.filter((a) => a.status === "present" || a.status === "late").length) / marked.length) : null;
            const full = g.capacity != null && (g.student_count ?? 0) >= g.capacity;
            const tone = pct != null && pct < 85 ? "amber" : "green";
            return (
              <Card key={g.id} className="p-5">
                <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{g.name}</h3>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {courseName.get(g.course_id!)} · {branchName.get(g.branch_id!)}
                </p>
                <div className="mt-4 space-y-2 text-[12.5px] text-[#3B4A42]">
                  <p className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
                    <span className={full ? "font-medium text-[#9A5B1E]" : ""}>{g.student_count} / {g.capacity ?? "∞"}</span>
                    {g.room_id && <span className="text-muted-foreground">· Room {roomName.get(g.room_id)}</span>}
                  </p>
                  <p className="flex items-center gap-2">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
                    {days ? `${days} · ${time}` : "No weekly schedule"}
                  </p>
                </div>
                <div className="mt-4 border-t border-border/60 pt-3">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-muted-foreground">Attendance</span>
                    <span className="font-medium">{pct == null ? "—" : `${pct}%`}</span>
                  </div>
                  <div className="mt-2"><Progress value={pct} tone={tone} /></div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">{g.mentor_id ? mentorName.get(g.mentor_id) : "No mentor"}</span>
                  {full ? <Badge tone="amber">At capacity</Badge> : pct != null && pct < 85 ? <Badge tone="red">Needs attention</Badge> : <Badge tone="green">On track</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
