import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card, cn, EmptyState, PageHeader } from "@/components/ui/primitives";
import { MOCK_LABEL, MOCK_TONE } from "./labels";
import { intlLocale } from "@/i18n";
import { CreateMock } from "./create-mock";

export const metadata = { title: "Mocks" };
const TZ = "Asia/Tashkent";
const TABS = [
  ["upcoming", "Upcoming", ["scheduled"]],
  ["live", "In progress", ["in_progress"]],
  ["completed", "Completed", ["completed"]],
] as const;

export default async function MocksPage({ searchParams }: PageProps<"/mocks">) {
  const { tab: rawTab } = await searchParams;
  const tab = TABS.find(([k]) => k === rawTab) ?? TABS[0];
  const { supabase, workspace, isStaff, t, locale } = await getStaffContext();
  const center = workspace.centerId;
  const L = intlLocale(locale);

  // RLS limits mentors to the sessions of the groups they teach.
  const [sessions, counts, groups, staff, rooms] = await Promise.all([
    supabase.from("mock_sessions").select("id, name, version, status, scheduled_at, group_id, examiner_id, modules, groups(name), rooms(name)")
      .eq("center_id", center).in("status", [...tab[2]]).order("scheduled_at", { ascending: tab[0] === "upcoming" }).limit(100),
    supabase.from("mock_sessions").select("status").eq("center_id", center).in("status", ["scheduled", "in_progress"]),
    supabase.from("groups").select("id, name, branch_id, mentor_id, room_id").eq("center_id", center).eq("status", "active").order("name"),
    supabase.from("memberships").select("id, full_name, role").eq("center_id", center).eq("status", "active").in("role", ["owner", "admin", "academic_manager", "mentor"]).order("full_name"),
    supabase.from("rooms").select("id, name, branch_id").eq("center_id", center).order("name"),
  ]);
  const people = new Map((staff.data ?? []).map((m) => [m.id, m.full_name]));
  const live = (counts.data ?? []).filter((s) => s.status === "in_progress").length;
  const list = sessions.data ?? [];
  const ids = list.map((s) => s.id);
  const { data: results } = ids.length
    ? await supabase.from("mock_results").select("mock_session_id, status").in("mock_session_id", ids)
    : { data: [] };
  const tally = new Map<string, { total: number; done: number }>();
  (results ?? []).forEach((r) => {
    const x = tally.get(r.mock_session_id) ?? { total: 0, done: 0 };
    x.total++;
    if (r.status === "completed" || r.status === "absent") x.done++;
    tally.set(r.mock_session_id, x);
  });

  const tabs = (
    <div className="flex rounded-[11px] border border-border/70 bg-[#FCF8F4] p-1 text-[12.5px]">
      {TABS.map(([key, label]) => (
        <Link key={key} href={key === "upcoming" ? "/mocks" : `/mocks?tab=${key}`}
          className={cn("flex items-center gap-1.5 rounded-[8px] px-3 py-1.5", key === tab[0] ? "bg-[#F5ECE8] font-medium text-[#17211D]" : "text-muted-foreground")}>
          {t(label)}
          {key === "live" && live > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[#C9773A]" />}
        </Link>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Academic operations")}
        title={t("Mocks")}
        description={t("Real exam conditions, measured the same way every time — results land straight in each student's record.")}
        actions={<>{tabs}{isStaff && (
          <CreateMock
            groups={groups.data ?? []}
            managers={(staff.data ?? []).filter((m) => m.role !== "mentor").map((m) => ({ id: m.id, name: m.full_name }))}
            mentors={(staff.data ?? []).filter((m) => m.role === "mentor").map((m) => ({ id: m.id, name: m.full_name }))}
            rooms={rooms.data ?? []}
          />
        )}</>}
      />
      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t("No mocks here yet")}
            description={tab[0] === "upcoming" ? t("Schedule a mock so the group has a real benchmark to work towards.") : t("Sessions appear here as results are entered.")} />
        ) : (
          <ul className="divide-y divide-border/60">
            {list.map((s) => {
              const x = tally.get(s.id) ?? { total: 0, done: 0 };
              const when = new Date(s.scheduled_at);
              return (
                <li key={s.id}>
                  <Link href={`/mocks/${s.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-medium">{s.name}</span>
                        <Badge tone={MOCK_TONE[s.status]}>{t(MOCK_LABEL[s.status])}</Badge>
                      </div>
                      <p className="mt-1 text-[11.5px] text-muted-foreground">
                        {[
                          `${when.toLocaleDateString(L, { timeZone: TZ, day: "numeric", month: "short", year: "numeric" })} · ${when.toLocaleTimeString(L, { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}`,
                          s.groups?.name,
                          t("{n} students", { n: x.total }),
                          s.status !== "scheduled" && x.total ? t("{a}/{b} results", { a: x.done, b: x.total }) : null,
                          s.version,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className="hidden text-[12px] text-muted-foreground sm:block">{s.examiner_id ? people.get(s.examiner_id) : ""}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
