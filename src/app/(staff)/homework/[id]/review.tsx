"use client";

import { Check, X } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { cn, inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { reviewSubmission } from "../../actions";
import type { AnswerKey, Question } from "@/lib/library/render";
import { useT } from "@/i18n/client";

export function ReviewDialog({ submissionId, student, questions, answers, keyed, score, feedback, reviewed }: {
  submissionId: string; student: string; questions: Question[]; answers: Record<string, number>; keyed: AnswerKey;
  score: number | null; feedback: string | null; reviewed: boolean;
}) {
  const t = useT();
  return (
    <FormDialog subtle trigger={reviewed ? t("Edit review") : t("Review")} title={student} submitLabel={t("Save review")} action={reviewSubmission}
      description={t("The score was calculated automatically. Adjust it if needed and leave a short note for the student.")}>
      <input type="hidden" name="submission_id" value={submissionId} />
      <ol className="max-h-[42vh] space-y-3 overflow-y-auto rounded-[12px] border border-border/70 bg-white/40 p-3">
        {questions.map((q, n) => {
          const mine = answers[q.id];
          const right = keyed[q.id]?.answer;
          const ok = mine != null && mine === right;
          return (
            <li key={q.id} className="text-[12.5px]">
              <p className="flex gap-1.5 font-medium">
                {mine == null ? <span className="text-muted-foreground">–</span> : ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3F6B4A]" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#B4483D]" />}
                {n + 1}. {q.prompt}
              </p>
              <p className={cn("ml-5 mt-0.5", ok ? "text-[#3F6B4A]" : "text-[#B4483D]")}>
                {mine == null ? t("No answer") : q.options?.[mine] ?? "—"}
              </p>
              {!ok && right != null && typeof right === "number" && <p className="ml-5 text-muted-foreground">{t("Correct:")} {q.options?.[right]}</p>}
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
