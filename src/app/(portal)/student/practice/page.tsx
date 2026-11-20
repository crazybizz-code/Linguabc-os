import Link from "next/link";
import { Headphones, BookOpenText, ChevronRight } from "lucide-react";
import { getPortalContext } from "@/lib/portal/context";
import { PortalCard } from "@/components/portal/cards";
import { Badge, cn } from "@/components/ui/primitives";

export const metadata = { title: "Practice" };
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Self-practice from the LinguABC library: reading articles and listening podcasts at the student's level. */
export default async function PracticePage({ searchParams }: PageProps<"/student/practice">) {
  const ctx = await getPortalContext("student");
  const { supabase, t } = ctx;
  const sp = await searchParams;
  const kind = sp.kind === "podcast" ? "podcast" : sp.kind === "article" ? "article" : "";
  const level = typeof sp.level === "string" && LEVELS.includes(sp.level) ? sp.level : "";
  const me = ctx.children[0];

  let q = supabase.from("library_items").select("id, kind, title, description, level_min, level_max, minutes, questions").eq("status", "published");
  if (kind) q = q.eq("kind", kind);
  if (level) q = q.lte("level_min", level).gte("level_max", level);
  const [{ data: items }, { data: blocked }, { data: attempts }] = await Promise.all([
    q.order("created_at", { ascending: false }).limit(60),
    supabase.rpc("my_practice_blocked"),
    me ? supabase.from("practice_attempts").select("item_id, score, created_at, skill").eq("student_id", me.id).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
  ]);
  const off = new Set((blocked ?? []) as string[]);
  const best = new Map<string, number>();
  (attempts ?? []).forEach((a) => best.set(a.item_id, Math.max(best.get(a.item_id) ?? 0, Number(a.score ?? 0))));
  const list = (items ?? []).filter((i) => !off.has(i.id) && Array.isArray(i.questions) && i.questions.length > 0);
  const weekAgo = new Date(new Date().getTime() - 7 * 86_400_000).toISOString();
  const week = (attempts ?? []).filter((a) => a.created_at >= weekAgo);
  const chip = (on: boolean) => cn("rounded-full border px-3 py-1 text-[12px]", on ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80 bg-[#FCF8F4]");
  const href = (p: Record<string, string>) => `/student/practice?${new URLSearchParams({ ...(kind && { kind }), ...(level && { level }), ...p })}`.replace(/[?&]$/, "");

  return (
    <>
      <PortalCard title={t("Practice")}>
        <p className="text-[13px] text-muted-foreground">{t("Read or listen, answer the questions and see what you got right. Practice does not count as homework.")}</p>
        <p className="mt-2 text-[12.5px]">{t("This week: {n} sessions", { n: week.length })}{week.length ? ` · ${t("average {s}%", { s: Math.round(week.reduce((n, a) => n + Number(a.score ?? 0), 0) / week.length) })}` : ""}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Link href={href({ kind: "" })} className={chip(!kind)}>{t("All")}</Link>
          <Link href={href({ kind: "article" })} className={chip(kind === "article")}>{t("Reading")}</Link>
          <Link href={href({ kind: "podcast" })} className={chip(kind === "podcast")}>{t("Listening")}</Link>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Link href={href({ level: "" })} className={chip(!level)}>{t("Any level")}</Link>
          {LEVELS.map((l) => <Link key={l} href={href({ level: l })} className={chip(level === l)}>{l}</Link>)}
        </div>
      </PortalCard>
      <PortalCard>
        {list.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("Nothing to practise at this level yet.")}</p> : (
          <ul className="divide-y divide-border/60">
            {list.map((i) => {
              const Icon = i.kind === "podcast" ? Headphones : BookOpenText;
              return (
                <li key={i.id}><Link href={`/student/practice/${i.id}`} className="flex items-center gap-3 py-3">
                  <Icon className="h-4 w-4 shrink-0 text-[#3B4A42]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{i.title}</span>
                    <span className="text-[11.5px] text-muted-foreground">{i.level_min === i.level_max ? i.level_min : `${i.level_min}–${i.level_max}`}{i.minutes ? ` · ${i.minutes} min` : ""} · {t("{n} questions", { n: String((i.questions as unknown[]).length) })}</span>
                  </span>
                  {best.has(i.id) && <Badge tone={best.get(i.id)! >= 70 ? "green" : "amber"}>{Math.round(best.get(i.id)!)}%</Badge>}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link></li>
              );
            })}
          </ul>
        )}
      </PortalCard>
    </>
  );
}
