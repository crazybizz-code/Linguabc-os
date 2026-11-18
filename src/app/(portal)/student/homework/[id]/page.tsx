import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronLeft, X } from "lucide-react";
import { getPortalContext } from "@/lib/portal/context";
import { PortalCard } from "@/components/portal/cards";
import { Badge, cn } from "@/components/ui/primitives";
import { MaterialView } from "@/components/library/material";
import type { AnswerKey, Question } from "@/lib/library/render";
import { intlLocale } from "@/i18n";
import { Quiz } from "./quiz";

export const metadata = { title: "Homework" };

export default async function StudentHomeworkPage({ params }: PageProps<"/student/homework/[id]">) {
  const { id } = await params;
  const ctx = await getPortalContext("student");
  const { supabase, t } = ctx;
  const { data: h } = await supabase.from("homework").select("id, due_at, note, assignments(title, content, library_item_id)").eq("id", id).maybeSingle();
  if (!h) notFound();
  const me = ctx.children[0];
  const [{ data: item }, { data: sub }, { data: result }] = await Promise.all([
    h.assignments?.library_item_id
      ? supabase.from("library_items").select("kind, title, body_html, body_format, audio_url, transcript, author, source_name, licence, source_url").eq("id", h.assignments.library_item_id).maybeSingle()
      : Promise.resolve({ data: null }),
    me ? supabase.from("submissions").select("status, answers").eq("homework_id", id).eq("student_id", me.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("my_homework_result", { p_homework: id }),
  ]);
  const content = (h.assignments?.content ?? {}) as { questions?: Question[]; passage?: string | null };
  const questions = content.questions ?? [];
  const res = result as { status: string; score: number | null; feedback: string | null; answers: Record<string, number | string>; key: AnswerKey | null } | null;
  const due = new Date(h.due_at);
  const late = due.getTime() < Date.parse(new Date().toISOString());

  return (
    <>
      <Link href="/student/homework" className="inline-flex items-center gap-1 px-1 text-[12.5px] text-muted-foreground"><ChevronLeft className="h-4 w-4" /> {t("Homework")}</Link>
      <PortalCard>
        <h1 className="text-[19px] font-semibold leading-snug tracking-[-0.02em]">{h.assignments?.title}</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {t("Due {date}", { date: due.toLocaleString(intlLocale(ctx.locale), { timeZone: "Asia/Tashkent", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
          {late && !res && <span className="ml-1.5 text-[#B4483D]">· {t("past due")}</span>}
        </p>
        {h.note && <p className="mt-3 rounded-[11px] bg-[#F5ECE8]/80 px-3 py-2.5 text-[13px]"><span className="font-medium">{t("From your mentor:")}</span> {h.note}</p>}
      </PortalCard>

      {res && (
        <PortalCard title={t("Your result")} action={res.status === "reviewed" ? <Badge tone="green">{t("Reviewed")}</Badge> : <Badge tone="blue">{t("Submitted")}</Badge>}>
          <p className="text-[30px] font-semibold tracking-[-0.03em]">{res.score != null ? `${Math.round(Number(res.score))}%` : "—"}</p>
          {res.feedback && <p className="mt-2 rounded-[11px] bg-[#F5ECE8]/80 px-3 py-2.5 text-[13px]"><span className="font-medium">{t("Mentor feedback:")}</span> {res.feedback}</p>}
        </PortalCard>
      )}

      {item && <PortalCard><MaterialView item={item} t={t} /></PortalCard>}
      {!item && content.passage && <PortalCard><div className="library-prose whitespace-pre-line">{content.passage}</div></PortalCard>}

      {res ? (
        <PortalCard title={t("Answers")}>
          <ol className="space-y-4">
            {questions.map((q, n) => {
              const mine = res.answers?.[q.id];
              const right = res.key?.[q.id];
              return (
                <li key={q.id} className="text-[13.5px]">
                  <p className="whitespace-pre-line font-medium">{n + 1}. {q.prompt}</p>
                  {q.type === "open" ? (
                    <div className="mt-1.5 whitespace-pre-line rounded-[9px] bg-white/60 px-3 py-2 text-[13px]">{typeof mine === "string" && mine.trim() ? mine : <span className="text-muted-foreground">{t("No answer")}</span>}</div>
                  ) : (
                  <ul className="mt-1.5 space-y-1">
                    {(q.options ?? []).map((o, i) => {
                      const correct = right?.answer === i;
                      const wrongPick = mine === i && !correct;
                      return (
                        <li key={i} className={cn("flex gap-2 rounded-[9px] px-2.5 py-1.5", correct ? "bg-[#E7EFE4] text-[#2F5A3B]" : wrongPick ? "bg-[#F8E1DE] text-[#B4483D]" : "text-[#3B4A42]")}>
                          <span className="w-4 shrink-0">{correct ? <Check className="mt-0.5 h-3.5 w-3.5" /> : wrongPick ? <X className="mt-0.5 h-3.5 w-3.5" /> : null}</span>
                          <span>{o}{mine === i && <span className="ml-1 text-[11px] opacity-70">({t("your answer")})</span>}</span>
                        </li>
                      );
                    })}
                  </ul>
                  )}
                  {right?.explanation && <p className="mt-1.5 text-[12px] text-muted-foreground">{right.explanation}</p>}
                </li>
              );
            })}
          </ol>
        </PortalCard>
      ) : (
        <Quiz homeworkId={h.id} questions={questions} initial={(sub?.answers ?? {}) as Record<string, number | string>} />
      )}
    </>
  );
}
