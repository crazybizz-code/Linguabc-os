import Link from "next/link";
import { Bell, UserX, Wallet, UserPlus } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Avatar, Badge, Card, EmptyState, formatUZS, PageHeader } from "@/components/ui/primitives";
import { describe, type Note } from "@/components/notifications/describe";
import { intlLocale } from "@/i18n";
import { RemindButton } from "../payments/remind-button";
import { MarkAllRead } from "./mark-all-read";

export const metadata = { title: "Notifications" };

const TZ = "Asia/Tashkent";
const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/**
 * The centre's inbox: what staff should react to (overdue fees, today's
 * absences, new students) and the signed-in person's own notifications.
 */
export default async function NotificationsPage() {
  const { supabase, workspace, isAdmin, t, locale } = await getStaffContext();
  const center = workspace.centerId;
  const L = intlLocale(locale);
  const now = new Date();
  const today = localDay(now);
  const weekAgo = localDay(new Date(now.getTime() - 7 * 86_400_000));
  // Today in Tashkent, as UTC bounds for lesson times (UTC+5, no DST).
  const dayStart = new Date(`${today}T00:00:00+05:00`).toISOString();
  const dayEnd = new Date(`${today}T23:59:59+05:00`).toISOString();

  const [notes, overdue, absences, newcomers] = await Promise.all([
    supabase.from("notifications").select("id, title, body, created_at, read_at, data")
      .eq("center_id", center).eq("channel", "in_app").order("created_at", { ascending: false }).limit(100),
    isAdmin
      ? supabase.from("invoice_balances").select("id, student_id, balance, due_date, period").eq("center_id", center)
          .eq("payment_status", "overdue").order("due_date").limit(30)
      : Promise.resolve({ data: [] as { id: string | null; student_id: string | null; balance: number | null; due_date: string | null; period: string | null }[] }),
    supabase.from("attendance_records").select("id, student_id, status, lessons!inner(starts_at, group_id, groups(name))")
      .eq("center_id", center).in("status", ["absent"]).gte("lessons.starts_at", dayStart).lte("lessons.starts_at", dayEnd),
    supabase.from("students").select("id, full_name, status, joined_on").eq("center_id", center).gte("joined_on", weekAgo)
      .order("joined_on", { ascending: false }).limit(20),
  ]);

  const ids = [...new Set([...(overdue.data ?? []).map((o) => o.student_id), ...(absences.data ?? []).map((a) => a.student_id)].filter(Boolean))] as string[];
  const [{ data: names }, { data: reminded }] = await Promise.all([
    ids.length ? supabase.from("students").select("id, full_name").in("id", ids) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    isAdmin && (overdue.data ?? []).length
      ? supabase.from("invoices").select("id, last_reminded_at").in("id", (overdue.data ?? []).map((o) => o.id!))
      : Promise.resolve({ data: [] as { id: string; last_reminded_at: string | null }[] }),
  ]);
  const nameOf = new Map((names ?? []).map((s) => [s.id, s.full_name]));
  const remindedAt = new Map((reminded ?? []).map((i) => [i.id, i.last_reminded_at]));

  const mine: Note[] = (notes.data ?? []).map((n) => ({
    id: n.id, title: n.title, body: n.body, created_at: n.created_at, read: n.read_at != null, data: (n.data ?? {}) as Record<string, unknown>,
  }));
  const unread = mine.filter((n) => !n.read).length;
  const queue = (overdue.data ?? []).length + (absences.data ?? []).length + (newcomers.data ?? []).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Inbox")} title={t("Notifications")}
        description={t("Everything the centre should react to — absences, overdue fees and new students in one place.")} />

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          {isAdmin && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Wallet className="h-4 w-4" /> {t("Overdue fees")}</h2>
                <Link href="/payments" className="text-[12px] font-medium text-[#12392B] hover:underline">{t("Payments")}</Link>
              </div>
              {(overdue.data ?? []).length === 0 ? <p className="px-5 py-4 text-[13px] text-muted-foreground">{t("Nothing overdue.")}</p> : (
                <ul className="divide-y divide-border/50">
                  {(overdue.data ?? []).map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <Link href={`/students/${o.student_id}?tab=payments`} className="flex items-center gap-3 hover:underline">
                        <Avatar name={nameOf.get(o.student_id!) ?? "—"} size="sm" />
                        <span>
                          <span className="block text-[13px] font-medium">{nameOf.get(o.student_id!) ?? "—"}</span>
                          <span className="text-[11.5px] text-muted-foreground">{formatUZS(Number(o.balance))} · {t("was due {date}", { date: new Date(`${o.due_date}T12:00:00Z`).toLocaleDateString(L, { day: "numeric", month: "short" }) })}</span>
                        </span>
                      </Link>
                      <RemindButton invoiceId={o.id!} remindedAt={remindedAt.get(o.id!) ?? null} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold"><UserX className="h-4 w-4" /> {t("Absent today")}</h2>
              <Link href="/attendance" className="text-[12px] font-medium text-[#12392B] hover:underline">{t("Attendance")}</Link>
            </div>
            {(absences.data ?? []).length === 0 ? <p className="px-5 py-4 text-[13px] text-muted-foreground">{t("No absences marked today.")}</p> : (
              <ul className="divide-y divide-border/50">
                {(absences.data ?? []).map((a) => {
                  const lesson = a.lessons as unknown as { starts_at: string; groups: { name: string } | null };
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <Link href={`/students/${a.student_id}?tab=attendance`} className="flex items-center gap-3 hover:underline">
                        <Avatar name={nameOf.get(a.student_id) ?? "—"} size="sm" />
                        <span className="text-[13px] font-medium">{nameOf.get(a.student_id) ?? "—"}</span>
                      </Link>
                      <span className="text-[12px] text-muted-foreground">
                        {lesson.groups?.name} · {new Date(lesson.starts_at).toLocaleTimeString(L, { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold"><UserPlus className="h-4 w-4" /> {t("New students this week")}</h2>
              <Link href="/students" className="text-[12px] font-medium text-[#12392B] hover:underline">{t("Students")}</Link>
            </div>
            {(newcomers.data ?? []).length === 0 ? <p className="px-5 py-4 text-[13px] text-muted-foreground">{t("No new students this week.")}</p> : (
              <ul className="divide-y divide-border/50">
                {(newcomers.data ?? []).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <Link href={`/students/${s.id}`} className="flex items-center gap-3 hover:underline">
                      <Avatar name={s.full_name} size="sm" />
                      <span className="text-[13px] font-medium">{s.full_name}</span>
                    </Link>
                    <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      {s.status === "lead" && <Badge tone="amber">{t("Lead")}</Badge>}
                      {new Date(`${s.joined_on}T12:00:00Z`).toLocaleDateString(L, { day: "numeric", month: "short" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {queue === 0 && !isAdmin && <p className="text-[12.5px] text-muted-foreground">{t("Nothing needs attention right now.")}</p>}
        </div>

        <Card className="h-fit overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Bell className="h-4 w-4" /> {t("For you")} {unread > 0 && <Badge tone="red" dot={false}>{unread}</Badge>}</h2>
            {unread > 0 && <MarkAllRead />}
          </div>
          {mine.length === 0 ? <div className="p-2"><EmptyState icon={Bell} title={t("No notifications yet")} description={t("Mock and homework events for your groups appear here.")} /></div> : (
            <ul className="divide-y divide-border/50">
              {mine.map((n) => {
                const d = describe(n, t, L, "staff");
                const body = (
                  <div className="px-5 py-3">
                    <p className="flex items-center gap-2 text-[13px] font-medium">{!n.read && <span className="h-1.5 w-1.5 rounded-full bg-[#B4483D]" />}{d.title}</p>
                    {d.who && <p className="text-[11.5px] text-[#3B4A42]">{d.who}</p>}
                    <p className="text-[12px] text-muted-foreground">{d.body}</p>
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">{new Date(n.created_at).toLocaleString(L, { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                );
                return <li key={n.id}>{d.href ? <Link href={d.href} className="block hover:bg-white/50">{body}</Link> : body}</li>;
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
