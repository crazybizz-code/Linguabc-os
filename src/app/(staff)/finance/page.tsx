import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card, EmptyState, PageHeader, cn, formatUZS } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";
import { todayISO } from "@/lib/dates";
import { AddExpense, VoidExpense } from "./expense-forms";
import { CATEGORY_LABEL, type ExpenseCategory } from "./categories";

export const metadata = { title: "Finance" };

type Result = {
  from: string; to: string; timezone: string;
  payments_received: number; refunds: number; collected: number;
  expenses: number; expense_count: number; net_cash_result: number;
  by_category: Record<string, number>;
  months: { month: string; collected: number; expenses: number }[];
  receivables_now: { outstanding: number; overdue: number };
};

const PERIODS = { month: "This month", last: "Last month", quarter: "Last 3 months", year: "Last 12 months" } as const;
function range(p: keyof typeof PERIODS, today: string): [string, string] {
  const [y, m, d] = today.split("-").map(Number);
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  if (p === "last") return [iso(y, m - 1, 1), iso(y, m, 0)];
  if (p === "quarter") return [iso(y, m - 2, 1), iso(y, m, d)];
  if (p === "year") return [iso(y, m - 11, 1), iso(y, m, d)];
  return [iso(y, m, 1), iso(y, m, d)];
}

/**
 * Owner only. Net cash-based operating result = payments received (minus
 * refunds) − recorded operating expenses, by the date money moved. All
 * figures come from the database (cash_operating_result, migration 0034).
 */
