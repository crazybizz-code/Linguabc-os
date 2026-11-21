import Link from "next/link";
import { BarChart3, BookOpen, CalendarClock, Bell, ChevronRight, Wallet } from "lucide-react";
import { Badge, cn, formatUZS, prettyNumbers, type Tone } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";
import type { PortalContext } from "@/lib/portal/context";
import type { Summary } from "@/lib/portal/summary";
import { PortalCard, Stat } from "./cards";

const TZ = "Asia/Tashkent";
const PAY_TONE: Record<string, Tone> = { paid: "green", partial: "amber", pending: "amber", overdue: "red", void: "neutral" };
const ATT_TONE: Record<string, Tone> = { present: "green", late: "amber", absent: "red", excused: "neutral" };
const ATT_BAR: Record<string, string> = { present: "bg-[#CFE0CB]", late: "bg-[#F3D9B5]", absent: "bg-[#F0C9C2]", excused: "bg-[#E6DCD3]" };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const day = (iso: string | null, L: string) => !iso ? "—" : new Date(`${iso}T00:00:00Z`).toLocaleDateString(L, { day: "numeric", month: "short", timeZone: "UTC" });
const q = (child?: string) => (child ? `?child=${child}` : "");

function ago(iso: string, ctx: PortalContext) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? ctx.t("today") : d === 1 ? ctx.t("yesterday") : ctx.t("{n} days ago", { n: d });
}

export function ChildSwitcher({ ctx, current, base }: { ctx: PortalContext; current: string; base: string }) {
  if (ctx.children.length < 2) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {ctx.children.map((c) => (
        <Link key={c.id} href={`${base}?child=${c.id}`}
          className={cn("whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px]", c.id === current ? "bg-[#12392B] text-[#FAF5EF]" : "bg-[#FCF8F4] text-[#3B4A42]")}>
          {c.full_name}
        </Link>
      ))}
    </div>
  );
}

