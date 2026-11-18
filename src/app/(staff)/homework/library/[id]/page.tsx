import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card, cn } from "@/components/ui/primitives";
import { levelRange, type AnswerKey, type Question } from "@/lib/library/render";
import { MaterialView } from "@/components/library/material";
import { todayISO } from "@/lib/dates";
import { AssignDialog } from "./assign";

export const metadata = { title: "Library item" };

export default async function LibraryItemPage({ params }: PageProps<"/homework/library/[id]">) {
  const { id } = await params;
  const { supabase, workspace, t } = await getStaffContext();
  const [{ data: item }, { data: key }, { data: groups }] = await Promise.all([
    supabase.from("library_items").select("*").eq("id", id).eq("status", "published").maybeSingle(),
    supabase.from("library_answer_keys").select("answers").eq("item_id", id).maybeSingle(),
    supabase.from("groups").select("id, name").eq("center_id", workspace.centerId).eq("status", "active").order("name"),
  ]);
  if (!item) notFound();
  const questions = (item.questions ?? []) as Question[];
  const answers = (key?.answers ?? {}) as AnswerKey;
  const due = new Date(`${todayISO()}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 3);

  return (
    <div className="space-y-5">
      <Link href="/homework/library" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Library")}</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <Badge tone="neutral" dot={false}>{levelRange(item.level_min, item.level_max)}</Badge>
            {t(item.kind === "podcast" ? "Podcast" : "Article")} · {item.source_name}
          </div>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.03em]">{item.title}</h1>
          {item.summary && <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{item.summary}</p>}
        </div>
        <AssignDialog itemId={item.id} groups={groups ?? []} defaultDue={due.toISOString().slice(0, 10)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card className="p-6">
          <MaterialView item={item} t={t} />
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold">{t("Questions")}</h2>
            <p className="mb-3 text-[12px] text-muted-foreground">{t("Correct answers are shown to staff only.")}</p>
            <ol className="space-y-4">
              {questions.map((q, n) => (
                <li key={q.id} className="text-[13px]">
                  <p className="font-medium">{n + 1}. {q.prompt}</p>
                  <ul className="mt-1.5 space-y-1">
                    {(q.options ?? []).map((o, i) => {
                      const ok = answers[q.id]?.answer === i;
                      return (
                        <li key={i} className={cn("flex gap-2 rounded-[8px] px-2.5 py-1.5", ok ? "bg-[#E7EFE4] text-[#2F5A3B]" : "text-[#3B4A42]")}>
                          <span className="w-4 shrink-0">{ok ? <Check className="mt-0.5 h-3.5 w-3.5" /> : String.fromCharCode(65 + i)}</span>{o}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </Card>
          {Array.isArray(item.vocabulary) && item.vocabulary.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-2 text-[15px] font-semibold">{t("Key vocabulary")}</h2>
              <ul className="divide-y divide-border/60">
                {(item.vocabulary as { word: string; definition?: string }[]).slice(0, 10).map((v) => (
                  <li key={v.word} className="py-2 text-[12.5px]"><span className="font-medium">{v.word}</span>{v.definition && <span className="text-muted-foreground"> — {v.definition}</span>}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
