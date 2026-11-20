import Link from "next/link";
import { getPlatformContext } from "@/lib/auth/platform";
import { Badge, Card, type Tone } from "@/components/ui/primitives";
import { NewTestForm } from "./new-test";

export const metadata = { title: "LinguABC tests" };
const TONE: Record<string, Tone> = { draft: "amber", published: "green", hidden: "neutral" };

export default async function LibraryTestsPage() {
  const { supabase, t } = await getPlatformContext();
  const { data: tests } = await supabase.from("library_tests")
    .select("id, title, skill, level, status, question_count, updated_at").order("updated_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">{t("LinguABC tests")}</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          {t("Full IELTS Academic reading and listening tests for every centre. Only LinguABC admins see this page.")}
        </p>
      </div>
      <NewTestForm />
      <Card className="divide-y divide-border/60">
        {(tests ?? []).length === 0 && <p className="p-6 text-[13px] text-muted-foreground">{t("No tests yet.")}</p>}
        {(tests ?? []).map((x) => (
          <Link key={x.id} href={`/admin/tests/${x.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-white/60">
            <div>
              <p className="text-[14px] font-medium">{x.title}</p>
              <p className="text-[12px] text-muted-foreground">
                {t(x.skill === "listening" ? "Listening" : "Reading")}{x.level ? ` · ${x.level}` : ""} · {t("{n} of 40 questions", { n: String(x.question_count) })}
              </p>
            </div>
            <Badge tone={TONE[x.status]}>{t(x.status === "published" ? "Published" : x.status === "hidden" ? "Hidden" : "Draft")}</Badge>
          </Link>
        ))}
      </Card>
    </div>
  );
}
