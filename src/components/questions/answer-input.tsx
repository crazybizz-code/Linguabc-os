"use client";

import type { ReactNode } from "react";

import { cn } from "@/components/ui/primitives";
import {
  choicesFor, choiceValue, isChosen, optionLabel, optionText, selectCount, splitGap, wordLimit,
  type AnswerValue, type Question, type QuestionGroup,
} from "@/lib/questions";

/**
 * The input for one question, in the shape the exam uses: options to pick,
 * a pool to match against, a word-limited gap, or a writing box.
 */
export function AnswerInput({
  q, groups, value, disabled, onChange, text = (s) => s,
}: {
  q: Question;
  groups?: QuestionGroup[];
  value: AnswerValue | undefined;
  disabled?: boolean;
  onChange: (v: AnswerValue) => void;
  /** Renders a piece of question or option text (the exam uses it for highlighting). */
  text?: (s: string, key: string) => ReactNode;
}) {
  const choices = choicesFor(q, groups);

  if (q.type === "open") {
    return (
      <textarea
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={8}
        maxLength={20000}
        placeholder="Write your answer here…"
        className="mt-3 w-full rounded-[11px] border border-border/80 bg-white/60 p-3 text-[14px] leading-relaxed focus:border-[#12392B]/35 focus:outline-none disabled:opacity-60"
      />
    );
  }

  if (q.type === "gap") {
    const parts = splitGap(q.prompt);
    const box = (
      <input
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={120}
        aria-label={`Answer for question: ${q.prompt}`}
        className={cn(
          "h-10 rounded-[9px] border border-border/80 bg-white/70 px-3 text-[14px] focus:border-[#12392B]/40 focus:outline-none disabled:opacity-60",
          parts ? "mx-1 w-[150px] align-baseline" : "mt-3 w-full",
        )}
      />
    );
    return (
      <>
        {parts ? (
          <p className="mt-2 text-[14px] leading-[2.2]">{text(parts[0], `${q.id}-a`)}{box}{text(parts[1], `${q.id}-b`)}</p>
        ) : (
          <>
            <p className="mt-2 whitespace-pre-line text-[14px]">{text(q.prompt, `${q.id}-a`)}</p>
            {box}
          </>
        )}
        <p className="mt-1.5 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
          Write no more than {wordLimit(q)}
        </p>
      </>
    );
  }

  const multi = q.type === "multi";
  const need = multi ? selectCount(q) : 1;
  const chosen = multi && Array.isArray(value) ? value.length : 0;

  return (
    <>
      {multi && (
        <p className="mt-2 text-[11.5px] font-medium text-[#9A5B1E]">
          Choose {need === 2 ? "TWO" : need === 3 ? "THREE" : need} answers{chosen > 0 ? ` · ${chosen} chosen` : ""}
        </p>
      )}
      <div className={cn("mt-3 space-y-2", (q.type === "tfng" || q.type === "ynng") && "flex flex-wrap gap-2 space-y-0")}>
        {choices.map((label, i) => {
          const on = isChosen(q, i, value);
          const compact = q.type === "tfng" || q.type === "ynng";
          return (
            <label
              key={i}
              // Selecting option text to highlight it must not pick the option.
              onClick={(e) => { if (window.getSelection()?.toString()) e.preventDefault(); }}
              className={cn(
                "flex cursor-pointer gap-3 border text-[13.5px] transition-colors",
                compact ? "items-center rounded-full px-3.5 py-2" : "rounded-[11px] px-3 py-2.5",
                on ? "border-[#12392B] bg-[#12392B]/[0.06] font-medium" : "border-border/80 bg-white/50 hover:bg-white",
                disabled && "cursor-default opacity-60",
              )}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                name={q.id}
                className="mt-0.5 accent-[#12392B]"
                checked={on}
                disabled={disabled}
                onChange={() => {
                  if (!multi) return onChange(choiceValue(q, i));
                  const list = Array.isArray(value) ? value : [];
                  onChange(on ? list.filter((x) => x !== i) : [...list, i].sort((a, b) => a - b));
                }}
              />
              <span>
                {!compact && <span className="mr-1.5 font-medium text-[#5F6B66]">{optionLabel(i, q.type)}</span>}
                {text(optionText(label), `${q.id}-o${i}`)}
              </span>
            </label>
          );
        })}
      </div>
    </>
  );
}
