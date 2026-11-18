import "server-only";
import type { PortalContext } from "./context";

/**
 * Everything a parent or student sees about one learner. Every query
 * runs as the signed-in user, so RLS limits it to what they may see.
 */
export async function loadSummary(ctx: PortalContext, studentId: string) {
  const { supabase } = ctx;
  const [enrollment, attendance, submissions, mock, invoices, payments, activities] = await Promise.all([
    supabase.from("enrollments").select("group_id, start_date, monthly_fee, groups(id, name, room_id, branch_id, courses(name), branches(name), rooms(name))")
      .eq("student_id", studentId).eq("status", "active").order("start_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("attendance_records").select("id, status, marked_at, lessons(starts_at)").eq("student_id", studentId).order("marked_at", { ascending: false }).limit(60),
    supabase.from("submissions").select("status, submitted_at, homework(assignments(title))").eq("student_id", studentId),
    supabase.from("mock_result_scores").select("reading_band, listening_band, writing_band, speaking_band, overall_band, updated_at, mock_sessions(name, scheduled_at)")
      .eq("student_id", studentId).eq("status", "completed").order("updated_at", { ascending: false }).limit(2),
    supabase.from("invoice_balances").select("*").eq("student_id", studentId).order("period", { ascending: false }),
    supabase.from("payments").select("id, kind, amount, method, receipt_no, paid_at, invoice_id").eq("student_id", studentId).order("paid_at", { ascending: false }),
    supabase.from("activities").select("id, type, title, detail, occurred_at").eq("student_id", studentId).order("occurred_at", { ascending: false }).limit(8),
  ]);

  const group = enrollment.data?.groups ?? null;
  const [mentor, nextLesson] = await Promise.all([
    group ? supabase.rpc("group_mentor_name", { p_group: group.id }) : Promise.resolve({ data: null }),
    group
      ? supabase.from("lessons").select("starts_at, ends_at, rooms(name)").eq("group_id", group.id).eq("status", "scheduled")
          .gt("starts_at", new Date().toISOString()).order("starts_at").limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const att = attendance.data ?? [];
  const counted = att.filter((a) => a.status !== "excused");
  const attendancePct = counted.length
    ? Math.round((100 * counted.filter((a) => a.status === "present" || a.status === "late").length) / counted.length)
    : null;
  const subs = submissions.data ?? [];
  const hwDone = subs.filter((s) => s.status === "submitted" || s.status === "reviewed");
  const lastDone = hwDone.filter((s) => s.submitted_at).sort((a, b) => b.submitted_at!.localeCompare(a.submitted_at!))[0];

  return {
    group,
    course: group?.courses?.name ?? null,
    branch: group?.branches?.name ?? null,
    mentor: (mentor.data as string | null) ?? null,
    nextLesson: nextLesson.data,
    attendance: att,
    attendancePct,
    lastFive: att.slice(0, 5).reverse(),
    homework: { done: hwDone.length, total: subs.length, lastTitle: lastDone?.homework?.assignments?.title ?? null, lastAt: lastDone?.submitted_at ?? null },
    mocks: mock.data ?? [],
    invoices: invoices.data ?? [],
    payments: payments.data ?? [],
    activities: activities.data ?? [],
  };
}

export type Summary = Awaited<ReturnType<typeof loadSummary>>;
