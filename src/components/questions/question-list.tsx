import { Check, X } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import type { T } from "@/i18n";
import {
  answerText, blocksOf, choicesFor, correctText, isChosen, optionLabel, optionText, wordLimit,
  type AnswerKey, type Answers, type Marks, type Question, type QuestionGroup,
} from "@/lib/questions";

/**
 * Questions with their answers — the staff preview of a set, and the
 * student's result after submitting. Marks come from the database, never
 * from comparing in the browser.
 */
export function QuestionList({
  questions, groups, answers, answerKey, marks, t, showMine, start = 1,
}: {
  questions: Question[];
  groups?: QuestionGroup[];
  /** The student's answers, when showing a result. */
  answers?: Answers;
  answerKey: AnswerKey;
  marks?: Marks;
  t: T;
  /** Mark the student's own choice, not just the correct one. */
  showMine?: boolean;
  /** Number of the first question (tests number across sections). */
  start?: number;
}) {
  return (
    <div className="space-y-5">
      {blocksOf(questions, groups, start).map((block, bi) => {
        return (
          <section key={bi} className="space-y-3">
            {block.group?.instructions && (
              <div className="rounded-[12px] bg-[#F5ECE8]/70 px-3.5 py-3">
                {block.group?.instructions && <p className="text-[12.5px] font-medium text-[#3B4A42]">{block.group.instructions}</p>}
                
              </div>
            )}

            <ol className="space-y-4">
              {block.items.map(({ q, n }) => {
                const key = answerKey[q.id];
                const mark = marks?.[q.id];
                const mine = answers?.[q.id];
                const right = mark ? mark.earned === mark.total : undefined;
                const partly = mark ? mark.earned > 0 && mark.earned < mark.total : false;
                const choices = choicesFor(q, groups);

                return (
                  <li key={q.id} className="text-[13.5px]">
                    <p className="flex gap-2 font-medium">
                      {mark && (
                        <span className="mt-0.5 shrink-0">
                          {right ? <Check className="h-4 w-4 text-[#3F6B4A]" /> : <X className={cn("h-4 w-4", partly ? "text-[#9A5B1E]" : "text-[#B4483D]")} />}
                        </span>
                      )}
                      <span className="whitespace-pre-line">{n}. {q.prompt}</span>
                    </p>

                    {q.type === "gap" || q.type === "open" ? (
                      <div className="mt-1.5 space-y-1 pl-6">
                        {showMine && (
                          <p className={cn("whitespace-pre-line rounded-[9px] px-2.5 py-1.5", right === false ? "bg-[#F8E1DE] text-[#B4483D]" : "bg-white/70")}>
                            {answerText(q, mine, groups) ?? <span className="text-muted-foreground">{t("No answer")}</span>}
                          </p>
                        )}
                        {q.type === "gap" && key && (
                          <p className="text-[12px] text-[#2F5A3B]">
                            {t("Accepted:")} {correctText(q, key, groups)}
                            <span className="ml-1.5 text-muted-foreground">({wordLimit(q)})</span>
                          </p>
                        )}
                        {q.type === "open" && <p className="text-[12px] text-muted-foreground">{t("Open answer — graded by the mentor.")}</p>}
                      </div>
                    ) : (
                      <ul className="mt-1.5 space-y-1">
                        {choices.map((text, i) => {
                          const correct = isChosen(q, i, key?.answer as never);
                          const picked = showMine && isChosen(q, i, mine);
                          return (
                            <li
                              key={i}
                              className={cn(
                                "flex gap-2 rounded-[9px] px-2.5 py-1.5",
                                correct ? "bg-[#E7EFE4] text-[#2F5A3B]" : picked ? "bg-[#F8E1DE] text-[#B4483D]" : "text-[#3B4A42]",
                              )}
                            >
                              <span className="w-5 shrink-0 font-medium">
                                {correct ? <Check className="mt-0.5 h-3.5 w-3.5" /> : picked ? <X className="mt-0.5 h-3.5 w-3.5" /> : optionLabel(i, q.type)}
                              </span>
                              <span>
                                {optionText(text)}
                                {picked && <span className="ml-1 text-[11px] opacity-70">({t("your answer")})</span>}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {key?.explanation && <p className="mt-1.5 pl-6 text-[12px] text-muted-foreground">{key.explanation}</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
