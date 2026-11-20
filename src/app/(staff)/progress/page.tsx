import Link from "next/link";
import { ChevronRight, TrendingUp } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card, cn, EmptyState, PageHeader, type Tone } from "@/components/ui/primitives";

export const metadata = { title: "Progress" };

type Row = {
  id: string; name: string; group: string | null; attendance: number | null; hwDone: number; hwAll: number;
  hwAvg: number | null; band: number | null; flag: [string, Tone];
};

/**
 * Every student the signed-in staff member may see (RLS: mentors see their
 * own groups), with the basic signals: attendance, homework done and
 * average, latest mock band. Students who need attention come first.
 */
export default async function ProgressPage({ searchParams }: PageProps<"/progress">) {
  const { group: rawGroup } = await searchParams;
  const { supabase, workspace, t } = await getStaffContext();
  const center = workspace.centerId;
  const [overview, enrollments, subs, groups] = await Promise.all([
    supabase.from("student_overview").select("id, full_name, status, attendance_pct, hw_assigned, hw_completed, last_overall_band").eq("center_id", center).eq("status", "active").limit(1000),
    supabase.from("enrollments").select("student_id, group_id, groups(name)").eq("center_id", center).eq("status", "active"),
    supabase.from("submissions").select("student_id, score").eq("center_id", center).in("status", ["submitted", "reviewed"]).not("score", "is", null).limit(5000),
    supabase.from("groups").select("id, name").eq("center_id", center).eq("status", "active").order("name"),
  ]);
  const group = typeof rawGroup === "string" && (groups.data ?? []).some((g) => g.id === rawGroup) ? rawGroup : "";
  const groupOf = new Map<string, { id: string; name: string }>();
  (enrollments.data ?? []).forEach((e) => groupOf.set(e.student_id, { id: e.group_id, name: e.groups?.name ?? "" }));
  const scores = new Map<string, number[]>();
  (subs.data ?? []).forEach((s) => scores.set(s.student_id, [...(scores.get(s.student_id) ?? []), Number(s.score)]));

  const rows: Row[] = (overview.data ?? [])
    .filter((s) => !group || groupOf.get(s.id!)?.id === group)
    .map((s) => {
      const xs = scores.get(s.id!) ?? [];
      const att = s.attendance_pct == null ? null : Number(s.attendance_pct);
      const all = Number(s.hw_assigned ?? 0), done = Number(s.hw_completed ?? 0);
      const hwRate = all ? done / all : null;
      const flag: [string, Tone] = att != null && att < 75 ? ["At risk", "red"]
        : (att != null && att < 85) || (hwRate != null && hwRate < 0.6) ? ["Needs attention", "amber"]
        : att == null && !all ? ["New", "neutral"] : ["On track", "green"];
      return {
        id: s.id!, name: s.full_name ?? "—", group: groupOf.get(s.id!)?.name ?? null, attendance: att, hwDone: done, hwAll: all,
        hwAvg: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null,
        band: s.last_overall_band == null ? null : Number(s.last_overall_band), flag,
      };
    })
    .sort((a, b) => ["red", "amber", "neutral", "green"].indexOf(a.flag[1]) - ["red", "amber", "neutral", "green"].indexOf(b.flag[1]) || a.name.localeCompare(b.name));
  const counts = { risk: rows.filter((r) => r.flag[1] === "red").length, attention: rows.filter((r) => r.flag[1] === "amber").length };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Performance")} title={t("Progress")}
        description={t("Attendance, homework and mock results for every student, with those who need attention first.")} />
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Link href="/progress" className={cn("rounded-full border px-3 py-1.5", !group ? "border-[#12392B] bg-[#12392B] text-white" : "border-border/80 bg-[#FCF8F4]")}>{t("All groups")}</Link>
        {(groups.data ?? []).map((g) => (
          <Link key={g.id} href={`/progress?group=${g.id}`} className={cn("rounded-full border px-3 py-1.5", group === g.id ? "border-[#12392B] bg-[#12392B] text-white" : "border-border/80 bg-[#FCF8F4]")}>{g.name}</Link>
        ))}
        <span className="ml-auto text-muted-foreground">{t("{a} at risk · {b} need attention", { a: counts.risk, b: counts.attention })}</span>
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={TrendingUp} title={t("No students yet")} description={t("Progress appears once students are enrolled and lessons are marked.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="bg-[#F7F0EA] text-[11px] uppercase tracking-[0.06em] text-[#5F6B66]">
                <tr>{[t("Student"), t("Attendance"), t("Homework done"), t("Homework average"), t("Latest mock"), ""].map((h, i) => <th key={i} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-white/60">
                    <td className="px-4 py-3">
                      <Link href={`/students/${r.id}?tab=progress`} className="font-medium hover:underline">{r.name}</Link>
                      {r.group && <p className="text-[11.5px] text-muted-foreground">{r.group}</p>}
                    </td>
                    <td className={cn("px-4 py-3 tabular-nums", r.attendance != null && r.attendance < 75 && "font-semibold text-[#B4483D]")}>{r.attendance == null ? "—" : `${r.attendance}%`}</td>
                    <td className="px-4 py-3 tabular-nums">{r.hwAll ? `${r.hwDone}/${r.hwAll}` : "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{r.hwAvg == null ? "—" : `${r.hwAvg}%`}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums">{r.band == null ? "—" : r.band.toFixed(1)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Badge tone={r.flag[1]}>{t(r.flag[0])}</Badge>
                        <Link href={`/students/${r.id}?tab=progress`} aria-label={t("Open")}><ChevronRight className="h-4 w-4 text-muted-foreground" /></Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
