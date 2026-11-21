"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, RotateCcw, X } from "lucide-react";
import { buttonPrimary, buttonSecondary, cn } from "@/components/ui/primitives";
import { AnswerInput } from "@/components/questions/answer-input";
import { useT } from "@/i18n/client";
import { isAnswered, type Answers, type Question } from "@/lib/questions";
import { checkPractice } from "../../../actions";

/** Answers a library item for practice; the database marks it and says which answers were right. */
export function PracticeQuiz({ itemId, questions }: { itemId: string; questions: Question[] }) {
  const t = useT();
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<{ score: number | null; earned: number; total: number; correct: Record<string, boolean> }>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const answered = questions.filter((q) => isAnswered(q, answers[q.id])).length;

  return (
    <div className="space-y-3">
      {questions.map((q, i) => {
        const ok = result?.correct[q.id];
        return (
          <fieldset key={q.id} className={cn("rounded-[16px] border bg-[#FCF8F4] p-4", result ? (ok ? "border-[#BFD8C4]" : "border-[#E8C4BE]") : "border-border/70")}>
            <p className="flex items-start gap-2 whitespace-pre-line text-[14px] font-medium leading-snug">
              {result && (ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3F6B4A]" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-[#B4483D]" />)}
              <span>{i + 1}.{q.type === "gap" ? "" : ` ${q.prompt}`}</span>
            </p>
            <AnswerInput q={q} value={answers[q.id]} onChange={(v) => { if (!result) setAnswers((a) => ({ ...a, [q.id]: v })); }} />
          </fieldset>
        );
      })}
      <div className="sticky bottom-20 z-[5] rounded-[16px] border border-border/70 bg-[#FCF8F4]/95 p-3 backdrop-blur">
        {result ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-semibold">{t("{a} of {b} correct", { a: String(result.earned), b: String(result.total) })}{result.score != null ? ` · ${Math.round(result.score)}%` : ""}</span>
            <button type="button" className={buttonSecondary} onClick={() => { setResult(undefined); setAnswers({}); }}><RotateCcw className="h-4 w-4" /> {t("Try again")}</button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-muted-foreground">{t("{a} of {b} answered", { a: String(answered), b: String(questions.length) })}</span>
            <button type="button" disabled={pending || answered === 0} className={buttonPrimary}
              onClick={() => start(async () => { setError(undefined); const r = await checkPractice(itemId, answers); if (r.error) setError(r.error); else setResult(r.result); })}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Check my answers")}
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-[12px] text-[#B4483D]">{t(error)}</p>}
      </div>
    </div>
  );
}