export default async function FinancePage({ searchParams }: PageProps<"/finance">) {
  const { supabase, workspace, t, locale } = await getStaffContext();
  if (workspace.role !== "owner") redirect("/dashboard");
  const L = intlLocale(locale);
  const { period: raw } = await searchParams;
  const period = (typeof raw === "string" && raw in PERIODS ? raw : "month") as keyof typeof PERIODS;
  const { data: centre } = await supabase.from("centers").select("timezone").eq("id", workspace.centerId).single();
  const today = todayISO(centre?.timezone ?? "Asia/Tashkent");
  const [from, to] = range(period, today);
  const [res, list] = await Promise.all([
    supabase.rpc("cash_operating_result", { p_center: workspace.centerId, p_from: from, p_to: to }),
    supabase.from("expenses").select("id, spent_on, category, amount, description, voided_at, void_reason, corrects, replaced_by")
      .eq("center_id", workspace.centerId).gte("spent_on", from).lte("spent_on", to)
      .order("spent_on", { ascending: false }).order("created_at", { ascending: false }).limit(500),
  ]);
  if (res.error || !res.data) return <p className="text-[13px] text-[#B4483D]">{t("The figures could not be loaded. Try again.")}</p>;
  const r = res.data as unknown as Result;
  const day = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(L, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const monthName = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString(L, { month: "short", year: "numeric", timeZone: "UTC" });
  const cats = Object.entries(r.by_category).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Owner")} title={t("Finance")}
        description={t("Money in, money out, and what is left — counted by the day the money moved.")}
        actions={<AddExpense today={today} />} />

      <div className="flex flex-wrap gap-2">
        {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((p) => (
          <Link key={p} href={`/finance?period=${p}`} className={cn("rounded-full border px-3 py-1.5 text-[12px]", p === period ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80 hover:bg-white")}>{t(PERIODS[p])}</Link>
        ))}
        <span className="self-center text-[12px] text-muted-foreground">{day(from)} – {day(to)}</span>
      </div>

      <Card className="grid divide-border/60 sm:grid-cols-3 sm:divide-x">
        <Figure label={t("Payments received")} value={formatUZS(r.collected)} hint={r.refunds > 0 ? t("after {n} in refunds", { n: formatUZS(r.refunds) }) : t("cash, card and transfers recorded at the desk")} />
        <Figure label={t("Recorded operating expenses")} value={formatUZS(r.expenses)} hint={t("{n} entries", { n: r.expense_count })} />
        <Figure label={t("Net cash-based operating result")} value={formatUZS(r.net_cash_result)} tone={r.net_cash_result < 0 ? "bad" : "good"}
          hint={t("Payments received minus recorded expenses")} />
      </Card>
      <p className="-mt-3 text-[12px] leading-relaxed text-muted-foreground">
        {t("This is a cash measure, not accounting profit: it has no accruals, depreciation or taxes, and it only knows the expenses recorded here. Unpaid invoices are not income until they are paid.")}
      </p>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="border-b border-border/60 px-5 py-4"><h2 className="text-[15px] font-semibold">{t("By month")}</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-[12.5px]">
              <thead><tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.1em] text-[#5F6B66]">
                <th className="px-5 py-3 font-medium">{t("Month")}</th><th className="px-4 py-3 text-right font-medium">{t("Received")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("Expenses")}</th><th className="px-5 py-3 text-right font-medium">{t("Net cash result")}</th>
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {r.months.map((m) => {
                  const net = m.collected - m.expenses;
                  return (
                    <tr key={m.month}><td className="px-5 py-2.5">{monthName(m.month)}</td>
                      <td className="px-4 py-2.5 text-right">{formatUZS(m.collected)}</td><td className="px-4 py-2.5 text-right">{formatUZS(m.expenses)}</td>
                      <td className={cn("px-5 py-2.5 text-right font-medium", net < 0 && "text-[#B4483D]")}>{formatUZS(net)}</td></tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">{t("Expenses by category")}</h2>
            {cats.length === 0 ? <p className="mt-2 text-[12.5px] text-muted-foreground">{t("No expenses recorded in this period.")}</p> : (
              <ul className="mt-3 space-y-2 text-[12.5px]">
                {cats.map(([c, v]) => <li key={c} className="flex justify-between"><span>{t(CATEGORY_LABEL[c as ExpenseCategory] ?? c)}</span><span className="font-medium">{formatUZS(v)}</span></li>)}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">{t("Receivables today")}</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">{t("Invoiced but not yet paid. Not part of the result above.")}</p>
            <dl className="mt-3 space-y-2 text-[12.5px]">
              <div className="flex justify-between"><dt>{t("Outstanding")}</dt><dd className="font-medium">{formatUZS(r.receivables_now.outstanding)}</dd></div>
              <div className="flex justify-between"><dt>{t("of which overdue")}</dt><dd className="font-medium text-[#B4483D]">{formatUZS(r.receivables_now.overdue)}</dd></div>
            </dl>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-5 py-4"><h2 className="text-[15px] font-semibold">{t("Expenses in this period")}</h2></div>
        {(list.data ?? []).length === 0 ? (
          <EmptyState icon={Receipt} title={t("No expenses recorded")} description={t("Record rent, salaries and bills to see the net cash-based operating result.")} />
        ) : (
          <ul className="divide-y divide-border/50">
            {(list.data ?? []).map((e) => {
              const voided = !!e.voided_at;
              return (
                <li key={e.id} className={cn("flex flex-wrap items-center justify-between gap-3 px-5 py-3", voided && "opacity-60")}>
                  <div className="min-w-[220px]">
                    <p className={cn("text-[13px] font-medium", voided && "line-through")}>{e.description}</p>
                    <p className="text-[12px] text-muted-foreground">{day(e.spent_on)} · {t(CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category)}
                      {e.corrects && ` · ${t("correction")}`}</p>
                    {voided && <p className="text-[11.5px] text-[#9A5B1E]">{t("Void")}: {e.void_reason === "corrected" ? t("replaced by a correction") : e.void_reason}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[13px] font-semibold", voided && "line-through")}>{formatUZS(e.amount)}</span>
                    {voided ? <Badge tone="neutral">{t("Void")}</Badge> : (
                      <>
                        <AddExpense today={today} corrects={e} />
                        <VoidExpense id={e.id} label={`${e.description} · ${formatUZS(e.amount)}`} />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="p-5">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{label}</p>
      <p className={cn("mt-2 text-[24px] font-semibold tracking-[-0.03em]", tone === "bad" && "text-[#B4483D]")}>{value}</p>
      {hint && <p className="mt-1 text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
