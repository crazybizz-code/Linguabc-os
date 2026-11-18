import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, Layers, Sparkles, Upload } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge } from "@/components/ui/primitives";
import { monthStartISO } from "@/lib/dates";

export const metadata = { title: "Create assignment" };

const WAYS: { icon: typeof Upload; title: string; desc: string; points: string[]; href: string | null }[] = [
  { icon: Upload, title: "Upload your material", desc: "Bring a worksheet you already trust. PDF, DOCX or plain text.",
    points: ["PDF, DOCX, TXT", "Existing worksheet", "Questions extracted for you"], href: "/homework/new/upload" },
  { icon: Layers, title: "Choose from LinguABC Library", desc: "Curated articles and podcasts, organised by skill, level and topic.",
    points: ["Reading and listening", "Filter by level and topic", "Ready to assign in one click"], href: "/homework/library" },
  { icon: Sparkles, title: "Create with AI", desc: "Describe the exact sub-skill you want to drill this week.",
    points: ["Skill and sub-skill targeting", "Choose level and question count", "Edit the result before assigning"], href: "/homework/new/ai" },
];

export default async function NewAssignmentPage() {
  const { t, supabase, workspace, isAdmin } = await getStaffContext();
  // Owners and admins see what AI drafting has cost this month (RLS: admins only).
  const { data: usage } = isAdmin
    ? await supabase.from("ai_requests").select("cost_usd, ok, prompt_tokens, completion_tokens").eq("center_id", workspace.centerId).gte("created_at", `${monthStartISO()}T00:00:00+05:00`)
    : { data: null };
  const done = (usage ?? []).filter((u) => u.ok);
  const cost = done.reduce((a, u) => a + Number(u.cost_usd ?? 0), 0);
  const tokens = done.reduce((a, u) => a + (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0), 0);
  return (
    <div className="space-y-6">
      <Link href="/homework" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Homework")}</Link>
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{t("Create assignment")}</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">{t("Three ways in. Pick whichever matches the material you already have.")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {WAYS.map((w) => {
          const inner = (
            <>
              <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-[#F5ECE8]"><w.icon className="h-[18px] w-[18px] text-[#3B4A42]" /></span>
              <div className="mt-5 flex items-center gap-2">
                <h2 className="text-[15px] font-semibold">{t(w.title)}</h2>
                {!w.href && <Badge tone="neutral">{t("Coming soon")}</Badge>}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{t(w.desc)}</p>
              <ul className="mt-4 space-y-1.5">
                {w.points.map((p) => <li key={p} className="flex items-center gap-2 text-[12.5px] text-[#3B4A42]"><Check className="h-3.5 w-3.5" /> {t(p)}</li>)}
              </ul>
              {w.href && <span className="mt-5 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#12392B]">{t("Start here")} <ArrowRight className="h-3.5 w-3.5" /></span>}
            </>
          );
          return w.href ? (
            <Link key={w.title} href={w.href} className="rounded-[18px] border border-border/70 bg-[#FCF8F4] p-5 transition-colors hover:bg-white/70">{inner}</Link>
          ) : (
            <div key={w.title} aria-disabled className="rounded-[18px] border border-border/70 bg-[#FCF8F4] p-5 opacity-70">{inner}</div>
          );
        })}
      </div>
      {isAdmin && (
        <p className="text-[12px] text-muted-foreground">
          {t("AI this month: {n} drafts · {tokens} tokens · ${cost}", { n: done.length, tokens: tokens.toLocaleString("en-US"), cost: cost.toFixed(2) })}
          {done.length > 0 && ` · ${t("about ${avg} per draft", { avg: (cost / done.length).toFixed(3) })}`}
        </p>
      )}
    </div>
  );
}