export function HomeView({ ctx, child, s, kind }: { ctx: PortalContext; child: { id: string; full_name: string }; s: Summary; kind: "parent" | "student" }) {
  const { t } = ctx;
  const L = intlLocale(ctx.locale);
  const base = kind === "parent" ? "/parent" : "/student";
  const latestMock = s.mocks[0];
  const prevMock = s.mocks[1];
  const trend = latestMock && prevMock && latestMock.overall_band != null && prevMock.overall_band != null
    ? Number(latestMock.overall_band) > Number(prevMock.overall_band) ? ["Moving in the right direction", "green"]
      : Number(latestMock.overall_band) < Number(prevMock.overall_band) ? ["Needs attention", "amber"] : ["Steady", "neutral"]
    : null;
  const inv = s.invoices[0];
  const lastPay = inv ? s.payments.find((p) => p.invoice_id === inv.id && p.kind === "payment") : undefined;
  const firstName = child.full_name.split(" ")[0];
  const mockDate = latestMock?.mock_sessions?.scheduled_at ?? latestMock?.updated_at ?? null;

  const nextLessonCard = (
    <PortalCard icon={CalendarClock} title={t("Next lesson")}>
      {s.nextLesson ? (
        <>
          <p className="text-[16px] font-semibold tracking-[-0.01em]">
            {new Date(s.nextLesson.starts_at).toLocaleString(L, { timeZone: TZ, weekday: "long", day: "numeric", month: "short" })} ·{" "}
            {new Date(s.nextLesson.starts_at).toLocaleTimeString(L, { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {[s.nextLesson.rooms?.name && `${t("Room")} ${s.nextLesson.rooms.name}`, s.branch].filter(Boolean).join(" · ")}
          </p>
          {s.mentor && <p className="mt-2 text-[12.5px] text-[#3B4A42]">{t("{name} will take the lesson", { name: s.mentor })}</p>}
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t("No upcoming lessons scheduled.")}</p>
      )}
    </PortalCard>
  );

  return (
    <>
      <ChildSwitcher ctx={ctx} current={child.id} base={base} />

      <PortalCard icon={BookOpen} title={kind === "parent" ? t("My child") : t("My learning")}>
        <p className="text-[18px] font-semibold tracking-[-0.02em]">{kind === "parent" ? child.full_name : t("Hi, {name}", { name: firstName })}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{[s.course, s.group?.name].filter(Boolean).join(" · ") || t("Not in a group yet")}</p>
        {s.mentor && (
          <div className="mt-3 flex justify-between rounded-[11px] bg-[#F5ECE8]/80 px-3 py-2.5 text-[12.5px]">
            <span className="text-muted-foreground">{t("Mentor")}</span><span className="font-medium">{s.mentor}</span>
          </div>
        )}
      </PortalCard>

      {kind === "student" && nextLessonCard}

      <PortalCard icon={BarChart3} title={t("Learning status")}>
        <div className="grid grid-cols-3 gap-2">
          <Stat label={t("Attendance")} value={s.attendancePct == null ? "—" : `${s.attendancePct}%`} warn={s.attendancePct != null && s.attendancePct < 85} />
          <Stat label={t("Homework")} value={`${s.homework.done}/${s.homework.total}`} />
          <Stat label={t("Average band")} value={latestMock?.overall_band ?? "—"} />
        </div>
        {s.lastFive.length > 0 && (
          <>
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => {
                const a = s.lastFive[i];
                return <div key={i} title={a ? t(cap(a.status)) : ""} className={cn("h-6 rounded-[6px]", a ? ATT_BAR[a.status] : "bg-[#EFE6DF]/60")} />;
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[11.5px] text-muted-foreground">
              <span>{t("Last 5 lessons")}</span>
              <Link href={`${base}/${kind === "parent" ? "attendance" : "schedule"}${q(child.id)}`} className="font-medium text-[#12392B]">{t("Details")}</Link>
            </div>
          </>
        )}
        {s.homework.lastTitle && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {t("Last completed:")} <span className="text-[#17211D]">{s.homework.lastTitle}</span> · {ago(s.homework.lastAt!, ctx)}
          </p>
        )}
      </PortalCard>

      <PortalCard icon={BarChart3} title={t("Results")} action={trend && <Badge tone={trend[1] as Tone}>{t(trend[0])}</Badge>}>
        {latestMock ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {(["reading", "listening", "writing", "speaking"] as const).map((k) =>
                latestMock[`${k}_band`] != null ? <Stat key={k} label={t(cap(k))} value={latestMock[`${k}_band`]} /> : null,
              )}
            </div>
            <p className="mt-2.5 text-[12px] text-muted-foreground">
              {[latestMock.mock_sessions?.name, mockDate && new Date(mockDate).toLocaleDateString(L, { timeZone: TZ, day: "numeric", month: "short" })].filter(Boolean).join(" · ")}
              {" · "}{t("overall {band}", { band: latestMock.overall_band ?? "—" })}
            </p>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t("No mock results yet")}</p>
        )}
      </PortalCard>

      {kind === "parent" && nextLessonCard}

      <PortalCard icon={Wallet} title={t("Payment")}>
        {inv ? (
          <>
            <div className="flex items-start justify-between">
              <p className="text-[24px] font-semibold tracking-[-0.03em]">{formatUZS(Number(inv.amount))}</p>
              <Badge tone={PAY_TONE[inv.payment_status ?? "pending"]}>{t(cap(inv.payment_status ?? ""))}</Badge>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {t("{month} tuition", { month: new Date(`${inv.period}T00:00:00Z`).toLocaleString(L, { month: "long", timeZone: "UTC" }) })} · {t("due {date}", { date: day(inv.due_date, L) })}
              {Number(inv.balance) > 0 && Number(inv.balance) < Number(inv.amount) ? ` · ${t("{amount} left", { amount: formatUZS(Number(inv.balance)) })}` : ""}
            </p>
            {lastPay && (
              <Link href={`${base}/receipt/${lastPay.id}`} className="mt-3 flex h-10 items-center justify-center rounded-[11px] border border-border/80 bg-white/60 text-[13px] font-medium">
                {t("View receipt")}
              </Link>
            )}
            {Number(inv.balance) > 0 && (
              <p className="mt-3 rounded-[10px] bg-[#F5ECE8] px-3 py-2.5 text-[11.5px] text-muted-foreground">{t("Pay at the centre's front desk. Online payment is coming soon.")}</p>
            )}
            <Link href={`${base}/payments${q(child.id)}`} className="mt-2 flex items-center justify-between py-1 text-[12px] text-muted-foreground">
              {t("Payment history & receipts")} <ChevronRight className="h-4 w-4" />
            </Link>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">{t("No invoices yet.")}</p>
        )}
      </PortalCard>

      <PortalCard icon={Bell} title={t("Recent updates")}>
        {s.activities.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("No activity recorded yet.")}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {s.activities.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2.5">
                <div className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5F6B66]" />
                  <div><p className="text-[13px] font-medium">{t(a.title)}</p>{a.detail && <p className="text-[11.5px] text-muted-foreground">{prettyNumbers(a.detail)}</p>}</div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{ago(a.occurred_at, ctx)}</span>
              </li>
            ))}
          </ul>
        )}
      </PortalCard>

      <p className="py-3 text-center text-[11px] text-muted-foreground">{ctx.workspace.centerName} · {t("Transparency and support, not surveillance.")}</p>
    </>
  );
}

