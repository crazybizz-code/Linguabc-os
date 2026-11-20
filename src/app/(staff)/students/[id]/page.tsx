import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowUpRight, ChevronLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { siteUrl } from "@/lib/supabase/config";
import { Avatar, Badge, Card, Progress, buttonPrimary, cn, formatUZS, prettyNumbers, type Tone } from "@/components/ui/primitives";
import { CopyLink } from "../../staff/invite-staff";
import { RecordPayment } from "../../payments/record-payment";
import { inviteParentLogin, inviteStudentLogin } from "../../actions";
import { LoginInvite } from "./login-invite";
import { intlLocale } from "@/i18n";
import { loadProgress } from "@/lib/progress";
import { ProgressView } from "@/components/progress/progress-view";

export const metadata = { title: "Student" };
const TZ = "Asia/Tashkent";
const TABS = ["overview", "progress", "attendance", "payments", "parent"] as const;
const PAY_TONE: Record<string, Tone> = { paid: "green", partial: "amber", pending: "amber", overdue: "red", void: "neutral" };
const ATT_TONE: Record<string, Tone> = { present: "green", late: "amber", absent: "red", excused: "neutral" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Bank transfer", click: "Click", payme: "Payme", uzum: "Uzum" };

export default async function StudentPage({ params, searchParams }: PageProps<"/students/[id]">) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const { supabase, isAdmin, t, locale } = await getStaffContext();
  const L = intlLocale(locale);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(L, { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
  const fmtDT = (iso: string) => new Date(iso).toLocaleString(L, { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const { data: student } = await supabase.from("students").select("*, branches(name), memberships!students_membership_id_center_id_fkey(status, invite_code)").eq("id", id).maybeSingle();
  if (!student) notFound();
  const tabs = TABS.filter((t) => t !== "payments" || isAdmin);
  const tab = (tabs as readonly string[]).includes(String(rawTab)) ? (rawTab as (typeof TABS)[number]) : "overview";

  const [overview, enrollments, guardians, attendance, activities, mock, invoices, payments] = await Promise.all([
    supabase.from("student_overview").select("*").eq("id", id).maybeSingle(),
    supabase.from("enrollments").select("id, group_id, start_date, monthly_fee, discount_percent, due_day, status, groups(name, mentor_id, course_id, courses(name))").eq("student_id", id).order("start_date", { ascending: false }),
    supabase.from("guardians").select("id, full_name, phone, relationship, is_primary, membership_id, memberships!guardians_membership_id_center_id_fkey(status, invite_code)").eq("student_id", id),
    supabase.from("attendance_records").select("id, status, note, lessons(starts_at, groups(name))").eq("student_id", id).order("marked_at", { ascending: false }).limit(60),
    supabase.from("activities").select("id, type, title, detail, occurred_at").eq("student_id", id).order("occurred_at", { ascending: false }).limit(20),
    supabase.from("mock_result_scores").select("reading_band, listening_band, writing_band, speaking_band, overall_band").eq("student_id", id).eq("status", "completed").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    isAdmin ? supabase.from("invoice_balances").select("*").eq("student_id", id).order("period", { ascending: false }) : Promise.resolve({ data: null }),
    isAdmin ? supabase.from("payments").select("id, kind, amount, method, receipt_no, paid_at, invoice_id").eq("student_id", id).order("paid_at", { ascending: false }) : Promise.resolve({ data: null }),
  ]);

  const active = (enrollments.data ?? []).find((e) => e.status === "active");
  const groupId = active?.group_id;
  const [mentor, nextLesson] = await Promise.all([
    active?.groups?.mentor_id ? supabase.from("memberships").select("full_name").eq("id", active.groups.mentor_id).maybeSingle() : Promise.resolve({ data: null }),
    groupId ? supabase.from("lessons").select("starts_at").eq("group_id", groupId).eq("status", "scheduled").gt("starts_at", new Date().toISOString()).order("starts_at").limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const o = overview.data;
  const att = o?.attendance_pct == null ? null : Number(o.attendance_pct);
  const academic = att == null ? ["New", "neutral"] : att < 75 ? ["At risk", "red"] : att < 85 ? ["Needs attention", "amber"] : ["On track", "green"];
  const latestInvoice = (invoices.data ?? [])[0];
  const primary = (guardians.data ?? []).find((g) => g.is_primary) ?? (guardians.data ?? [])[0];
  const studentLogin = student.memberships;
  const course = active?.groups?.courses?.name;

  return (
    <div className="space-y-5">
      <Link href="/students" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Students")}</Link>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="scale-[1.6] origin-left pr-6"><Avatar name={student.full_name} /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[24px] font-semibold tracking-[-0.03em]">{student.full_name}</h1>
                <Badge tone={student.status === "active" ? "green" : "neutral"}>{t(cap(student.status))}</Badge>
                <Badge tone={academic[1] as Tone}>{t(academic[0])}</Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {[course, active?.groups?.name, mentor.data?.full_name, student.branches?.name && t("{name} branch", { name: student.branches.name })].filter(Boolean).join(" · ") || t("Not in a group yet")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && !studentLogin && <LoginInvite label={t("Invite student")} field="student_id" value={student.id} action={inviteStudentLogin} who={student.full_name} />}
            {isAdmin && primary && !primary.membership_id && <LoginInvite label={t("Invite parent")} field="guardian_id" value={primary.id} action={inviteParentLogin} who={primary.full_name} />}
            {groupId && <Link href="/groups" className={`${buttonPrimary} h-9 text-[12.5px]`}>{t("Open group")} <ArrowUpRight className="h-4 w-4" /></Link>}
          </div>
        </div>
        <nav className="flex gap-1 border-t border-border/60 px-4">
          {tabs.map((tb) => (
            <Link key={tb} href={`/students/${id}${tb === "overview" ? "" : `?tab=${tb}`}`}
              className={cn("border-b-2 px-3 py-3 text-[13px]", tab === tb ? "border-[#12392B] font-medium text-[#17211D]" : "border-transparent text-muted-foreground hover:text-[#17211D]")}>
              {t(cap(tb))}
            </Link>
          ))}
        </nav>
      </Card>

      {tab === "overview" && (
        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <Card className="grid grid-cols-2 divide-border/60 md:grid-cols-4 md:divide-x">
              {[
                [t("Attendance"), att == null ? "—" : `${att}%`, active?.groups?.name ?? "", att != null && att < 85],
                [t("Homework"), `${o?.hw_completed ?? 0} / ${o?.hw_assigned ?? 0}`, t("completed"), false],
                ...(isAdmin ? [[t("Payment"), latestInvoice ? t(cap(latestInvoice.payment_status ?? "")) : "—", latestInvoice ? t("due {date}", { date: latestInvoice.due_date }) : t("no invoices"), latestInvoice?.payment_status === "overdue"]] : []),
                [t("Next lesson"), nextLesson.data ? new Date(nextLesson.data.starts_at).toLocaleTimeString(L, { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "—",
                  nextLesson.data ? new Date(nextLesson.data.starts_at).toLocaleDateString(L, { timeZone: TZ, weekday: "long", day: "numeric", month: "short" }) : t("none scheduled"), false],
              ].map(([label, value, hint, warn]) => (
                <div key={label as string} className="p-5">
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{label}</p>
                  <p className={cn("mt-2 text-[24px] font-semibold tracking-[-0.03em]", warn && "text-[#9A5B1E]")}>{value}</p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">{hint}</p>
                </div>
              ))}
            </Card>
            <Card className="p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold">{t("Recent activity")}</h2>
                <span className="text-[11.5px] text-muted-foreground">{t("{n} events", { n: (activities.data ?? []).length })}</span>
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t("Everything that happened on this record, newest first.")}</p>
              {(activities.data ?? []).length === 0 ? (
                <p className="py-8 text-center text-[12.5px] text-muted-foreground">{t("No activity recorded yet.")}</p>
              ) : (
                <ul className="mt-4 divide-y divide-border/60">
                  {(activities.data ?? []).map((a) => (
                    <li key={a.id} className="flex justify-between gap-4 py-2.5">
                      <div className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5F6B66]" />
                        <div><p className="text-[13px] font-medium">{t(a.title)}</p>{a.detail && <p className="text-[12px] text-muted-foreground">{prettyNumbers(a.detail)}</p>}</div>
                      </div>
                      <span className="shrink-0 text-[11.5px] text-muted-foreground">{fmtDate(a.occurred_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="space-y-5">
            {att != null && att < 85 && (
              <Card className="flex gap-3 border-[#F0C9C2] bg-[#FBEDEA] p-4">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B4483D]" />
                <div><p className="text-[13px] font-semibold text-[#B4483D]">{t("Needs attention")}</p><p className="mt-0.5 text-[12px] text-[#8F3B32]">{t("Attendance is {p}%. Talk to the student or parent before it affects progress.", { p: att })}</p></div>
              </Card>
            )}
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold">{t("Current bands")}</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{mock.data ? t("Latest mock · overall {band}", { band: mock.data.overall_band }) : t("No mock results yet")}</p>
              {mock.data && (
                <div className="mt-4 space-y-3">
                  {(["reading", "listening", "writing", "speaking"] as const).map((s) => {
                    const v = mock.data![`${s}_band`];
                    return (
                      <div key={s}>
                        <div className="flex justify-between text-[12.5px]"><span className="text-muted-foreground">{t(cap(s))}</span><span className="font-semibold">{v ?? "—"}</span></div>
                        <div className="mt-1.5"><Progress value={v == null ? 0 : (Number(v) / 9) * 100} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold">{t("Record")}</h2>
              <dl className="mt-3 divide-y divide-border/60 text-[12.5px]">
                {[
                  [t("Branch"), student.branches?.name],
                  [t("Course"), course],
                  [t("Group"), active?.groups?.name],
                  [t("Mentor"), mentor.data?.full_name],
                  [t("Enrolled"), active?.start_date],
                  ...(isAdmin ? [[t("Monthly fee"), active ? `${formatUZS(active.monthly_fee)}${Number(active.discount_percent) ? ` · −${Number(active.discount_percent)}%` : ""}` : null]] : []),
                  [t("Phone"), student.phone],
                  [t("Parent"), primary?.full_name],
                  [t("Parent phone"), primary?.phone],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v || "—"}</dd></div>
                ))}
              </dl>
            </Card>
          </div>
        </div>
      )}

      {tab === "progress" && <ProgressView p={await loadProgress(supabase, id)} t={t} locale={L} />}

      {tab === "attendance" && (
        <Card className="overflow-hidden">
          {(attendance.data ?? []).length === 0 ? (
            <p className="p-8 text-center text-[12.5px] text-muted-foreground">{t("No attendance marked yet.")}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {(attendance.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div><p className="text-[13px] font-medium">{r.lessons ? fmtDT(r.lessons.starts_at) : "—"}</p><p className="text-[12px] text-muted-foreground">{r.lessons?.groups?.name}{r.note ? ` · ${r.note}` : ""}</p></div>
                  <Badge tone={ATT_TONE[r.status]}>{t(cap(r.status))}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "payments" && isAdmin && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <h2 className="border-b border-border/60 px-5 py-3.5 text-[14px] font-semibold">{t("Invoices")}</h2>
            {(invoices.data ?? []).length === 0 ? <p className="p-6 text-[12.5px] text-muted-foreground">{t("No invoices yet.")}</p> : (
              <ul className="divide-y divide-border/60">
                {(invoices.data ?? []).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-[13px] font-medium">{new Date(`${i.period}T00:00:00Z`).toLocaleString(L, { month: "long", year: "numeric", timeZone: "UTC" })}</p>
                      <p className="text-[12px] text-muted-foreground">{formatUZS(Number(i.amount))} · {t("due {date}", { date: i.due_date })}{Number(i.balance) > 0 ? ` · ${t("{amount} left", { amount: formatUZS(Number(i.balance)) })}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={PAY_TONE[i.payment_status ?? "pending"]}>{t(cap(i.payment_status ?? ""))}</Badge>
                      {Number(i.balance) > 0 && i.payment_status !== "void" && <RecordPayment compact invoiceId={i.id!} student={student.full_name} balance={Number(i.balance)} period={i.period!.slice(0, 7)} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="overflow-hidden">
            <h2 className="border-b border-border/60 px-5 py-3.5 text-[14px] font-semibold">{t("Payments & receipts")}</h2>
            {(payments.data ?? []).length === 0 ? <p className="p-6 text-[12.5px] text-muted-foreground">{t("No payments recorded yet.")}</p> : (
              <ul className="divide-y divide-border/60">
                {(payments.data ?? []).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div><p className="text-[13px] font-medium">{p.kind === "refund" ? "−" : ""}{formatUZS(p.amount)}</p><p className="text-[12px] text-muted-foreground">{fmtDate(p.paid_at)} · {t(METHOD_LABEL[p.method] ?? p.method)}</p></div>
                    <Link href={`/payments/receipt/${p.id}`} target="_blank" className="font-mono text-[12px] text-[#12392B] hover:underline">{p.receipt_no}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "parent" && (
        <Card className="overflow-hidden">
          {(guardians.data ?? []).length === 0 ? <p className="p-8 text-center text-[12.5px] text-muted-foreground">{t("No parent recorded.")}</p> : (
            <ul className="divide-y divide-border/60">
              {(guardians.data ?? []).map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={g.full_name} />
                    <div><p className="text-[13.5px] font-medium">{g.full_name}{g.is_primary && <span className="ml-2 text-[11px] text-muted-foreground">{t("primary")}</span>}</p><p className="text-[12px] text-muted-foreground">{[g.relationship && t(cap(g.relationship)), g.phone].filter(Boolean).join(" · ")}</p></div>
                  </div>
                  <div className="min-w-[260px]">
                    {g.memberships?.status === "active" ? <Badge tone="green">{t("Parent portal active")}</Badge>
                      : g.memberships?.status === "invited" && g.memberships.invite_code ? <CopyLink link={`${siteUrl()}/join?code=${g.memberships.invite_code}`} />
                      : isAdmin ? <LoginInvite label={t("Invite to parent portal")} field="guardian_id" value={g.id} action={inviteParentLogin} who={g.full_name} /> : <Badge tone="neutral">{t("No portal access")}</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
