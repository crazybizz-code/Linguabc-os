import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;
export type Skill = "reading" | "listening" | "writing" | "speaking";
export const SKILLS: Skill[] = ["listening", "reading", "writing", "speaking"];

export type Latest = { student_id: string; overall: number | null; reading: number | null; listening: number | null; writing: number | null; speaking: number | null; previous: number | null };

const num = (v: unknown) => (v == null ? null : Number(v));
export const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * What staff need to judge teaching: per group its students, attendance and
 * homework completion; per student the latest mock bands (and the one
 * before, to see the trend). Attendance and homework come from the
 * student_overview view (aggregated in the database), so no row limits
 * apply. RLS decides what each role can read.
 */
export async function academicStats(supabase: Client, center: string) {
  const [groups, enrollments, overview, homework, results, sessions] = await Promise.all([
    supabase.from("group_overview").select("id, name, mentor_id, student_count, branch_id").eq("center_id", center).eq("status", "active").order("name"),
    supabase.from("enrollments").select("student_id, group_id").eq("center_id", center).eq("status", "active"),
    supabase.from("student_overview").select("id, full_name, status, attendance_pct, hw_assigned, hw_completed").eq("center_id", center),
    supabase.from("homework").select("id, group_id, assigned_at").eq("center_id", center).gte("assigned_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
    supabase.from("mock_result_scores").select("student_id, mock_session_id, overall_band, reading_band, listening_band, writing_band, speaking_band").eq("center_id", center),
    supabase.from("mock_sessions").select("id, scheduled_at").eq("center_id", center),
  ]);

  const studentsOf = new Map<string, string[]>();
  const groupOf = new Map<string, string>();
  (enrollments.data ?? []).forEach((e) => { groupOf.set(e.student_id, e.group_id); studentsOf.set(e.group_id, [...(studentsOf.get(e.group_id) ?? []), e.student_id]); });
  const student = new Map((overview.data ?? []).map((s) => [s.id!, s]));
  const attendanceOf = (id: string) => num(student.get(id)?.attendance_pct);
  const homeworkOf = (id: string) => { const s = student.get(id); return s?.hw_assigned ? Math.round((100 * Number(s.hw_completed ?? 0)) / Number(s.hw_assigned)) : null; };

  // latest two mock results with bands, per student
  const when = new Map((sessions.data ?? []).map((s) => [s.id, s.scheduled_at]));
  const byStudent = new Map<string, NonNullable<typeof results.data>>();
  for (const r of results.data ?? []) {
    if (r.overall_band == null && r.reading_band == null && r.listening_band == null) continue;
    byStudent.set(r.student_id!, [...(byStudent.get(r.student_id!) ?? []), r]);
  }
  const latest = new Map<string, Latest>();
  for (const [id, rs] of byStudent) {
    rs.sort((a, b) => String(when.get(b.mock_session_id!)).localeCompare(String(when.get(a.mock_session_id!))));
    const [a, b] = rs;
    latest.set(id, { student_id: id, overall: num(a.overall_band), reading: num(a.reading_band), listening: num(a.listening_band),
      writing: num(a.writing_band), speaking: num(a.speaking_band), previous: b ? num(b.overall_band) : null });
  }

  const round = (x: number | null) => (x == null ? null : Math.round(x));
  const groupRows = (groups.data ?? []).map((g) => {
    const ids = studentsOf.get(g.id!) ?? [];
    const bands = ids.map((s) => latest.get(s)?.overall).filter((x): x is number => x != null);
    return {
      id: g.id!, name: g.name ?? "", mentorId: g.mentor_id, students: Number(g.student_count ?? 0), studentIds: ids,
      attendance: round(mean(ids.map(attendanceOf))), homework: round(mean(ids.map(homeworkOf))),
      band: { min: bands.length ? Math.min(...bands) : null, avg: mean(bands), max: bands.length ? Math.max(...bands) : null, n: bands.length },
      homeworkSet30: (homework.data ?? []).filter((h) => h.group_id === g.id).length,
    };
  });
  return { groups: groupRows, latest, groupOf, student, attendanceOf, homeworkOf };
}
