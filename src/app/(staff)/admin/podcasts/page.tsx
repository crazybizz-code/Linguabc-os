import Link from "next/link";
import { Plus } from "lucide-react";
import { getPlatformContext } from "@/lib/auth/platform";
import { Badge, buttonPrimary, Card, type Tone } from "@/components/ui/primitives";
import { LEVELS } from "@/lib/ai/draft";

export const metadata = { title: "LinguABC podcasts" };
const TONE: Record<string, Tone> = { draft: "amber", published: "green", hidden: "neutral" };

export default async function LibraryPodcastsPage({ searchParams }: PageProps<"/admin/podcasts">) {
  const { level } = await searchParams;
  const { supabase, t } = await getPlatformContext();
  const [{ data: items }, { count: articles }] = await Promise.all([
    supabase.from("library_items").select("id, title, level_min, level_max, status, duration_seconds, source_name, updated_at, created_at")
      .eq("kind", "podcast").order("created_at", { ascending: false }),
    supabase.from("library_items").select("id", { count: "exact", head: true }).eq("kind", "article").eq("status", "published"),
  ]);
  const all = items ?? [];
  const published = all.filter((x) => x.status === "published");
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, published.filter((x) => x.level_min === l).length]));
  const shown = typeof level === "string" && (LEVELS as readonly string[]).includes(level) ? all.filter((x) => x.level_min === level) : all;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{t("LinguABC podcasts")}</h1>
          <p className="mt-1 max-w-[640px] text-[13.5px] text-muted-foreground">
            {t("Original listening episodes from A1 to C2, recorded with Fish Audio, for every centre's homework library. Only LinguABC admins see this page.")}
          </p>
        </div>
        <Link href="/admin/podcasts/new" className={buttonPrimary}><Plus className="h-4 w-4" /> {t("New podcast")}</Link>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[14px] font-medium">{t("{a} of {b} published", { a: String(published.length), b: String(articles ?? 0) })}</p>
          <p className="text-[12px] text-muted-foreground">{t("Goal: as many podcasts as articles, at every level")}</p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#F5ECE8]">
          <div className="h-full rounded-full bg-[#12392B]" style={{ width: `${Math.min(100, (published.length / Math.max(1, articles ?? 1)) * 100)}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/admin/podcasts" className="rounded-full border border-border/80 px-3 py-1 text-[12px] hover:bg-white">{t("All")} · {all.length}</Link>
          {LEVELS.map((l) => (
            <Link key={l} href={`/admin/podcasts?level=${l}`}
              className={`rounded-full border px-3 py-1 text-[12px] hover:bg-white ${level === l ? "border-[#12392B] font-medium" : "border-border/80"} ${byLevel[l] === 0 ? "text-[#B4483D]" : ""}`}>
              {l} · {byLevel[l]}
            </Link>
          ))}
        </div>
      </Card>

      <Card className="divide-y divide-border/60">
        {shown.length === 0 && <p className="p-6 text-[13px] text-muted-foreground">{t("No podcasts yet.")}</p>}
        {shown.map((x) => (
          <Link key={x.id} href={`/admin/podcasts/${x.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-white/60">
            <div>
              <p className="text-[14px] font-medium">{x.title}</p>
              <p className="text-[12px] text-muted-foreground">
                {x.level_min === x.level_max ? x.level_min : `${x.level_min}–${x.level_max}`}
                {x.duration_seconds ? ` · ${Math.round(x.duration_seconds / 60)} min` : ""} · {x.source_name ?? ""}
              </p>
            </div>
            <Badge tone={TONE[x.status]}>{t(x.status === "published" ? "Published" : x.status === "hidden" ? "Hidden" : "Draft")}</Badge>
          </Link>
        ))}
      </Card>
    </div>
  );
}
