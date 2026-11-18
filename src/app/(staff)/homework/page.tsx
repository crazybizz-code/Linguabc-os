import Link from "next/link";
import { BookOpen, ChevronRight, Layers, Plus, Sparkles, Upload } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, buttonPrimary, Card, cn, EmptyState, PageHeader } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Homework" };
const TZ = "Asia/Tashkent";
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default async function HomeworkPage({ searchParams }: PageProps<"/homework">) {
  const { tab } = await searchParams;
  const past = tab === "completed";
  const mine = tab === "assignments";
  const { supabase, workspace, t, locale } = await getStaffContext();
  const L = intlLocale(locale);
  const nowIso = new Date().toISOString();

  const { data: own } = mine
    ? await supabase.from("assignments").select("id, title, skill, level, source, status, created_at").eq("center_id", workspace.centerId)
        .in("source", ["upload", "ai"]).order("created_at", { ascending: false }).limit(100)
    : { data: null };
  // RLS limits mentors to the groups they teach.
  let q = supabase.from("homework").select("id, due_at, note, assigned_at, groups(name), assignments(title, skill, content)")
    .eq("center_id", workspace.centerId);
  q = past ? q.lt("due_at", nowIso).order("due_at", { ascending: false }) : q.gte("due_at", nowIso).order("due_at");
  const { data: list } = await q.limit(100);
  const ids = (list ?? []).map((h) => h.id);
  const { data: subs } = ids.length
    ? await supabase.from("submissions").select("homework_id, status, score").in("homework_id", ids)
    : { data: [] };
  const stats = new Map<string, { total: number; done: number; scores: number[] }>();
  (subs ?? []).forEach((s) => {
    const x = stats.get(s.homework_id) ?? { total: 0, done: 0, scores: [] };
    x.total++;
    if (s.status === "submitted" || s.status === "reviewed") x.done++;
    if (s.score != null) x.scores.push(Number(s.score));
    stats.set(s.homework_id, x);
  });

  const tabs = (
    <div className="flex rounded-[11px] border border-border/70 bg-[#FCF8F4] p-1 text-[12.5px]">
      {[["Assigned", "/homework", !past && !mine], ["Past due", "/homework?tab=completed", past], ["Assignments", "/homework?tab=assignments", mine], ["Library", "/homework/library", false]].map(([label, href, on]) => (
        <Link key={label as string} href={href as string} className={cn("rounded-[8px] px-3 py-1.5", on ? "bg-[#F5ECE8] font-medium text-[#17211D]" : "text-muted-foreground")}>
          {t(label as string)}
        </Link>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t("Academic operations")}
        title={t("Homework")}
        description={t("Assign, track and review work. Every submission updates the student's academic record.")}
        actions={<>{tabs}<Link href="/homework/new" className={buttonPrimary}><Plus className="h-4 w-4" /> {t("Create assignment")}</Link></>}
      />
      {mine ? (
        <Card className="overflow-hidden">
          {!own?.length ? (
            <EmptyState icon={BookOpen} title={t("No assignments of your own yet")} description={t("Upload a worksheet or create one with AI — it will be kept here to reuse.")}
              action={<Link href="/homework/new" className={buttonPrimary}>{t("Create assignment")}</Link>} />
          ) : (
            <ul className="divide-y divide-border/60">
              {own.map((a) => (
                <li key={a.id}>
                  <Link href={`/homework/assignments/${a.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{a.title}</p>
                      <p className="text-[11.5px] text-muted-foreground">{[t(a.source === "ai" ? "Created with AI" : "Uploaded worksheet"), t(cap(a.skill)), a.level].filter(Boolean).join(" · ")}</p>
                    </div>
                    <Badge tone={a.status === "approved" ? "green" : a.status === "pending_approval" ? "amber" : "neutral"}>
                      {t(a.status === "approved" ? "Approved" : a.status === "pending_approval" ? "Waiting for approval" : "Draft")}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
      <Card className="overflow-hidden">
        {!list?.length ? (
          <EmptyState icon={BookOpen} title={past ? t("Nothing past due yet") : t("No homework assigned")}
            description={t("Pick something from the LinguABC library and set it for a group — it takes under a minute.")}
            action={<Link href="/homework/library" className={buttonPrimary}>{t("Open the library")}</Link>} />
        ) : (
          <ul className="divide-y divide-border/60">
            {list.map((h) => {
              const x = stats.get(h.id) ?? { total: 0, done: 0, scores: [] };
              const pct = x.total ? Math.round((x.done / x.total) * 100) : 0;
              const avg = x.scores.length ? Math.round(x.scores.reduce((a, b) => a + b, 0) / x.scores.length) : null;
              const content = h.assignments?.content as { questions?: unknown[] } | null;
              return (
                <li key={h.id}>
                  <Link href={`/homework/${h.id}`} className="flex flex-wrap items-center gap-4 px-5 py-3.5 hover:bg-white/60">
                    <div className="min-w-[220px] flex-1">
                      <p className="text-[13.5px] font-medium">{h.assignments?.title}</p>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {[h.groups?.name, h.assignments?.skill && t(cap(h.assignments.skill)),
                          t("{n} questions", { n: content?.questions?.length ?? 0 }),
                          t("due {date}", { date: new Date(h.due_at).toLocaleString(L, { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })]
                          .filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="w-[150px]">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#EFE6DF]"><div className="h-full rounded-full bg-[#12392B]" style={{ width: `${pct}%` }} /></div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{t("{a}/{b} submitted", { a: x.done, b: x.total })}</p>
                    </div>
                    {avg != null ? <Badge tone="neutral" dot={false}>{avg}%</Badge> : <span className="w-[42px]" />}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          [Upload, "Upload your material", "PDF, DOCX or an existing worksheet.", "/homework/new/upload"],
          [Layers, "LinguABC library", "Curated articles and podcasts with ready questions.", "/homework/library"],
          [Sparkles, "Create with AI", "Targeted practice on a specific sub-skill.", "/homework/new/ai"],
        ].map(([Icon, title, desc, href]) => {
          const I = Icon as typeof Upload;
          return (
            <Link key={title as string} href={href as string} className="flex items-center gap-3 rounded-[16px] border border-border/70 bg-[#FCF8F4] p-4 hover:bg-white/70">
              <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5ECE8]"><I className="h-4 w-4 text-[#3B4A42]" /></span>
              <span><span className="block text-[13px] font-medium">{t(title as string)}</span><span className="block text-[11.5px] text-muted-foreground">{t(desc as string)}</span></span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
