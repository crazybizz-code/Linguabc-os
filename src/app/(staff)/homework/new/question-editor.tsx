"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn, inputClass } from "@/components/ui/primitives";
import { optionLabel, TFNG, YNNG, CHOICE_LABEL, type QuestionType } from "@/lib/questions";
import { emptyQuestion, type DraftGroup, type DraftQuestion } from "@/lib/ai/draft";
import { useT } from "@/i18n/client";

const TYPE_LABEL: Record<QuestionType, string> = {
  mc: "Multiple choice",
  multi: "Choose several",
  tfng: "True / False / Not Given",
  ynng: "Yes / No / Not Given",
  gap: "Gap fill",
  matching: "Matching",
  headings: "Matching headings",
  open: "Open answer",
};
export const TYPE_ORDER: QuestionType[] = ["mc", "multi", "tfng", "ynng", "gap", "matching", "headings", "open"];
export const typeLabel = (t: QuestionType) => TYPE_LABEL[t];

const area = `${inputClass} h-auto py-2 leading-relaxed`;
const small = cn(inputClass, "h-9 text-[13px]");

/** What is still missing before this question can be saved, if anything. */
export function questionProblem(q: DraftQuestion, groups: DraftGroup[]): string | null {
  if (!q.prompt.trim()) return "needs a question";
  const opts = q.options.filter((o) => o.trim()).length;
  const pool = groups.find((g) => g.id === q.group)?.options.filter((o) => o.trim()).length ?? 0;
  switch (q.type) {
    case "mc":
      return opts < 2 ? "needs at least two options" : q.answer == null ? "needs a correct option" : null;
    case "multi":
      return opts < 3 ? "needs at least three options"
        : q.answers.length < 2 ? "needs at least two correct options"
        : q.answers.length >= opts ? "cannot have every option correct" : null;
    case "tfng":
    case "ynng":
      return q.choice ? null : "needs a correct answer";
    case "matching":
    case "headings":
      return pool < 2 ? "needs a list of options" : q.answer == null ? "needs a correct option" : null;
    case "gap":
      return q.accepted.some((a) => a.trim()) ? null : "needs an accepted answer";
    default:
      return null;
  }
}

