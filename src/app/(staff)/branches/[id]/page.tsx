import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Avatar, Badge, Card, cn } from "@/components/ui/primitives";

export const metadata = { title: "Branch" };

/** A branch as a business unit: its groups, mentors and the students who need a decision. */
export default async function BranchPage({ params }: PageProps<"/branches/[id]">) {
  const { id } = await params;
  const { supabase, workspace, isAdmin, t } = await getStaffContext();
  const center = workspace.centerId;
  const { data: b } = await supabase.from("branches").select("id, name, address, phone").eq("id", id).eq("center_id", center).maybeSingle();
  if (!b) notFound();
  const [groups, students, mentors] = await Promise.all([
    supabase.from("group_overview").select("id, name, mentor_id, student_count, capacity").eq("branch_id", id).eq("status", "active").order("name"),
    supabase.from("student_overview").select("id, full_name, status, attendance_pct, overdue_count, open_balance").eq("branch_id", id),
    supabase.from("memberships").select("id, full_name").eq("center_id", center).eq("role", "mentor"),
  ]);
  const mentorName = new Map((mentors.data ?? []).map((m) => [m.id, m.full_name]));
  const active = (students.data ?? []).filter((s) => s.status === "active");
  const watch = active.filter((s) => (s.attendance_pct != null && Number(s.attendance_pct) < 70) || (isAdmin && Number(s.overdue_count ?? 0) > 0));
  const seats = (groups.data ?? []).reduce((n, g) => n + Number(g.capacity ?? 0), 0);
  const filled = (groups.data ?? []).reduce((n, g) => n + Number(g.student_count ?? 0), 0);
  const branchMentors = [...new Set((groups.data ?? []).map((g) => g.mentor_id).filter(Boolean))] as string[];

  return (
    <div className="space-y-5">
      <Link href="/branches" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Branches")}</Link>
      <Card className="p-6">
        <h1 className="text-[24px] font-semibold tracking-[-0.03em]">{b.name}</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{[b.address, b.phone].filter(Boolean).join(" · ") || "—"}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            [t("Active students"), String(active.length)],
            [t("Groups"), String((groups.data ?? []).length)],
            [t("Mentors"), String(branchMentors.length)],
            [t("Seats filled"), seats ? `${filled} / ${seats}` : String(filled)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[12px] bg-[#F5ECE8]/70 px-4 py-3">
              <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{k}</p>
              <p className="mt-1 text-[17px] font-semibold">{v}</p>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <h2 className="border-b border-border/60 px-5 py-4 text-[15px] font-semibold">{t("Groups")}</h2>
          {(groups.data ?? []).length === 0 ? <p className="px-5 py-4 text-[13px] text-muted-foreground">{t("No groups in this branch yet.")}</p> : (
            <ul className="divide-y divide-border/50">
              {(groups.data ?? []).map((g) => (
                <li key={g.id}><Link href={`/groups/${g.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-white/50">
                  <span><span className="block text-[13px] font-medium">{g.name}</span><span className="text-[11.5px] text-muted-foreground">{(g.mentor_id && mentorName.get(g.mentor_id)) || t("No mentor")}</span></span>
                  <span className="text-[12px] text-muted-foreground">{g.student_count ?? 0}{g.capacity ? ` / ${g.capacity}` : ""}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden">
          <h2 className="border-b border-border/60 px-5 py-4 text-[15px] font-semibold">{t("Students who need a decision")}</h2>
          {watch.length === 0 ? <p className="px-5 py-4 text-[13px] text-muted-foreground">{t("Nobody needs attention right now.")}</p> : (
            <ul className="divide-y divide-border/50">
              {watch.map((s) => {
                const att = s.attendance_pct == null ? null : Number(s.attendance_pct);
                return (
                  <li key={s.id}><Link href={`/students/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-white/50">
                    <span className="flex items-center gap-3"><Avatar name={s.full_name ?? ""} size="sm" /><span className="text-[13px] font-medium">{s.full_name}</span></span>
                    <span className="flex gap-1.5">
                      {att != null && att < 70 && <Badge tone="amber">{t("Attendance {n}%", { n: att })}</Badge>}
                      {isAdmin && Number(s.overdue_count ?? 0) > 0 && <Badge tone="red">{t("Overdue")}</Badge>}
                    </span>
                  </Link></li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <p className={cn("text-[11.5px] text-muted-foreground")}>{t("Attendance below 70% or an overdue fee puts a student on this list.")}</p>
    </div>
  );
}
