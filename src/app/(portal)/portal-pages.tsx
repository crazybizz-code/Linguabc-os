import { notFound } from "next/navigation";
import { LogOut } from "lucide-react";
import { getPortalContext, pickChild, type PortalKind } from "@/lib/portal/context";
import { loadSummary } from "@/lib/portal/summary";
import { loadProgress } from "@/lib/progress";
import { ProgressView } from "@/components/progress/progress-view";
import { AttendanceView, ChildSwitcher, HomeView, PaymentsView } from "@/components/portal/views";
import { PortalCard } from "@/components/portal/cards";
import { Badge } from "@/components/ui/primitives";
import { ReceiptView } from "@/components/portal/receipt-view";
import { LanguageSwitch } from "@/components/workspace/language-switch";
import { PrintButton } from "../(staff)/payments/receipt/[id]/print-button";
import { signOut } from "../(auth)/actions";
import { setParentLocale } from "./actions";
import { intlLocale } from "@/i18n";

type SP = Promise<Record<string, string | string[] | undefined>>;

async function setup(kind: PortalKind, searchParams: SP) {
  const ctx = await getPortalContext(kind);
  const child = pickChild(ctx, (await searchParams).child);
  return { ctx, child };
}

function NoChild({ text }: { text: string }) {
  return <PortalCard><p className="text-[13px] text-muted-foreground">{text}</p></PortalCard>;
}

export async function PortalHome({ kind, searchParams }: { kind: PortalKind; searchParams: SP }) {
  const { ctx, child } = await setup(kind, searchParams);
  if (!child) return <NoChild text={ctx.t("Your account is not linked to a student yet. Ask the centre to check your invitation.")} />;
  return <HomeView ctx={ctx} child={child} s={await loadSummary(ctx, child.id)} kind={kind} />;
}

export async function PortalAttendance({ kind, searchParams }: { kind: PortalKind; searchParams: SP }) {
  const { ctx, child } = await setup(kind, searchParams);
  if (!child) return <NoChild text={ctx.t("No attendance marked yet.")} />;
  return (
    <>
      <ChildSwitcher ctx={ctx} current={child.id} base={`/${kind}/attendance`} />
      <AttendanceView ctx={ctx} s={await loadSummary(ctx, child.id)} />
    </>
  );
}

export async function PortalProgress({ kind, searchParams }: { kind: PortalKind; searchParams: SP }) {
  const { ctx, child } = await setup(kind, searchParams);
  if (!child) return <NoChild text={ctx.t("Nothing to show yet.")} />;
  return (
    <>
      <ChildSwitcher ctx={ctx} current={child.id} base={`/${kind}/progress`} />
      <ProgressView p={await loadProgress(ctx.supabase, child.id)} t={ctx.t} locale={intlLocale(ctx.locale)} familyView />
    </>
  );
}