export function QuestionEditor({
  q, n, groups, onChange, onRemove, onGroupChange,
}: {
  q: DraftQuestion;
  n: number;
  groups: DraftGroup[];
  onChange: (patch: Partial<DraftQuestion>) => void;
  onRemove: () => void;
  onGroupChange: (groupId: string, patch: Partial<DraftGroup>) => void;
}) {
  const t = useT();
  const group = groups.find((g) => g.id === q.group);
  const usesPool = q.type === "matching" || q.type === "headings";
  const choices = q.type === "tfng" ? TFNG : YNNG;
  const problem = questionProblem(q, groups);

  const setOption = (i: number, v: string) => onChange({ options: q.options.map((o, k) => (k === i ? v : o)) });
  const removeOption = (i: number) =>
    onChange({
      options: q.options.filter((_, k) => k !== i),
      answer: q.answer === i ? null : q.answer != null && q.answer > i ? q.answer - 1 : q.answer,
      answers: q.answers.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)),
    });

  return (
    <div className="space-y-3 rounded-[18px] border border-border/70 bg-[#FCF8F4] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-[#5F6B66]">{n}</span>
        <select
          value={q.type}
          onChange={(e) => {
            const type = e.target.value as QuestionType;
            onChange({ ...emptyQuestion(q.id, type), prompt: q.prompt, explanation: q.explanation, group: q.group });
          }}
          className="h-8 rounded-[8px] border border-border/80 bg-[#FCF8F4] px-2 text-[12px]"
        >
          {TYPE_ORDER.map((type) => <option key={type} value={type}>{t(TYPE_LABEL[type])}</option>)}
        </select>
        {usesPool && (
          <select
            value={q.group ?? ""}
            onChange={(e) => onChange({ group: e.target.value || undefined, answer: null })}
            className="h-8 rounded-[8px] border border-border/80 bg-[#FCF8F4] px-2 text-[12px]"
          >
            <option value="">{t("No list")}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.instructions.slice(0, 40) || g.id}</option>)}
          </select>
        )}
        {problem && <span className="text-[11.5px] text-[#9A5B1E]">{t(problem)}</span>}
        <button type="button" aria-label={t("Remove question")} onClick={onRemove}
          className="ml-auto rounded-[8px] p-1.5 text-muted-foreground hover:bg-[#F8E1DE] hover:text-[#B4483D]">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <textarea value={q.prompt} rows={2} maxLength={2000} onChange={(e) => onChange({ prompt: e.target.value })}
        placeholder={q.type === "gap" ? t("Sentence with ____ where the answer goes") : t("Question")} className={area} />

      {(q.type === "mc" || q.type === "multi") && (
        <div className="space-y-2">
          {q.options.map((o, i) => {
            const on = q.type === "mc" ? q.answer === i : q.answers.includes(i);
            return (
              <div key={i} className="flex items-center gap-2">
                <input
                  type={q.type === "mc" ? "radio" : "checkbox"}
                  name={`correct-${q.id}`}
                  aria-label={t("Correct option")}
                  checked={on}
                  onChange={() =>
                    q.type === "mc"
                      ? onChange({ answer: i })
                      : onChange({ answers: on ? q.answers.filter((x) => x !== i) : [...q.answers, i].sort((a, b) => a - b) })
                  }
                  className="accent-[#12392B]"
                />
                <span className="w-4 text-[12px] text-[#5F6B66]">{optionLabel(i)}</span>
                <input value={o} maxLength={500} onChange={(e) => setOption(i, e.target.value)}
                  className={cn(small, on && "border-[#3F6B4A] bg-[#E7EFE4]/50")} />
                {q.options.length > 2 && (
                  <button type="button" aria-label={t("Remove option")} onClick={() => removeOption(i)}
                    className="rounded-[8px] p-1 text-muted-foreground hover:text-[#B4483D]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {q.options.length < 8 && (
            <button type="button" onClick={() => onChange({ options: [...q.options, ""] })} className="text-[12px] font-medium text-[#12392B]">
              + {t("Add option")}
            </button>
          )}
          <p className="text-[11px] text-muted-foreground">
            {q.type === "mc" ? t("Select the circle next to the correct option.") : t("Tick every correct option (at least two).")}
          </p>
        </div>
      )}

      {(q.type === "tfng" || q.type === "ynng") && (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button key={c} type="button" onClick={() => onChange({ choice: c })}
              className={cn("h-9 rounded-full border px-3.5 text-[12.5px] font-medium",
                q.choice === c ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80 text-[#3B4A42] hover:bg-white")}>
              {CHOICE_LABEL[c]}
            </button>
          ))}
        </div>
      )}

      {q.type === "gap" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[12px] text-muted-foreground">{t("Word limit")}</label>
            <select value={q.max_words} onChange={(e) => onChange({ max_words: Number(e.target.value) })}
              className="h-8 rounded-[8px] border border-border/80 bg-[#FCF8F4] px-2 text-[12px]">
              {[1, 2, 3, 4, 5].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          {q.accepted.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={a} maxLength={120} onChange={(e) => onChange({ accepted: q.accepted.map((x, k) => (k === i ? e.target.value : x)) })}
                placeholder={t("Accepted answer")} className={small} />
              {q.accepted.length > 1 && (
                <button type="button" aria-label={t("Remove option")} onClick={() => onChange({ accepted: q.accepted.filter((_, k) => k !== i) })}
                  className="rounded-[8px] p-1 text-muted-foreground hover:text-[#B4483D]">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => onChange({ accepted: [...q.accepted, ""] })} className="text-[12px] font-medium text-[#12392B]">
            + {t("Add accepted answer")}
          </button>
          <p className="text-[11px] text-muted-foreground">{t("Add every wording you would accept. Capitals and spacing are ignored.")}</p>
        </div>
      )}

      {usesPool && group && (
        <div className="space-y-2 rounded-[12px] bg-[#F5ECE8]/70 p-3">
          <input value={group.instructions} maxLength={500} placeholder={t("Instructions for this list")}
            onChange={(e) => onGroupChange(group.id, { instructions: e.target.value })} className={small} />
          {group.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`pool-${q.id}`} aria-label={t("Correct option")} checked={q.answer === i}
                onChange={() => onChange({ answer: i })} className="accent-[#12392B]" />
              <span className="w-5 text-[12px] text-[#5F6B66]">{optionLabel(i, q.type)}</span>
              <input value={o} maxLength={300} className={cn(small, q.answer === i && "border-[#3F6B4A] bg-[#E7EFE4]/50")}
                onChange={(e) => onGroupChange(group.id, { options: group.options.map((x, k) => (k === i ? e.target.value : x)) })} />
              {group.options.length > 2 && (
                <button type="button" aria-label={t("Remove option")} onClick={() => onGroupChange(group.id, { options: group.options.filter((_, k) => k !== i) })}
                  className="rounded-[8px] p-1 text-muted-foreground hover:text-[#B4483D]">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {group.options.length < 14 && (
            <button type="button" onClick={() => onGroupChange(group.id, { options: [...group.options, ""] })} className="text-[12px] font-medium text-[#12392B]">
              <Plus className="inline h-3 w-3" /> {t("Add to the list")}
            </button>
          )}
          <p className="text-[11px] text-muted-foreground">{t("This list is shared by every question that uses it.")}</p>
        </div>
      )}

      <input value={q.explanation} maxLength={500} onChange={(e) => onChange({ explanation: e.target.value })}
        placeholder={t("Explanation (shown after submitting)")} className={cn(inputClass, "h-9 text-[12.5px]")} />
    </div>
  );
}
