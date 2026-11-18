import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { getPortalContext } from "@/lib/portal/context";
import { PortalCard } from "@/components/portal/cards";
import { Badge } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Homework" };

export default async function StudentHomeworkList() {
  const ctx = await getPortalContext("student");
  const { supabase, t } = ctx;
  const me = ctx.children[0];
  // RLS: a student sees homework for their own groups only.
  const [{ data: hw }, { data: subs }] = await Promise.all([
    supabase.from("homework").select("id, due_at, assignments(title, skill)").eq("center_id", ctx.workspace.centerId).order("due_at", { ascending: false }).limit(60),
    me ? supabase.from("submissions").select("homework_id, status, score").eq("student_id", me.id) : Promise.resolve({ data: [] }),
  ]);
  const byHw = new Map((subs ?? []).map((s) => [s.homework_id, s]));
  const now = Date.parse(new Date().toISOString());
  const L = intlLocale(ctx.locale);
  const rows = (hw ?? []).map((h) => ({ ...h, sub: byHw.get(h.id) }));
  const todo = rows.filter((r) => !["submitted", "reviewed"].includes(r.sub?.status ?? "")).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const done = rows.filter((r) => ["submitted", "reviewed"].includes(r.sub?.status ?? ""));
  const fmt = (iso: string) => new Date(iso).toLocaleString(L, { timeZone: "Asia/Tashkent", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const Row = ({ r, right }: { r: (typeof rows)[number]; right: React.ReactNode }) => (
    <li>
      <Link href={`/student/homework/${r.id}`} className="flex items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{r.assignments?.title}</p>
          <p className="text-[11.5px] text-muted-foreground">{t("Due {date}", { date: fmt(r.due_at) })}</p>
        </div>
        {right}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );

  return (
    <>
      <PortalCard icon={BookOpen} title={t("To do")}>
        {todo.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("All homework done. New work appears here the moment your mentor sets it.")}</p> : (
          <ul className="divide-y divide-border/60">
            {todo.map((r) => (
              <Row key={r.id} r={r} right={new Date(r.due_at).getTime() < now ? <Badge tone="red">{t("Past due")}</Badge>
                : r.sub?.status === "in_progress" ? <Badge tone="amber">{t("In progress")}</Badge> : <Badge tone="blue">{t("New")}</Badge>} />
            ))}
          </ul>
        )}
      </PortalCard>
      {done.length > 0 && (
        <PortalCard title={t("Done")}>
          <ul className="divide-y divide-border/60">
            {done.map((r) => <Row key={r.id} r={r} right={<span className="text-[13px] font-semibold tabular-nums">{r.sub?.score != null ? `${Math.round(Number(r.sub.score))}%` : "—"}</span>} />)}
          </ul>
        </PortalCard>
      )}
    </>
  );
}
