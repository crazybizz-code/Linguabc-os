import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card, EmptyState, PageHeader, cn } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Schedule" };
const TZ = "Asia/Tashkent";
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** Monday of the week that holds `day` (YYYY-MM-DD). */
function monday(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** The week's lessons, day by day. Mentors see only their own groups (RLS). */
export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const { supabase, workspace, t, locale } = await getStaffContext();
  const L = intlLocale(locale);
  const { week } = await searchParams;
  const today = dayKey(new Date().toISOString());
  const start = monday(typeof week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const [lessons, groups, rooms, staff] = await Promise.all([
    supabase.from("lessons").select("id, group_id, mentor_id, room_id, starts_at, ends_at, status")
      .eq("center_id", workspace.centerId)
      .gte("starts_at", new Date(`${start}T00:00:00+05:00`).toISOString())
      .lt("starts_at", new Date(`${addDays(start, 7)}T00:00:00+05:00`).toISOString())
      .order("starts_at"),
    supabase.from("groups").select("id, name").eq("center_id", workspace.centerId),
    supabase.from("rooms").select("id, name").eq("center_id", workspace.centerId),
    supabase.from("memberships").select("id, full_name").eq("center_id", workspace.centerId).eq("role", "mentor"),
  ]);
  const name = (rows: { id: string; name?: string; full_name?: string }[] | null) => new Map((rows ?? []).map((r) => [r.id, r.name ?? r.full_name ?? ""]));
  const groupName = name(groups.data), roomName = name(rooms.data), mentorName = name(staff.data);
  const byDay = new Map<string, NonNullable<typeof lessons.data>>();
  (lessons.data ?? []).forEach((l) => { const k = dayKey(l.starts_at); byDay.set(k, [...(byDay.get(k) ?? []), l]); });
  const total = (lessons.data ?? []).filter((l) => l.status !== "cancelled").length;
  const range = `${new Date(`${start}T12:00:00Z`).toLocaleDateString(L, { day: "numeric", month: "short" })} – ${new Date(`${addDays(start, 6)}T12:00:00Z`).toLocaleDateString(L, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Today")} title={t("Schedule")}
        description={t("Every lesson this week, by day. Open a lesson to mark attendance.")} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3 text-[12.5px]">
          <Link href={`/schedule?week=${addDays(start, -7)}`} className="rounded-[8px] border border-border/80 px-2.5 py-1 hover:bg-white">←</Link>
          <span className="min-w-[170px] text-center font-medium">{range}</span>
          <Link href={`/schedule?week=${addDays(start, 7)}`} className="rounded-[8px] border border-border/80 px-2.5 py-1 hover:bg-white">→</Link>
          {start !== monday(today) && <Link href="/schedule" className="ml-2 text-[#12392B] hover:underline">{t("This week")}</Link>}
          <span className="ml-auto text-muted-foreground">{t("{n} lessons", { n: total })}</span>
        </div>
        {(lessons.data ?? []).length === 0 ? (
          <EmptyState icon={CalendarDays} title={t("No lessons this week")} description={t("Lessons appear here once a group has a weekly schedule. Create a group on the Groups page.")} />
        ) : (
          <div className="grid divide-y divide-border/60 md:grid-cols-7 md:divide-x md:divide-y-0">
            {days.map((d) => (
              <div key={d} className={cn("min-h-[120px] p-3", d === today && "bg-[#FCF8F4]")}>
                <p className={cn("mb-2 text-[11px] font-medium uppercase tracking-[0.08em]", d === today ? "text-[#12392B]" : "text-[#5F6B66]")}>
                  {new Date(`${d}T12:00:00Z`).toLocaleDateString(L, { weekday: "short", day: "numeric" })}
                </p>
                <div className="space-y-2">
                  {(byDay.get(d) ?? []).map((l) => (
                    <Link key={l.id} href={`/attendance/${l.id}`}
                      className={cn("block rounded-[10px] border px-2.5 py-2 text-[12px] hover:bg-white", l.status === "cancelled" ? "border-dashed border-border/70 opacity-60" : "border-border/70 bg-white/60")}>
                      <p className="font-medium">{time(l.starts_at)}–{time(l.ends_at)}</p>
                      <p className="truncate text-[#17211D]">{groupName.get(l.group_id) ?? "—"}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{[l.room_id && roomName.get(l.room_id), l.mentor_id && mentorName.get(l.mentor_id)].filter(Boolean).join(" · ")}</p>
                      {l.status === "cancelled" && <Badge tone="neutral">{t("Cancelled")}</Badge>}
                      {l.status === "held" && <Badge tone="green">{t("Held")}</Badge>}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
