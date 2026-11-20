import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Avatar, Badge, Card, EmptyState, PageHeader, cn } from "@/components/ui/primitives";
import { academicStats, mean } from "@/lib/academic/stats";

export const metadata = { title: "Mentors" };

/** Who teaches what, how their cohorts are moving and where they need support. Owner, admin and academic manager. */
export default async function MentorsPage() {
  const { supabase, workspace, isStaff, t } = await getStaffContext();
  if (!isStaff) redirect("/dashboard");
  const center = workspace.centerId;
  const [{ data: mentors }, stats, backlog] = await Promise.all([
    supabase.from("memberships").select("id, full_name, status, email, phone").eq("center_id", center).eq("role", "mentor").neq("status", "suspended").order("full_name"),
    academicStats(supabase, center),
    supabase.from("submissions").select("homework_id, homework!inner(group_id)").eq("center_id", center).eq("status", "submitted"),
  ]);
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
