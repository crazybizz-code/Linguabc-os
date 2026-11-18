import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, Layers, Sparkles, Upload } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge } from "@/components/ui/primitives";

export const metadata = { title: "Create assignment" };

const WAYS = [
  { icon: Upload, title: "Upload your material", desc: "Bring a worksheet you already trust. PDF, DOCX or plain text.",
    points: ["PDF, DOCX, TXT", "Existing worksheet", "Questions extracted for you"], href: null },
  { icon: Layers, title: "Choose from LinguABC Library", desc: "Curated articles and podcasts, organised by skill, level and topic.",
    points: ["Reading and listening", "Filter by level and topic", "Ready to assign in one click"], href: "/homework/library" },
  { icon: Sparkles, title: "Create with AI", desc: "Describe the exact sub-skill you want to drill this week.",
    points: ["Skill and sub-skill targeting", "Choose level and question count", "Edit the result before assigning"], href: null },
] as const;

export default async function NewAssignmentPage() {
  const { t } = await getStaffContext();
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
    </div>
  );
}
