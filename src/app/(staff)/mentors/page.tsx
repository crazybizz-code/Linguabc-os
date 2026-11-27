import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Avatar, Badge, Card, EmptyState, PageHeader, cn } from "@/components/ui/primitives";
import { academicStats, mean } from "@/lib/academic/stats";

export const metadata = { title: "Mentors" };

/** Who teaches what, how their cohorts are moving and where they need support. Owner, admin and academic manager. */
type Kpi = {
  mentor_id: string; name: string; status: string; groups: number; active_students: number;
  lessons_due: number; lessons_cancelled: number; attendance_recorded: number; attendance_completion: number | null;
  homework_set: number; homework_expected: number; homework_submitted: number; homework_completion: number | null;
  reviews_needed: number; reviews_done: number; review_completion: number | null; review_hours_avg: number | null;
  mock_band_avg: number | null; mock_band_prev: number | null;
};
const PERIODS = { "30": "Last 30 days", "90": "Last 90 days" } as const;

export default async function MentorsPage({ searchParams }: PageProps<"/mentors">) {
  const { supabase, workspace, isStaff, t } = await getStaffContext();
  const { days: rawDays } = await searchParams;
  const days = rawDays === "90" ? "90" : "30";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (Number(days) - 1) * 86_400_000).toISOString().slice(0, 10);
  if (!isStaff) redirect("/dashboard");
  const center = workspace.centerId;
  const [{ data: mentors }, stats, backlog, kpiRes] = await Promise.all([
    supabase.from("memberships").select("id, full_name, status, email, phone").eq("center_id", center).eq("role", "mentor").neq("status", "suspended").order("full_name"),
    academicStats(supabase, center),
    supabase.from("submissions").select("homework_id, homework!inner(group_id)").eq("center_id", center).eq("status", "submitted"),
    supabase.rpc("mentor_kpis", { p_center: center, p_from: from, p_to: today }),
  ]);
  const kpis = ((kpiRes.data as { mentors?: Kpi[] } | null)?.mentors ?? []) as Kpi[];
  const pct = (v: number | null, of: string) => (v == null ? <span className="text-muted-foreground">—</span> : <span title={of}>{v}%</span>);
  const waiting = new Map<string, number>();
  (backlog.data ?? []).forEach((s) => { const g = (s.homework as unknown as { group_id: string }).group_id; waiting.set(g, (waiting.get(g) ?? 0) + 1); });

  const rows = (mentors ?? []).map((m) => {
    const groups = stats.groups.filter((g) => g.mentorId === m.id);
    const ids = groups.flatMap((g) => g.studentIds);
    const bands = ids.map((s) => stats.latest.get(s)).filter(Boolean);
    const trend = mean(bands.map((b) => (b!.overall != null && b!.previous != null ? b!.overall - b!.previous : null)));
    const att = mean(ids.map(stats.attendanceOf));
    const hw = mean(ids.map(stats.homeworkOf));
    const set30 = groups.reduce((n, g) => n + g.homeworkSet30, 0);
    const toReview = groups.reduce((n, g) => n + (waiting.get(g.id) ?? 0), 0);
    const flags = [
      att != null && att < 75 && "Low attendance",
      hw != null && hw < 60 && "Homework not done",
      groups.length > 0 && set30 === 0 && "No homework in 30 days",
      toReview >= 10 && "Reviews piling up",
    ].filter(Boolean) as string[];
    return { m, groups, students: ids.length, att, hw, band: mean(bands.map((b) => b!.overall)), trend, set30, toReview, flags };
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Teaching quality")} title={t("Mentors")}
        description={t("Who teaches what, how their cohorts are moving and where they need academic support.")} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">{t("Mentor KPIs")}</h2>
            <p className="text-[12px] text-muted-foreground">{t("Counted from lessons, attendance marks, homework and reviews. Not a ranking.")}</p>
          </div>
          <div className="flex gap-2">
            {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((p) => (
              <Link key={p} href={`/mentors?days=${p}`} className={cn("rounded-full border px-3 py-1.5 text-[12px]", p === days ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80 hover:bg-white")}>{t(PERIODS[p])}</Link>
            ))}
          </div>
        </div>
        {kpiRes.error ? <p className="p-5 text-[12.5px] text-[#B4483D]">{t("The figures could not be loaded. Try again.")}</p> : kpis.length === 0 ? (
          <p className="p-5 text-[12.5px] text-muted-foreground">{t("No mentors yet")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[12.5px]">
              <thead><tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.1em] text-[#5F6B66]">
                {["Mentor", "Groups / students", "Attendance recorded", "Lessons cancelled", "Homework set", "Homework handed in", "Reviews done", "Avg review time", "Released mock band"].map((h) => <th key={h} className="px-4 py-3 font-medium first:pl-5">{t(h)}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {kpis.map((k) => (
                  <tr key={k.mentor_id}>
                    <td className="py-3 pl-5 pr-4 font-medium">{k.name}</td>
                    <td className="px-4 py-3">{k.groups} / {k.active_students}</td>
                    <td className={cn("px-4 py-3", k.attendance_completion != null && k.attendance_completion < 90 && "font-medium text-[#9A5B1E]")}>
                      {pct(k.attendance_completion, "")} <span className="text-muted-foreground">({k.attendance_recorded}/{k.lessons_due})</span></td>
                    <td className="px-4 py-3">{k.lessons_cancelled}</td>
                    <td className="px-4 py-3">{k.homework_set}</td>
                    <td className="px-4 py-3">{pct(k.homework_completion, "")} <span className="text-muted-foreground">({k.homework_submitted}/{k.homework_expected})</span></td>
                    <td className="px-4 py-3">{pct(k.review_completion, "")} <span className="text-muted-foreground">({k.reviews_done}/{k.reviews_needed})</span></td>
                    <td className="px-4 py-3">{k.review_hours_avg == null ? "—" : t("{n} h", { n: k.review_hours_avg })}</td>
                    <td className="px-4 py-3">{k.mock_band_avg == null ? "—" : Number(k.mock_band_avg).toFixed(1)}
                      {k.mock_band_prev != null && <span className="text-muted-foreground"> ({t("before")}: {Number(k.mock_band_prev).toFixed(1)})</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="border-t border-border/60 px-5 py-3 text-[12px] text-muted-foreground">
          <summary className="cursor-pointer font-medium text-[#3B4A42]">{t("How each figure is counted")}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{t("Attendance recorded: the mentor's lessons in the period that have started and were not cancelled, and how many of them have attendance marked.")}</li>
            <li>{t("Homework handed in: homework of the mentor's groups that was due in the period; work handed in out of the students enrolled now.")}</li>
            <li>{t("Reviews done: work handed in during the period that the system could not mark by itself, and how much of it the mentor has reviewed.")}</li>
            <li>{t("Avg review time: hours from hand-in to review, for reviewed work.")}</li>
            <li>{t("Released mock band: average overall band of released mocks of the mentor's groups, and the period before. For context only — results depend on more than the mentor.")}</li>
          </ul>
        </details>
      </Card>

      {rows.length === 0 ? (
        <Card><EmptyState icon={GraduationCap} title={t("No mentors yet")} description={t("Invite mentors on the Staff page.")} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-[12.5px]">
              <thead><tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.1em] text-[#5F6B66]">
                {["Mentor", "Groups", "Students", "Attendance", "Homework done", "Homework set (30 days)", "To review", "Average band", "Trend", "Needs support"].map((h) => <th key={h} className="px-4 py-3 font-medium first:pl-5">{t(h)}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((r) => (
                  <tr key={r.m.id} className="align-top hover:bg-white/50">
                    <td className="py-3 pl-5 pr-4">
                      <div className="flex items-center gap-3"><Avatar name={r.m.full_name} size="sm" />
                        <div><p className="text-[13px] font-medium">{r.m.full_name}</p>{r.m.status === "invited" && <Badge tone="amber">{t("Invited")}</Badge>}</div></div>
                    </td>
                    <td className="px-4 py-3">{r.groups.length ? r.groups.map((g, i) => <span key={g.id}>{i > 0 && ", "}<Link href={`/groups/${g.id}`} className="hover:underline">{g.name}</Link></span>) : "—"}</td>
                    <td className="px-4 py-3">{r.students}</td>
                    <td className={cn("px-4 py-3", r.att != null && r.att < 75 && "font-medium text-[#B4483D]")}>{r.att == null ? "—" : `${Math.round(r.att)}%`}</td>
                    <td className={cn("px-4 py-3", r.hw != null && r.hw < 60 && "font-medium text-[#B4483D]")}>{r.hw == null ? "—" : `${Math.round(r.hw)}%`}</td>
                    <td className="px-4 py-3">{r.set30}</td>
                    <td className="px-4 py-3">{r.toReview}</td>
                    <td className="px-4 py-3">{r.band == null ? "—" : r.band.toFixed(1)}</td>
                    <td className={cn("px-4 py-3", r.trend != null && (r.trend > 0 ? "text-[#3F6B4A]" : r.trend < 0 ? "text-[#B4483D]" : ""))}>{r.trend == null ? "—" : `${r.trend > 0 ? "+" : ""}${r.trend.toFixed(1)}`}</td>
                    <td className="px-4 py-3">{r.flags.length ? <div className="flex flex-wrap gap-1">{r.flags.map((f) => <Badge key={f} tone="amber">{t(f)}</Badge>)}</div> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="text-[11.5px] text-muted-foreground">{t("Trend is the change between each student's last two mocks, averaged. Flags: attendance under 75%, homework done under 60%, no homework set in 30 days, 10 or more submissions waiting for review.")}</p>
    </div>
  );
}
