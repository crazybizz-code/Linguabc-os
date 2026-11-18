import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current";
import { monthStartISO } from "@/lib/dates";
import { Card, PageHeader, cn } from "@/components/ui/primitives";
import { PaymentsTable, type InvoiceRow } from "./payments-table";
import { RunBilling } from "./run-billing";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Payments" };

const shift = (period: string, n: number) => {
  const d = new Date(`${period}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const { supabase, workspace, isAdmin, t, locale } = await getStaffContext();
  const label = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" });
  const monthOnly = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleString(intlLocale(locale), { month: "long", timeZone: "UTC" });
  if (!isAdmin) redirect("/dashboard");
  const { month } = await searchParams;
  const current = monthStartISO();
  const period = typeof month === "string" && /^\d{4}-\d{2}-01$/.test(month) ? month : current;
  const center = workspace.centerId;

  const [inv, students, enrollments, groups, guardians, payments] = await Promise.all([
    supabase.from("invoice_balances").select("*").eq("center_id", center).eq("period", period),
    supabase.from("students").select("id, full_name").eq("center_id", center),
    supabase.from("enrollments").select("id, group_id").eq("center_id", center),
    supabase.from("groups").select("id, name").eq("center_id", center),
    supabase.from("guardians").select("student_id, full_name, is_primary").eq("center_id", center),
    supabase.from("payments").select("id, invoice_id, kind, amount, paid_at").eq("center_id", center).order("paid_at", { ascending: false }),
  ]);
  const studentName = new Map((students.data ?? []).map((s) => [s.id, s.full_name]));
  const enrollGroup = new Map((enrollments.data ?? []).map((e) => [e.id, e.group_id]));
  const groupName = new Map((groups.data ?? []).map((g) => [g.id, g.name]));
  const parent = new Map<string, string>();
  (guardians.data ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).forEach((g) => !parent.has(g.student_id) && parent.set(g.student_id, g.full_name));
  const lastPay = new Map<string, { id: string; date: string }>();
  (payments.data ?? []).forEach((p) => p.kind === "payment" && p.invoice_id && !lastPay.has(p.invoice_id) && lastPay.set(p.invoice_id, { id: p.id, date: p.paid_at.slice(0, 10) }));

  const rows: InvoiceRow[] = (inv.data ?? [])
    .map((i) => ({
      id: i.id!,
      studentId: i.student_id!,
      student: studentName.get(i.student_id!) ?? "—",
      group: groupName.get(enrollGroup.get(i.enrollment_id!) ?? "") ?? "—",
      amount: Number(i.amount),
      balance: Number(i.balance),
      dueDate: i.due_date!,
      status: i.payment_status as InvoiceRow["status"],
      lastPayment: lastPay.get(i.id!)?.date ?? null,
      lastPaymentId: lastPay.get(i.id!)?.id ?? null,
      parent: parent.get(i.student_id!) ?? "—",
    }))
    .sort((a, b) => a.student.localeCompare(b.student));

  const nextMonth = shift(period, 1);
  const monthPayments = (payments.data ?? []).filter((p) => p.paid_at.slice(0, 10) >= period && p.paid_at.slice(0, 10) < nextMonth);
  const collected = monthPayments.reduce((a, p) => a + (p.kind === "payment" ? Number(p.amount) : -Number(p.amount)), 0);
  const sumBy = (s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.balance, 0);
  const countBy = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;

  const kpis = [
    { label: t("Collected this month"), value: short(collected), hint: t("{n} payments", { n: monthPayments.filter((p) => p.kind === "payment").length }), red: false },
    { label: t("Pending"), value: short(sumBy(["pending"])), hint: t("{n} students", { n: countBy(["pending"]) }), red: false },
    { label: t("Overdue"), value: short(sumBy(["overdue"])), hint: t("{n} students", { n: countBy(["overdue"]) }), red: countBy(["overdue"]) > 0 },
    { label: t("Partial"), value: short(sumBy(["partial"])), hint: t("{n} partly paid", { n: countBy(["partial"]) }), red: false },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Administrative operations")}
        title={t("Payments")}
        description={t("Student tuition — who has paid, who hasn't, and what to do about it.")}
        actions={<RunBilling period={period} label={monthOnly(period)} />}
      />
      <Card className="grid grid-cols-2 divide-border/60 xl:grid-cols-4 xl:divide-x">
        {kpis.map((k) => (
          <div key={k.label} className="p-5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{k.label}</p>
            <p className={cn("mt-2 text-[24px] font-semibold tracking-[-0.03em]", k.red && "text-[#B4483D]")}>
              {k.value} <span className="text-[11px] font-medium text-muted-foreground">UZS</span>
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">{k.hint}</p>
          </div>
        ))}
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 pt-4 pb-3 text-[12.5px]">
          <Link href={`/payments?month=${shift(period, -1)}`} className="rounded-[8px] border border-border/80 px-2.5 py-1 hover:bg-white">←</Link>
          <span className="min-w-[120px] text-center font-medium">{label(period)}</span>
          <Link href={`/payments?month=${nextMonth}`} className="rounded-[8px] border border-border/80 px-2.5 py-1 hover:bg-white">→</Link>
          {period !== current && <Link href="/payments" className="ml-2 text-[#12392B] hover:underline">{t("This month")}</Link>}
        </div>
        <PaymentsTable rows={rows} periodLabel={label(period)} />
      </Card>
    </div>
  );
}
