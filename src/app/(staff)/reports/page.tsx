import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current";
import { Card, PageHeader, cn, formatUZS } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Reports" };

type Report = {
  money: { collected: number; payments: number; refunds: number; by_method: Record<string, number> };
  invoices: { invoiced: number; outstanding: number; overdue: number; overdue_students: number };
  attendance: { present: number; absent: number; excused: number; rate: number | null };
  lessons: { held: number; cancelled: number };
  students: { active: number; joined: number; left: number };
  capacity: { seats: number; filled: number; groups: number };
  academic: { homework_set: number; submitted: number; average_score: number | null; mocks: number; average_band: number | null };
  months: { month: string; collected: number; invoiced: number }[];
};

const PERIODS = { month: "This month", last: "Last month", quarter: "Last 3 months", year: "Last 12 months" } as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);
function range(p: keyof typeof PERIODS) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tashkent" }));
  const y = now.getFullYear(), m = now.getMonth();
  if (p === "last") return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
  if (p === "quarter") return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(new Date(Date.UTC(y, m, now.getDate())))];
  if (p === "year") return [iso(new Date(Date.UTC(y, m - 11, 1))), iso(new Date(Date.UTC(y, m, now.getDate())))];
  return [iso(new Date(Date.UTC(y, m, 1))), iso(new Date(Date.UTC(y, m, now.getDate())))];
}

/** The centre in numbers: collections, attendance, capacity and academic output over one period. Owner and admin. */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const { supabase, workspace, isAdmin, t, locale } = await getStaffContext();
  if (!isAdmin) redirect("/dashboard");
  const L = intlLocale(locale);
  const { period: raw } = await searchParams;
  const period = (typeof raw === "string" && raw in PERIODS ? raw : "month") as keyof typeof PERIODS;
  const [from, to] = range(period);
  const { data, error } = await supabase.rpc("center_report", { p_center: workspace.centerId, p_from: from, p_to: to });
  if (error || !data) return <p className="text-[13px] text-[#B4483D]">{t("The report could not be loaded. Try again.")}</p>;
  const r = data as unknown as Report;
  const max = Math.max(1, ...r.months.map((m) => Math.max(m.collected, m.invoiced)));
  const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : null);
  const collectionRate = pct(r.invoices.invoiced - r.invoices.outstanding, r.invoices.invoiced);

  const tiles: [string, string, string?, boolean?][] = [
    [t("Collected"), formatUZS(r.money.collected), t("{n} payments", { n: r.money.payments })],
    [t("Collection rate"), collectionRate == null ? "—" : `${collectionRate}%`, t("of what was invoiced")],
    [t("Overdue"), formatUZS(r.invoices.overdue), t("{n} students", { n: r.invoices.overdue_students }), r.invoices.overdue > 0],
    [t("Attendance"), r.attendance.rate == null ? "—" : `${r.attendance.rate}%`, t("{n} lessons held", { n: r.lessons.held })],
    [t("Seats filled"), r.capacity.seats ? `${pct(r.capacity.filled, r.capacity.seats)}%` : String(r.capacity.filled), `${r.capacity.filled} / ${r.capacity.seats || "—"}`],
    [t("Active students"), String(r.students.active), t("+{a} joined · {b} left", { a: r.students.joined, b: r.students.left })],
    [t("Homework"), String(r.academic.homework_set), t("{n} submissions · average {s}", { n: r.academic.submitted, s: r.academic.average_score == null ? "—" : `${r.academic.average_score}%` })],
    [t("Mocks"), String(r.academic.mocks), t("average band {b}", { b: r.academic.average_band == null ? "—" : Number(r.academic.average_band).toFixed(1) })],
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Owner reporting")} title={t("Reports")}
        description={t("The centre in numbers — collections, attendance, capacity and academic output over one period.")} />
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((p) => (
          <Link key={p} href={`/reports?period=${p}`}
            className={cn("rounded-full border px-3.5 py-1.5 text-[12.5px]", p === period ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80 bg-[#FCF8F4] hover:bg-white")}>
            {t(PERIODS[p])}
          </Link>
        ))}
        <span className="ml-auto self-center text-[12px] text-muted-foreground">{new Date(`${from}T12:00:00Z`).toLocaleDateString(L, { day: "numeric", month: "short", year: "numeric" })} – {new Date(`${to}T12:00:00Z`).toLocaleDateString(L, { day: "numeric", month: "short", year: "numeric" })}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([k, v, hint, red]) => (
          <Card key={k} className="p-5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{k}</p>
            <p className={cn("mt-2 text-[22px] font-semibold tracking-[-0.03em]", red && "text-[#B4483D]")}>{v}</p>
            {hint && <p className="mt-1 text-[11.5px] text-muted-foreground">{hint}</p>}
          </Card>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">{t("Collections, last 6 months")}</h2>
          <p className="text-[12px] text-muted-foreground">{t("Collected against invoiced, UZS")}</p>
          <div className="mt-5 flex h-48 items-end gap-3">
            {r.months.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex h-40 w-full items-end justify-center gap-1">
                  <div className="w-1/3 rounded-t-[4px] bg-[#E8DCCB]" style={{ height: `${(m.invoiced / max) * 100}%` }} title={`${t("Invoiced")}: ${formatUZS(m.invoiced)}`} />
                  <div className="w-1/3 rounded-t-[4px] bg-[#12392B]" style={{ height: `${(m.collected / max) * 100}%` }} title={`${t("Collected")}: ${formatUZS(m.collected)}`} />
                </div>
                <span className="text-[11px] text-muted-foreground">{new Date(m.month).toLocaleDateString(L, { month: "short", timeZone: "UTC" })}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-[11.5px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#E8DCCB]" />{t("Invoiced")}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#12392B]" />{t("Collected")}</span>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">{t("By payment method")}</h2>
          {Object.keys(r.money.by_method).length === 0 ? <p className="mt-2 text-[12.5px] text-muted-foreground">{t("No payments in this period.")}</p> : (
            <ul className="mt-3 space-y-2.5">
              {Object.entries(r.money.by_method).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k}>
                  <div className="flex justify-between text-[12.5px]"><span>{t(k === "bank_transfer" ? "Bank transfer" : k[0].toUpperCase() + k.slice(1))}</span><span className="font-medium">{formatUZS(v)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F5ECE8]"><div className="h-full rounded-full bg-[#12392B]" style={{ width: `${pct(v, r.money.collected + r.money.refunds) ?? 0}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 border-t border-border/60 pt-4 text-[12.5px]">
            <div className="flex justify-between"><span className="text-muted-foreground">{t("Invoiced")}</span><span>{formatUZS(r.invoices.invoiced)}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-muted-foreground">{t("Outstanding")}</span><span>{formatUZS(r.invoices.outstanding)}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-muted-foreground">{t("Refunds")}</span><span>{formatUZS(r.money.refunds)}</span></div>
            <div className="mt-1 flex justify-between"><span className="text-muted-foreground">{t("Lessons cancelled")}</span><span>{r.lessons.cancelled}</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
