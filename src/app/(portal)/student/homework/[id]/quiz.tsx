"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { buttonPrimary } from "@/components/ui/primitives";
import { AnswerInput } from "@/components/questions/answer-input";
import { blocksOf, isAnswered, type Answers, type Question, type QuestionGroup } from "@/lib/questions";
import { saveHomework } from "../../../actions";
import { useT } from "@/i18n/client";

export function Quiz({
  homeworkId, questions, groups, initial,
}: {
  homeworkId: string;
  questions: Question[];
  groups?: QuestionGroup[];
  initial: Answers;
}) {
  const [answers, setAnswers] = useState<Answers>(initial);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const t = useT();
  const [pending, start] = useTransition();
  const router = useRouter();

  const answered = questions.filter((q) => isAnswered(q, answers[q.id])).length;
  const set = (id: string, v: Answers[string]) => {
    setMsg({});
    setConfirm(false);
    setAnswers((a) => ({ ...a, [id]: v }));
  };
  const save = (submit: boolean) =>
    start(async () => {
      setMsg({});
      const r = await saveHomework(homeworkId, answers, submit);
      if (r.error) setMsg({ error: r.error });
      else {
        setMsg({ ok: submit ? t("Submitted") : t("Progress saved") });
        setConfirm(false);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      {blocksOf(questions, groups).map((block, bi) => {
        return (
          <div key={bi} className="space-y-3">
            {block.group?.instructions && (
              <div className="rounded-[14px] border border-border/70 bg-[#F5ECE8]/80 px-4 py-3">
                {block.group?.instructions && <p className="text-[13px] font-medium text-[#17211D]">{block.group.instructions}</p>}
                
              </div>
            )}

            {block.items.map(({ q, n }) => (
              <fieldset key={q.id} className="rounded-[16px] border border-border/70 bg-[#FCF8F4] p-4">
                <legend className="sr-only">Question {n}</legend>
                <p className="whitespace-pre-line text-[14px] font-medium leading-snug">
                  {n}.{q.type === "gap" ? "" : ` ${q.prompt}`}
                </p>
                <AnswerInput q={q} groups={groups} value={answers[q.id]} onChange={(v) => set(q.id, v)} />
                {q.type === "open" && typeof answers[q.id] === "string" && (
                  <p className="mt-1 text-right text-[11px] text-muted-foreground">
                    {(answers[q.id] as string).trim().split(/\s+/).filter(Boolean).length} words
                  </p>
                )}
              </fieldset>
            ))}
          </div>
        );
      })}

      <div className="sticky bottom-20 z-[5] rounded-[16px] border border-border/70 bg-[#FCF8F4]/95 p-3 shadow-[0_4px_16px_rgba(23,33,29,0.06)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-muted-foreground">{answered} of {questions.length} answered</span>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => save(false)} className="h-10 rounded-[11px] border border-border/80 px-3.5 text-[13px] font-medium">
              {t("Save")}
            </button>
            {confirm ? (
              <button type="button" disabled={pending} onClick={() => save(true)} className={buttonPrimary}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Confirm submit")}
              </button>
            ) : (
              <button type="button" disabled={pending || answered === 0} onClick={() => setConfirm(true)} className={buttonPrimary}>
                {t("Submit")}
              </button>
            )}
          </div>
        </div>
        {confirm && answered < questions.length && (
          <p className="mt-2 text-[12px] text-[#9A5B1E]">
            {t("{n} question(s) unanswered. You can't change answers after submitting.", { n: questions.length - answered })}
          </p>
        )}
        {confirm && answered === questions.length && (
          <p className="mt-2 text-[12px] text-muted-foreground">{t("You can't change answers after submitting.")}</p>
        )}
        {msg.error && <p className="mt-2 text-[12px] text-[#B4483D]">{t(msg.error)}</p>}
        {msg.ok && (
          <p className="mt-2 flex items-center gap-1 text-[12px] text-[#3F6B4A]">
            <Check className="h-3.5 w-3.5" />
            {msg.ok}
          </p>
        )}
      </div>
    </div>
  );
}
