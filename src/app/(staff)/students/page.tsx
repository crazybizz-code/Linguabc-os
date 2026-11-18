import { getStaffContext } from "@/lib/auth/current";
import { Card, PageHeader } from "@/components/ui/primitives";
import { AddStudent, type GroupOption } from "./add-student";
import { StudentsTable, type StudentRow } from "./students-table";

export const metadata = { title: "Students" };

export default async function StudentsPage() {
  const { supabase, workspace, isAdmin, t } = await getStaffContext();
  const center = workspace.centerId;

  const [students, enrollments, groups, courses, branches, mentors, invoices] = await Promise.all([
    supabase.from("student_overview").select("*").eq("center_id", center).order("full_name"),
    supabase.from("enrollments").select("student_id, group_id").eq("center_id", center).eq("status", "active"),
    supabase.from("group_overview").select("id, name, course_id, mentor_id, capacity, student_count").eq("center_id", center).eq("status", "active").order("name"),
    supabase.from("courses").select("id, name, default_monthly_fee").eq("center_id", center),
    supabase.from("branches").select("id, name").eq("center_id", center).eq("status", "active").order("name"),
    supabase.from("memberships").select("id, full_name").eq("center_id", center).eq("role", "mentor"),
    isAdmin ? supabase.from("invoice_balances").select("student_id").eq("center_id", center) : Promise.resolve({ data: [] as { student_id: string | null }[] }),
  ]);

  const byId = <T extends { id: string | null }>(rows: T[] | null) => new Map((rows ?? []).map((r) => [r.id!, r]));
  const groupMap = byId(groups.data);
  const courseMap = byId(courses.data);
  const branchMap = byId(branches.data);
  const mentorMap = byId(mentors.data);
  const enrolledIn = new Map<string, string>();
  (enrollments.data ?? []).forEach((e) => enrolledIn.set(e.student_id, e.group_id));
  const invoiced = new Set((invoices.data ?? []).map((i) => i.student_id));

  const rows: StudentRow[] = (students.data ?? []).map((s) => {
    const g = groupMap.get(enrolledIn.get(s.id!) ?? "");
    const att = s.attendance_pct == null ? null : Number(s.attendance_pct);
    const payment: StudentRow["payment"] = !isAdmin
      ? null
      : (s.overdue_count ?? 0) > 0
        ? "Overdue"
        : (s.open_balance ?? 0) > 0
          ? "Pending"
          : invoiced.has(s.id)
            ? "Paid"
            : "Lead";
    return {
      id: s.id!,
      name: s.full_name!,
      phone: s.phone,
      branch: branchMap.get(s.branch_id ?? "")?.name ?? "—",
      course: g ? courseMap.get(g.course_id!)?.name ?? "—" : "—",
      group: g?.name ?? "—",
      groupId: g?.id ?? "",
      mentor: g?.mentor_id ? mentorMap.get(g.mentor_id)?.full_name ?? "—" : "—",
      attendance: att,
      payment,
      academic: att == null ? "New" : att < 75 ? "At risk" : att < 85 ? "Needs attention" : "On track",
      status: s.status ?? "",
      lastActivity: s.last_activity_at,
    };
  });

  const groupOptions: GroupOption[] = (groups.data ?? []).map((g) => ({
    id: g.id!,
    name: g.name!,
    courseName: courseMap.get(g.course_id!)?.name ?? "",
    fee: Number(courseMap.get(g.course_id!)?.default_monthly_fee ?? 0),
    seatsLeft: g.capacity == null ? null : Math.max(0, g.capacity - (g.student_count ?? 0)),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Student directory")}
        title={t("Students")}
        description={t("Every enrolled student — academic standing, attendance and payment in one row.")}
        actions={isAdmin && <AddStudent groups={groupOptions} branches={branches.data ?? []} />}
      />
      <Card className="overflow-hidden">
        <StudentsTable rows={rows} showPayment={isAdmin} />
      </Card>
    </div>
  );
}