export async function PortalSchedule({ searchParams }: { searchParams: SP }) {
  const { ctx, child } = await setup("student", searchParams);
  if (!child) return <NoChild text={ctx.t("No upcoming lessons scheduled.")} />;
  const s = await loadSummary(ctx, child.id);
  const L = intlLocale(ctx.locale);
  const { data: lessons } = s.group
    ? await ctx.supabase.from("lessons").select("id, starts_at, ends_at, rooms(name)").eq("group_id", s.group.id).eq("status", "scheduled")
        .gt("starts_at", new Date().toISOString()).order("starts_at").limit(14)
    : { data: [] };
  return (
    <>
      <PortalCard title={ctx.t("Upcoming lessons")}>
        {!lessons?.length ? <p className="text-[13px] text-muted-foreground">{ctx.t("No upcoming lessons scheduled.")}</p> : (
          <ul className="divide-y divide-border/60">
            {lessons.map((l) => (
              <li key={l.id} className="flex justify-between py-2.5 text-[13px]">
                <span>{new Date(l.starts_at).toLocaleDateString(L, { timeZone: "Asia/Tashkent", weekday: "long", day: "numeric", month: "short" })}</span>
                <span className="text-muted-foreground">
                  {new Date(l.starts_at).toLocaleTimeString(L, { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" })}
                  {l.rooms?.name ? ` · ${ctx.t("Room")} ${l.rooms.name}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PortalCard>
      <AttendanceView ctx={ctx} s={s} />
    </>
  );
}

export async function PortalPayments({ kind, searchParams }: { kind: PortalKind; searchParams: SP }) {
  const { ctx, child } = await setup(kind, searchParams);
  if (!child) return <NoChild text={ctx.t("No invoices yet.")} />;
  return (
    <>
      <ChildSwitcher ctx={ctx} current={child.id} base={`/${kind}/payments`} />
      <PaymentsView ctx={ctx} s={await loadSummary(ctx, child.id)} base={`/${kind}`} />
    </>
  );
}

export async function PortalReceipt({ kind, id }: { kind: PortalKind; id: string }) {
  const ctx = await getPortalContext(kind);
  const { data: p } = await ctx.supabase.from("payments").select("*, students(full_name), invoices(period)").eq("id", id).maybeSingle();
  if (!p) notFound();
  return (
    <>
      <ReceiptView p={p} centerName={ctx.workspace.centerName} t={ctx.t} locale={ctx.locale} />
      <div className="flex justify-center print:hidden"><PrintButton /></div>
    </>
  );
}

export async function PortalProfile({ kind }: { kind: PortalKind }) {
  const ctx = await getPortalContext(kind);
  const { t } = ctx;
  return (
    <>
      <PortalCard title={t("Profile")}>
        <p className="text-[17px] font-semibold">{ctx.workspace.fullName}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t(kind === "parent" ? "Parent" : "Student")} · {ctx.workspace.centerName}</p>
        {ctx.children.length > 0 && kind === "parent" && (
          <p className="mt-3 text-[12.5px] text-[#3B4A42]">{t("Children")}: {ctx.children.map((c) => c.full_name).join(", ")}</p>
        )}
      </PortalCard>
      {kind === "parent" && (
        <PortalCard title={t("Language")}>
          <LanguageSwitch locale={ctx.locale} onChange={setParentLocale} />
        </PortalCard>
      )}
      <form action={signOut}>
        <button className="flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border border-border/80 bg-[#FCF8F4] text-[13px] font-medium text-[#17211D]">
          <LogOut className="h-4 w-4" /> {t("Sign out")}
        </button>
      </form>
    </>
  );
}

/** A parent's view of their child's homework: what was set, when it is due, and how it went. */
export async function PortalChildHomework({ searchParams }: { searchParams: SP }) {
  const { ctx, child } = await setup("parent", searchParams);
  const { t, supabase } = ctx;
  if (!child) return <NoChild text={t("No homework yet.")} />;
  const L = intlLocale(ctx.locale);
  const { data: enr } = await supabase.from("enrollments").select("group_id").eq("student_id", child.id);
  const groups = (enr ?? []).map((e) => e.group_id);
  const [{ data: hw }, { data: subs }] = await Promise.all([
    groups.length ? supabase.from("homework").select("id, due_at, assignments(title)").in("group_id", groups).order("due_at", { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
    supabase.from("submissions").select("homework_id, status, score").eq("student_id", child.id),
  ]);
  const sub = new Map((subs ?? []).map((s) => [s.homework_id, s]));
  const now = new Date();
  const LABEL: Record<string, [string, "green" | "amber" | "red" | "neutral"]> = {
    reviewed: ["Marked", "green"], submitted: ["Submitted", "green"], in_progress: ["Started", "amber"], not_started: ["Not started", "neutral"],
  };
  return (
    <>
      <ChildSwitcher ctx={ctx} current={child.id} base="/parent/homework" />
      <PortalCard title={t("Homework")}>
        {(hw ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">{t("No homework yet.")}</p> : (
          <ul className="divide-y divide-border/60">
            {(hw ?? []).map((h) => {
              const s = sub.get(h.id);
              const status = s?.status ?? "not_started";
              const late = status !== "submitted" && status !== "reviewed" && new Date(h.due_at) < now;
              const [label, tone] = late ? ["Missed", "red" as const] : LABEL[status];
              return (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="block text-[13.5px] font-medium">{(h.assignments as unknown as { title: string } | null)?.title ?? "—"}</span>
                    <span className="text-[11.5px] text-muted-foreground">{t("due {date}", { date: new Date(h.due_at).toLocaleDateString(L, { timeZone: "Asia/Tashkent", day: "numeric", month: "short" }) })}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {s?.score != null && <span className="text-[13px] font-semibold">{Math.round(Number(s.score))}%</span>}
                    <Badge tone={tone}>{t(label)}</Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PortalCard>
    </>
  );
}
