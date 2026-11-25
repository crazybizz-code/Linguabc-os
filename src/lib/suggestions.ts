// Rule-based study suggestions for a student (V1: no AI, no cost).
// Pure: takes the student's own progress (loaded under their own session,
// src/lib/progress.ts) and returns at most three suggestions, most urgent
// first. Each one carries an English text key and values, translated by the
// page. Thresholds are deliberately simple and explained in the text.

export type SuggestionInput = {
  now: string;                                   // ISO
  attendancePct: number | null;
  attendanceCounted: number;                     // lessons counted in attendancePct
  homework: { id: string; title: string; skill: string | null; due_at: string; status: string; onTime: boolean | null }[];
  bySkill: { skill: string; avg: number | null; count: number }[];
  latestMock: { reading: number | null; listening: number | null; writing: number | null; speaking: number | null; overall: number | null } | null;
};

export type Suggestion = {
  kind: "missed_homework" | "attendance" | "weak_skill_homework" | "weak_skill_mock" | "late_homework" | "keep_going";
  text: string;                                  // English key, {placeholders}
  vars: Record<string, string | number>;
  href: string | null;
  priority: number;                              // lower = more urgent
};

const SKILLS = ["reading", "listening", "writing", "speaking"] as const;
const DAY = 86_400_000;
const practiceHref = (skill: string) =>
  skill === "reading" ? "/student/practice?kind=article" : skill === "listening" ? "/student/practice?kind=podcast" : "/student/practice";

export function suggest(p: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  const now = Date.parse(p.now);

  // 1. homework missed in the last 30 days
  const missed = p.homework.filter((h) => h.status === "missed" && now - Date.parse(h.due_at) <= 30 * DAY)
    .sort((a, b) => b.due_at.localeCompare(a.due_at));
  if (missed.length) {
    out.push({ kind: "missed_homework", priority: 1, href: `/student/homework/${missed[0].id}`,
      text: missed.length === 1 ? "You missed “{title}”. Open it and finish it — it still counts for your progress."
                                : "You missed {n} homework tasks this month. Start with “{title}”.",
      vars: { n: missed.length, title: missed[0].title } });
  }

  // 2. attendance below 80% (only once there are enough lessons to judge)
  if (p.attendancePct != null && p.attendanceCounted >= 4 && p.attendancePct < 80) {
    out.push({ kind: "attendance", priority: 2, href: "/student/schedule",
      text: "Your attendance is {pct}%. Coming to every lesson is the fastest way to improve; check your timetable.",
      vars: { pct: p.attendancePct } });
  }

  // 3. weakest homework skill (at least 2 marked tasks, average under 60%)
  const weakHw = p.bySkill.filter((s) => (SKILLS as readonly string[]).includes(s.skill) && s.count >= 2 && s.avg != null && s.avg < 60)
    .sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0))[0];
  if (weakHw) {
    out.push({ kind: "weak_skill_homework", priority: 3, href: practiceHref(weakHw.skill),
      text: "Your {skill} homework average is {avg}%. Do one {skill} practice today.",
      vars: { skill: weakHw.skill, avg: Math.round(weakHw.avg!) } });
  }

  // 4. weakest skill in the latest released mock (half a band below overall, or under 5.5)
  if (p.latestMock && p.latestMock.overall != null) {
    const bands = SKILLS.map((s) => [s, p.latestMock![s]] as const).filter(([, b]) => b != null) as [string, number][];
    const weakest = bands.sort((a, b) => a[1] - b[1])[0];
    if (weakest && (weakest[1] <= p.latestMock.overall - 0.5 || weakest[1] < 5.5) && weakest[0] !== weakHw?.skill) {
      out.push({ kind: "weak_skill_mock", priority: 4, href: practiceHref(weakest[0]),
        text: "In your last mock, {skill} was {band} (overall {overall}). Practise {skill} this week.",
        vars: { skill: weakest[0], band: weakest[1].toFixed(1), overall: p.latestMock.overall.toFixed(1) } });
    }
  }

  // 5. handing in late (3+ handed in, under 70% on time)
  const handed = p.homework.filter((h) => h.onTime != null);
  const onTime = handed.filter((h) => h.onTime).length;
  if (handed.length >= 3 && onTime / handed.length < 0.7) {
    out.push({ kind: "late_homework", priority: 5, href: "/student/homework",
      text: "{late} of your last {n} homework tasks were handed in late. Start each one the day it is set.",
      vars: { late: handed.length - onTime, n: handed.length } });
  }

  if (!out.length) {
    out.push({ kind: "keep_going", priority: 9, href: "/student/practice",
      text: "You are on track. Keep it up with one short practice a day.", vars: {} });
  }
  return out.sort((a, b) => a.priority - b.priority).slice(0, 3);
}
