import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * A learner's progress: attendance, homework and mocks over time.
 *
 * Every query runs as the signed-in user, so Row Level Security decides
 * what is visible: staff see everything about their students, students and
 * parents see their own, and families see a mock only once it is released.
 */
type Client = Awaited<ReturnType<typeof createClient>>;
const TZ = "Asia/Tashkent";
const MONTHS = 6;

export type MonthPoint = { month: string; value: number | null; detail: string };
export type HomeworkRow = { id: string; title: string; skill: string | null; due_at: string; status: string; score: number | null; onTime: boolean | null };
export type MockRow = { name: string; date: string; listening: number | null; reading: number | null; writing: number | null; speaking: number | null; overall: number | null };

/** "2026-11" in Tashkent time. */
const monthKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).slice(0, 7);

function lastMonths(n: number): string[] {
  const now = new Date();
  const [y, m] = monthKey(now.toISOString()).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 15));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export async function loadProgress(supabase: Client, studentId: string) {
  const [att, enr, subs, mocks] = await Promise.all([
    supabase.from("attendance_records").select("status, lessons(starts_at)").eq("student_id", studentId).limit(1000),
    supabase.from("enrollments").select("group_id, start_date, end_date").eq("student_id", studentId),
    supabase.from("submissions").select("homework_id, status, score, submitted_at").eq("student_id", studentId),
    supabase.from("mock_result_scores").select("reading_band, listening_band, writing_band, speaking_band, overall_band, mock_sessions(name, scheduled_at)")
      .eq("student_id", studentId).eq("status", "completed"),
  ]);

  // Homework set for the student's groups while they were in them.
  const enrollments = enr.data ?? [];
  const groupIds = [...new Set(enrollments.map((e) => e.group_id))];
  const hwRes = groupIds.length
    ? await supabase.from("homework").select("id, group_id, assigned_at, due_at, assignments(title, skill)").in("group_id", groupIds).order("due_at", { ascending: false }).limit(300)
    : { data: [] };
  const inGroup = (h: { group_id: string; assigned_at: string }) => enrollments.some((e) =>
    e.group_id === h.group_id && h.assigned_at.slice(0, 10) >= e.start_date && (!e.end_date || h.assigned_at.slice(0, 10) <= e.end_date));
  const subBy = new Map((subs.data ?? []).map((s) => [s.homework_id, s]));
  const now = new Date().toISOString();
  const homework: HomeworkRow[] = (hwRes.data ?? []).filter(inGroup).map((h) => {
    const s = subBy.get(h.id);
    const done = s && (s.status === "submitted" || s.status === "reviewed");
    return {
      id: h.id, title: h.assignments?.title ?? "—", skill: h.assignments?.skill ?? null, due_at: h.due_at,
      status: done ? s!.status : h.due_at < now ? "missed" : (s?.status ?? "not_started"),
      score: done && s!.score != null ? Number(s!.score) : null,
      onTime: done && s!.submitted_at ? s!.submitted_at <= h.due_at : null,
    };
  });
  const due = homework.filter((h) => h.due_at < now || h.status === "submitted" || h.status === "reviewed");
  const doneHw = due.filter((h) => h.status === "submitted" || h.status === "reviewed");
  const scored = doneHw.filter((h) => h.score != null);

  // Months (last six, oldest first).
  const months = lastMonths(MONTHS);
  const attRows = (att.data ?? []).filter((a) => a.lessons?.starts_at);
  const attendanceByMonth: MonthPoint[] = months.map((m) => {
    const rows = attRows.filter((a) => monthKey(a.lessons!.starts_at) === m && a.status !== "excused");
    const came = rows.filter((a) => a.status === "present" || a.status === "late").length;
    return { month: m, value: rows.length ? Math.round((100 * came) / rows.length) : null, detail: rows.length ? `${came}/${rows.length}` : "" };
  });
  const homeworkByMonth: MonthPoint[] = months.map((m) => {
    const xs = scored.filter((h) => monthKey(h.due_at) === m).map((h) => h.score!);
    return { month: m, value: avg(xs), detail: xs.length ? `${xs.length}` : "" };
  });

  const bySkill = [...new Set(scored.map((h) => h.skill ?? "other"))].map((skill) => ({
    skill, avg: avg(scored.filter((h) => (h.skill ?? "other") === skill).map((h) => h.score!)), count: scored.filter((h) => (h.skill ?? "other") === skill).length,
  })).sort((a, b) => b.count - a.count);

  const num = (v: unknown) => (v == null ? null : Number(v));
  const mockRows: MockRow[] = (mocks.data ?? [])
    .map((r) => ({
      name: r.mock_sessions?.name ?? "Mock", date: r.mock_sessions?.scheduled_at ?? "",
      listening: num(r.listening_band), reading: num(r.reading_band), writing: num(r.writing_band), speaking: num(r.speaking_band), overall: num(r.overall_band),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const counted = attRows.filter((a) => a.status !== "excused");
  const attendancePct = counted.length ? Math.round((100 * counted.filter((a) => a.status === "present" || a.status === "late").length) / counted.length) : null;
  const latest = mockRows[mockRows.length - 1]?.overall ?? null;
  const previous = mockRows[mockRows.length - 2]?.overall ?? null;

  return {
    attendancePct,
    attendanceByMonth,
    homework: homework.slice(0, 40),
    homeworkDone: doneHw.length,
    homeworkDue: due.length,
    homeworkOnTimePct: doneHw.length ? Math.round((100 * doneHw.filter((h) => h.onTime).length) / doneHw.length) : null,
    homeworkAvg: avg(scored.map((h) => h.score!)),
    homeworkByMonth,
    bySkill,
    mocks: mockRows,
    latestBand: latest,
    bandChange: latest != null && previous != null ? latest - previous : null,
  };
}

export type Progress = Awaited<ReturnType<typeof loadProgress>>;