export function AttendanceView({ ctx, s }: { ctx: PortalContext; s: Summary }) {
  const { t } = ctx;
  const L = intlLocale(ctx.locale);
  return (
    <PortalCard title={t("Attendance")} action={s.attendancePct != null && <span className="text-[13px] font-semibold">{s.attendancePct}%</span>}>
      {s.attendance.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("No attendance marked yet.")}</p> : (
        <ul className="divide-y divide-border/60">
          {s.attendance.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2.5">
              <span className="text-[13px]">{a.lessons ? new Date(a.lessons.starts_at).toLocaleString(L, { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
              <Badge tone={ATT_TONE[a.status]}>{t(cap(a.status))}</Badge>
            </li>
          ))}
        </ul>
      )}
    </PortalCard>
  );
}

export function PaymentsView({ ctx, s, base }: { ctx: PortalContext; s: Summary; base: string }) {
  const { t } = ctx;
  const L = intlLocale(ctx.locale);
  const open = s.invoices.filter((i) => Number(i.balance) > 0 && i.payment_status !== "void");
  const owed = open.reduce((n, i) => n + Number(i.balance), 0);
  const overdue = open.filter((i) => i.payment_status === "overdue");
  const next = [...open].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
  return (
    <>
      {owed > 0 && (
        <div className={`rounded-[16px] border px-4 py-3.5 ${overdue.length ? "border-[#E8C4BE] bg-[#FBEDEA]" : "border-[#E7D3B5] bg-[#FBF3E6]"}`}>
          <p className={`text-[12px] font-medium uppercase tracking-[0.08em] ${overdue.length ? "text-[#B4483D]" : "text-[#8A5A26]"}`}>
            {t(overdue.length ? "Payment overdue" : "To pay")}
          </p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">{formatUZS(owed)}</p>
          {next && <p className="mt-0.5 text-[12px] text-muted-foreground">{t(overdue.length ? "was due {date}" : "due {date}", { date: day(next.due_date, L) })} · {t("Pay at the centre's front desk.")}</p>}
        </div>
      )}
      <PortalCard title={t("Invoices")}>
        {s.invoices.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("No invoices yet.")}</p> : (
          <ul className="divide-y divide-border/60">
            {s.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-[13px] font-medium">{new Date(`${i.period}T00:00:00Z`).toLocaleString(L, { month: "long", year: "numeric", timeZone: "UTC" })}</p>
                  <p className="text-[11.5px] text-muted-foreground">{formatUZS(Number(i.amount))} · {t("due {date}", { date: day(i.due_date, L) })}{Number(i.balance) > 0 ? ` · ${t("{amount} left", { amount: formatUZS(Number(i.balance)) })}` : ""}</p>
                </div>
                <Badge tone={PAY_TONE[i.payment_status ?? "pending"]}>{t(cap(i.payment_status ?? ""))}</Badge>
              </li>
            ))}
          </ul>
        )}
      </PortalCard>
      <PortalCard title={t("Payments & receipts")}>
        {s.payments.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("No payments recorded yet.")}</p> : (
          <ul className="divide-y divide-border/60">
            {s.payments.map((p) => (
              <li key={p.id}>
                <Link href={`${base}/receipt/${p.id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-[13px] font-medium">{p.kind === "refund" ? "−" : ""}{formatUZS(p.amount)}</p>
                    <p className="text-[11.5px] text-muted-foreground">{new Date(p.paid_at).toLocaleDateString(L, { timeZone: TZ, day: "numeric", month: "short", year: "numeric" })} · {p.receipt_no}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 rounded-[10px] bg-[#F5ECE8] px-3 py-2.5 text-[11.5px] text-muted-foreground">{t("Pay at the centre's front desk. Online payment is coming soon.")}</p>
      </PortalCard>
    </>
  );
}
