import Link from "next/link";
import { ArrowUpRight, BarChart3, Building2, Check, GraduationCap, Layers, Target, Users } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { ROLE_LABEL } from "@/lib/auth/workspace";
import { monthStartISO } from "@/lib/dates";
import { Card, PageHeader, Progress, StatCard, buttonPrimary, buttonSecondary, formatUZS } from "@/components/ui/primitives";

export const metadata = { title: "Overview" };

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default async function OverviewPage() {
  const { supabase, workspace, isAdmin, isStaff } = await getStaffContext();
  const center = workspace.centerId;
  const monthStart = monthStartISO();

  const [branches, students, groups, mentors, courses, mocks, scores, activities, invoices] = await Promise.all([
    supabase.from("branches").select("id, name").eq("center_id", center).eq("status", "active").order("name"),
    supabase.from("student_overview").select("id, branch_id, status, attendance_pct, joined_on").eq("center_id", center),
    supabase.from("group_overview").select("id, branch_id, mentor_id, capacity, student_count").eq("center_id", center).eq("status", "active"),
    supabase.from("memberships").select("id, status").eq("center_id", center).eq("role", "mentor"),
    supabase.from("courses").select("id").eq("center_id", center),
    supabase.from("mock_sessions").select("status").eq("center_id", center),
    supabase.from("mock_result_scores").select("overall_band").eq("center_id", center).eq("status", "completed"),
    supabase.from("activities").select("id, title, detail, occurred_at, students(full_name)").eq("center_id", center).order("occurred_at", { ascending: false }).limit(6),
    isAdmin
      ? supabase.from("invoice_balances").select("amount, paid, balance, payment_status").eq("center_id", center).eq("period", monthStart)
      : Promise.resolve({ data: null }),
  ]);

  const st = students.data ?? [];
  const gr = groups.data ?? [];
  const br = branches.data ?? [];
  const activeStudents = st.filter((s) => s.status === "active");
  const allMentors = (mentors.data ?? []).filter((m) => m.status !== "suspended");
  const invitedMentors = allMentors.filter((m) => m.status === "invited").length;
  const atCapacity = gr.filter((g) => g.capacity && (g.student_count ?? 0) >= g.capacity).length;
  const completedMocks = (mocks.data ?? []).filter((m) => m.status === "completed").length;
  const scheduledMocks = (mocks.data ?? []).filter((m) => m.status === "scheduled").length;
  const bands = (scores.data ?? []).map((s) => Number(s.overall_band)).filter((b) => !Number.isNaN(b));
  const avgBand = bands.length ? (bands.reduce((a, b) => a + b, 0) / bands.length).toFixed(1) : "—";
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  const setup = [
    { done: br.length > 0, label: "Add your first branch", href: "/branches" },
    { done: (courses.data ?? []).length > 0, label: "Create a course", href: "/groups?tab=courses" },
    { done: (mentors.data ?? []).length > 0, label: "Invite mentors", href: "/staff" },
    { done: gr.length > 0, label: "Create a group with its weekly schedule", href: "/groups" },
    { done: st.length > 0, label: "Add students", href: "/students" },
  ];
  const setupLeft = setup.filter((s) => !s.done).length;

  const inv = invoices.data ?? [];
  const billed = inv.reduce((a, i) => a + Number(i.amount), 0);
  const collected = inv.reduce((a, i) => a + Number(i.paid), 0);
  const outstanding = inv.filter((i) => i.payment_status !== "paid" && i.payment_status !== "void").reduce((a, i) => a + Number(i.balance), 0);
  const overdue = inv.filter((i) => i.payment_status === "overdue").length;
  const newThisMonth = st.filter((s) => (s.joined_on ?? "") >= monthStart).length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`${ROLE_LABEL[workspace.role]} · Centre overview`}
        title={workspace.centerName}
        description={`${br.length} ${br.length === 1 ? "branch" : "branches"} · ${st.length} students · ${allMentors.length} mentors. How each branch is performing, and where a decision is needed.`}
        actions={
          isStaff && (
            <>
              <Link href="/branches" className={buttonSecondary}>
                <Building2 className="h-4 w-4" strokeWidth={1.8} /> Branches
              </Link>
              <Link href="/students" className={buttonPrimary}>
                Students <ArrowUpRight className="h-4 w-4" />
              </Link>
            </>
          )
        }
      />

      {isStaff && setupLeft > 0 && (
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Set up {workspace.centerName}</h2>
            <span className="text-[12px] text-muted-foreground">{setup.length - setupLeft} of {setup.length} done</span>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {setup.map((s, i) => (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className={`flex h-full items-start gap-2.5 rounded-[12px] border p-3 text-[12.5px] transition-colors ${
                    s.done ? "border-[#CFE0CB] bg-[#EEF4EB] text-[#3F6B4A]" : "border-border/70 bg-white/60 text-[#17211D] hover:border-[#12392B]/30"
                  }`}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold ${s.done ? "bg-[#3F6B4A] text-white" : "bg-[#EFE6DF] text-[#3B4A42]"}`}>
                    {s.done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                  </span>
                  {s.label}
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Active students" value={activeStudents.length} hint={`of ${st.length} enrolled`} icon={Users} />
        <StatCard label="Mentors" value={allMentors.length} hint={invitedMentors ? `${invitedMentors} yet to accept invite` : `teaching ${gr.length} groups`} icon={GraduationCap} />
        <StatCard label="Active groups" value={gr.length} hint={`${atCapacity} at capacity`} icon={Layers} />
        <StatCard label="Mocks completed" value={completedMocks} hint={`${scheduledMocks} scheduled`} icon={Target} />
        <StatCard label="Average band" value={avgBand} hint="across all students" icon={BarChart3} />
      </div>

      {br.length > 0 && (
        <section>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Branch performance</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Each branch as its own business — its groups, mentors and students.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {br.map((b) => {
              const bs = st.filter((s) => s.branch_id === b.id);
              const bg = gr.filter((g) => g.branch_id === b.id);
              const bm = new Set(bg.map((g) => g.mentor_id).filter(Boolean)).size;
              const att = avg(bs.map((s) => s.attendance_pct));
              const active = bs.length ? Math.round((100 * bs.filter((s) => s.status === "active").length) / bs.length) : 0;
              const attention = bs.filter((s) => s.attendance_pct != null && s.attendance_pct < 85).length;
              return (
                <Card key={b.id} className="p-5">
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">Branch</p>
                  <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em]">{b.name}</h3>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <p className="text-[30px] font-semibold leading-none tracking-[-0.03em]">{bs.length}</p>
                      <p className="mt-1.5 text-[12px] text-muted-foreground">students · {active}% active</p>
                    </div>
                    <div className="text-right text-[12px] text-muted-foreground">
                      <p><span className="text-[#17211D]">{bm}</span> mentors</p>
                      <p><span className="text-[#17211D]">{bg.length}</span> groups</p>
                    </div>
                  </div>
                  <div className="mt-5 flex justify-between text-[12px]">
                    <span className="text-muted-foreground">Attendance</span>
                    <span className="font-medium">{att == null ? "—" : `${att}%`}</span>
                  </div>
                  <div className="mt-2"><Progress value={att} /></div>
                  {attention > 0 && <p className="mt-3 text-[12px] text-[#9A5B1E]">{attention} need attention</p>}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Recent activity</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">What the centre recorded lately, across every module.</p>
          {(activities.data ?? []).length === 0 ? (
            <p className="mt-6 rounded-[12px] bg-[#F5ECE8]/70 p-4 text-[12.5px] text-muted-foreground">
              Nothing yet. Enrolments, attendance, payments and homework will appear here as they happen.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border/60">
              {(activities.data ?? []).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5F6B66]" />
                    <div>
                      <p className="text-[13px] font-medium">{a.title}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {a.students?.full_name}
                        {a.detail ? ` · ${a.detail}` : ""}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">{timeAgo(a.occurred_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isAdmin && (
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">Business snapshot</h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">Collections and enrolment this month.</p>
            <div className="mt-4 rounded-[14px] bg-[#F5ECE8]/70 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] text-muted-foreground">Collected</span>
                <span className="text-[19px] font-semibold tracking-[-0.02em]">{formatUZS(collected)}</span>
              </div>
              <div className="mt-3"><Progress value={billed ? (100 * collected) / billed : 0} /></div>
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                {billed ? Math.round((100 * collected) / billed) : 0}% of {formatUZS(billed)} billed
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className={`rounded-[14px] border p-4 ${overdue ? "border-[#F0C9C2] bg-[#FBEDEA]" : "border-border/70"}`}>
                <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">Outstanding</p>
                <p className="mt-1.5 text-[19px] font-semibold">{formatUZS(outstanding)}</p>
                <p className={`mt-1 text-[11.5px] ${overdue ? "text-[#B4483D]" : "text-muted-foreground"}`}>{overdue} overdue invoices</p>
              </div>
              <div className="rounded-[14px] border border-border/70 p-4">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">New this month</p>
                <p className="mt-1.5 text-[19px] font-semibold">{newThisMonth}</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">students joined</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
