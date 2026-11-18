import Link from "next/link";
import { ChevronLeft, ChevronRight, Headphones, Library, Newspaper, Search } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card, cn, EmptyState, inputClass, PageHeader } from "@/components/ui/primitives";
import { LEVELS, levelRange } from "@/lib/library/render";

export const metadata = { title: "Library" };
const PAGE = 24;
const filterClass = "h-10 rounded-[10px] border border-border/80 bg-[#FCF8F4] pl-3 pr-8 text-[13px] text-[#17211D] focus:outline-none";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LibraryPage({ searchParams }: PageProps<"/homework/library">) {
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80);
  const kind = ["article", "podcast"].includes(one(sp.kind)) ? one(sp.kind) : "";
  const level = (LEVELS as readonly string[]).includes(one(sp.level)) ? one(sp.level) : "";
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const { supabase, t } = await getStaffContext();

  let query = supabase.from("library_items")
    .select("id, kind, title, summary, description, level_min, level_max, topics, minutes, duration_seconds, source_name, questions", { count: "exact" })
    .eq("status", "published");
  if (kind) query = query.eq("kind", kind);
  if (level) query = query.lte("level_min", level).gte("level_max", level);
  if (q) query = query.ilike("title", `%${q.replace(/[%_\\]/g, "")}%`);
  const { data: items, count } = await query.order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const href = (p: Record<string, string | number>) => {
    const u = new URLSearchParams({ ...(q && { q }), ...(kind && { kind }), ...(level && { level }) });
    Object.entries(p).forEach(([k, v]) => (v ? u.set(k, String(v)) : u.delete(k)));
    const s = u.toString();
    return `/homework/library${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <Link href="/homework" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Homework")}</Link>
      <PageHeader eyebrow={t("LinguABC library")} title={t("Library")}
        description={t("Curated articles and podcasts, each with comprehension questions. Open one to preview it and set it for a group.")} />

      <form className="flex flex-wrap items-center gap-2" action="/homework/library">
        <label className="relative w-full sm:w-auto sm:min-w-[280px] sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder={t("Search titles")} className={cn(inputClass, "pl-9")} />
        </label>
        <select name="kind" defaultValue={kind} className={filterClass}>
          <option value="">{t("All types")}</option>
          <option value="article">{t("Articles")}</option>
          <option value="podcast">{t("Podcasts")}</option>
        </select>
        <select name="level" defaultValue={level} className={filterClass}>
          <option value="">{t("All levels")}</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button className="h-10 rounded-[10px] border border-border/80 bg-[#FCF8F4] px-4 text-[13px] font-medium">{t("Filter")}</button>
        <span className="ml-auto text-[12px] text-muted-foreground">{t("{n} items", { n: count ?? 0 })}</span>
      </form>

      {!items?.length ? (
        <Card><EmptyState icon={Library} title={t("Nothing in the library matches")} description={t("Try another level or clear the search.")} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => {
            const Icon = i.kind === "podcast" ? Headphones : Newspaper;
            const mins = i.kind === "podcast" && i.duration_seconds ? Math.round(i.duration_seconds / 60) : i.minutes;
            return (
              <Link key={i.id} href={`/homework/library/${i.id}`} className="flex flex-col rounded-[16px] border border-border/70 bg-[#FCF8F4] p-4 transition-colors hover:bg-white/70">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" /> {t(i.kind === "podcast" ? "Podcast" : "Article")}
                  {mins ? <>· {t("{n} min", { n: mins })}</> : null}
                  <span className="ml-auto"><Badge tone="neutral" dot={false}>{levelRange(i.level_min, i.level_max)}</Badge></span>
                </div>
                <p className="mt-2 line-clamp-2 text-[14px] font-medium leading-snug">{i.title}</p>
                {(i.summary || i.description) && <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{i.summary || i.description}</p>}
                <p className="mt-auto pt-3 text-[11px] text-muted-foreground">
                  {[i.source_name, t("{n} questions", { n: Array.isArray(i.questions) ? i.questions.length : 0 }), ...(i.topics ?? []).slice(0, 2)].filter(Boolean).join(" · ")}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-[12.5px]">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="flex items-center gap-1 rounded-[9px] border border-border/80 px-3 py-1.5"><ChevronLeft className="h-4 w-4" />{t("Previous")}</Link> : <span />}
          <span className="text-muted-foreground">{t("Page {a} of {b}", { a: page, b: pages })}</span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="flex items-center gap-1 rounded-[9px] border border-border/80 px-3 py-1.5">{t("Next")}<ChevronRight className="h-4 w-4" /></Link> : <span />}
        </div>
      )}
    </div>
  );
}
