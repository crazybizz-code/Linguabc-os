import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current";
import { Avatar, Badge, Card, PageHeader, cn } from "@/components/ui/primitives";
import { academicStats, mean, SKILLS } from "@/lib/academic/stats";

export const metadata = { title: "Academic analytics" };
const band = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));

/** The cohort's skill profile, group-by-group band spreads and where intervention changes outcomes. */
export default async function AnalyticsPage() {
  const { supabase, workspace, isStaff, t } = await getStaffContext();
  if (!isStaff) redirect("/dashboard");
  const stats = await academicStats(supabase, workspace.centerId);
  const latest = [...stats.latest.values()];
  const profile = SKILLS.map((s) => ({ skill: s, avg: mean(latest.map((l) => l[s])), n: latest.filter((l) => l[s] != null).length }));
  const weakest = [...profile].filter((p) => p.avg != null).sort((a, b) => a.avg! - b.avg!)[0];

  // Intervention: active students whose numbers say a conversation now changes the outcome.
  const risk = [...stats.student.values()].filter((s) => s.status === "active").map((s) => {
    const l = stats.latest.get(s.id!);
    const att = stats.attendanceOf(s.id!), hw = stats.homeworkOf(s.id!);
    const reasons = [
      att != null && att < 70 && t("Attendance {n}%", { n: Math.round(att) }),
      hw != null && hw < 50 && t("Homework {n}%", { n: hw }),
      l?.overall != null && l.previous != null && l.overall < l.previous && t("Band down {a} → {b}", { a: band(l.previous), b: band(l.overall) }),
    ].filter(Boolean) as string[];
    return { id: s.id!, name: s.full_name ?? "—", reasons, group: stats.groups.find((g) => g.id === stats.groupOf.get(s.id!)) };
  }).filter((r) => r.reasons.length > 0).sort((a, b) => b.reasons.length - a.reasons.length).slice(0, 30);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Academic intelligence")} title={t("Academic analytics")}
        description={t("Skill profile of the cohort, group-by-group band spreads and where intervention actually changes outcomes.")} />

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold">{t("Skill profile")}</h2>
          <p className="text-[12px] text-muted-foreground">{t("Latest mock of each student · {n} students", { n: latest.length })}</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {profile.map((p) => (
            <div key={p.skill} className={cn("rounded-[14px] border px-4 py-3", weakest?.skill === p.skill ? "border-[#E7D3B5] bg-[#FBF3E6]" : "border-border/70 bg-white/50")}>
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{t(p.skill[0].toUpperCase() + p.skill.slice(1))}</p>
              <p className="mt-1 text-[26px] font-semibold tracking-[-0.03em]">{band(p.avg)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F5ECE8]"><div className="h-full rounded-full bg-[#12392B]" style={{ width: `${((p.avg ?? 0) / 9) * 100}%` }} /></div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{weakest?.skill === p.skill ? t("Weakest skill — focus homework here") : t("{n} results", { n: p.n })}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="border-b border-border/60 px-5 py-4 text-[15px] font-semibold">{t("Groups")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12.5px]">
            <thead><tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.1em] text-[#5F6B66]">
              {["Group", "Students", "Attendance", "Homework done", "Band spread", "Average band"].map((h) => <th key={h} className="px-4 py-3 font-medium first:pl-5">{t(h)}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border/50">
              {stats.groups.map((g) => (
                <tr key={g.id} className="hover:bg-white/50">
                  <td className="py-3 pl-5 pr-4 font-medium"><Link href={`/groups/${g.id}`} className="hover:underline">{g.name}</Link></td>
                  <td className="px-4 py-3">{g.students}</td>
                  <td className={cn("px-4 py-3", g.attendance != null && g.attendance < 75 && "text-[#B4483D]")}>{g.attendance == null ? "—" : `${g.attendance}%`}</td>
                  <td className={cn("px-4 py-3", g.homework != null && g.homework < 60 && "text-[#B4483D]")}>{g.homework == null ? "—" : `${g.homework}%`}</td>
                  <td className="px-4 py-3">
                    {g.band.n ? (
                      <div className="flex items-center gap-2">
                        <span className="w-7 text-right text-muted-foreground">{band(g.band.min)}</span>
                        <div className="relative h-1.5 w-32 rounded-full bg-[#F5ECE8]">
                          <div className="absolute h-1.5 rounded-full bg-[#12392B]/70" style={{ left: `${(g.band.min! / 9) * 100}%`, width: `${Math.max(2, ((g.band.max! - g.band.min!) / 9) * 100)}%` }} />
                        </div>
                        <span className="w-7 text-muted-foreground">{band(g.band.max)}</span>
                      </div>
                    ) : <span className="text-muted-foreground">{t("No mocks yet")}</span>}
                  </td>
                  <td className="px-4 py-3 font-medium">{band(g.band.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-5 py-4">
          <h2 className="text-[15px] font-semibold">{t("Where intervention helps")}</h2>
          <p className="text-[12px] text-muted-foreground">{t("Active students with attendance under 70%, homework under 50% or a falling band.")}</p>
        </div>
        {risk.length === 0 ? <p className="px-5 py-4 text-[13px] text-muted-foreground">{t("Nobody needs attention right now.")}</p> : (
          <ul className="divide-y divide-border/50">
            {risk.map((r) => (
              <li key={r.id}><Link href={`/students/${r.id}?tab=progress`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-white/50">
                <span className="flex items-center gap-3"><Avatar name={r.name} size="sm" /><span><span className="block text-[13px] font-medium">{r.name}</span><span className="text-[11.5px] text-muted-foreground">{r.group?.name ?? "—"}</span></span></span>
                <span className="flex flex-wrap gap-1">{r.reasons.map((x) => <Badge key={x} tone="amber">{x}</Badge>)}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
