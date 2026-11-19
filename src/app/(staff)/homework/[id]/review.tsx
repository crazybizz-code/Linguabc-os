"use client";

import { Check, X } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { cn, inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { reviewSubmission } from "../../actions";
import { answerText, correctText, type AnswerKey, type Answers, type Marks, type Question, type QuestionGroup } from "@/lib/questions";
import { useT } from "@/i18n/client";

export function ReviewDialog({ submissionId, student, questions, groups, answers, keyed, marks, score, feedback, reviewed }: {
  submissionId: string; student: string; questions: Question[]; groups?: QuestionGroup[];
  answers: Answers; keyed: AnswerKey; marks: Marks;
  score: number | null; feedback: string | null; reviewed: boolean;
}) {
  const t = useT();
  return (
    <FormDialog subtle trigger={reviewed ? t("Edit review") : t("Review")} title={student} submitLabel={t("Save review")} action={reviewSubmission}
      description={questions.some((q) => q.type === "open") ? t("Multiple-choice answers were marked automatically. Read the written answers and set the final score.") : t("The score was calculated automatically. Adjust it if needed and leave a short note for the student.")}>
      <input type="hidden" name="submission_id" value={submissionId} />
      <ol className="max-h-[42vh] space-y-3 overflow-y-auto rounded-[12px] border border-border/70 bg-white/40 p-3">
        {questions.map((q, n) => {
          const mine = answerText(q, answers[q.id], groups);
          const mark = marks[q.id];
          const ok = mark ? mark.earned === mark.total : null;
          const partly = mark ? mark.earned > 0 && mark.earned < mark.total : false;
          return (
            <li key={q.id} className="text-[12.5px]">
              <p className="flex gap-1.5 font-medium">
                {ok === null ? <span className="text-muted-foreground">–</span>
                  : ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3F6B4A]" />
                  : <X className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", partly ? "text-[#9A5B1E]" : "text-[#B4483D]")} />}
                <span className="whitespace-pre-line">{n + 1}. {q.prompt}</span>
              </p>
              <p className={cn("ml-5 mt-0.5 whitespace-pre-line", ok === null ? "" : ok ? "text-[#3F6B4A]" : "text-[#B4483D]")}>
                {mine ?? t("No answer")}
              </p>
              {ok === false && <p className="ml-5 text-muted-foreground">{t("Correct:")} {correctText(q, keyed[q.id], groups)}</p>}
              {mark && mark.total > 1 && <p className="ml-5 text-[11px] text-muted-foreground">{mark.earned}/{mark.total}</p>}
            </li>
          );
        })}
      </ol>
      <FieldLabel label={t("Score (%)")}>
        <input name="score" type="number" min={0} max={100} step={1} required defaultValue={score != null ? Math.round(score) : ""} className={inputClass} />
      </FieldLabel>
      <FieldLabel label={t("Feedback for the student")} hint={t("Optional")}>
        <textarea name="feedback" rows={3} maxLength={2000} defaultValue={feedback ?? ""} className={`${inputClass} h-auto py-2`} />
      </FieldLabel>
    </FormDialog>
  );
}
