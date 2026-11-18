"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { buttonPrimary, cn } from "@/components/ui/primitives";
import { saveHomework } from "../../../actions";
import type { Question } from "@/lib/library/render";

export function Quiz({ homeworkId, questions, initial }: { homeworkId: string; questions: Question[]; initial: Record<string, number> }) {
  const [answers, setAnswers] = useState(initial);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const answered = questions.filter((q) => answers[q.id] != null).length;
  const save = (submit: boolean) => start(async () => {
    setMsg({});
    const r = await saveHomework(homeworkId, answers, submit);
    if (r.error) setMsg({ error: r.error });
    else { setMsg({ ok: submit ? "Submitted" : "Progress saved" }); setConfirm(false); router.refresh(); }
  });

  return (
    <div className="space-y-4">
      {questions.map((q, n) => (
        <fieldset key={q.id} className="rounded-[16px] border border-border/70 bg-[#FCF8F4] p-4">
          <legend className="sr-only">Question {n + 1}</legend>
          <p className="text-[14px] font-medium leading-snug">{n + 1}. {q.prompt}</p>
          <div className="mt-3 space-y-2">
            {(q.options ?? []).map((o, i) => {
              const on = answers[q.id] === i;
              return (
                <label key={i} className={cn("flex cursor-pointer gap-3 rounded-[11px] border px-3 py-2.5 text-[13.5px] transition-colors",
                  on ? "border-[#12392B] bg-[#12392B]/[0.06]" : "border-border/80 bg-white/50 hover:bg-white")}>
                  <input type="radio" name={q.id} className="mt-0.5 accent-[#12392B]" checked={on}
                    onChange={() => { setMsg({}); setConfirm(false); setAnswers((a) => ({ ...a, [q.id]: i })); }} />
                  <span>{o}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="sticky bottom-20 z-[5] rounded-[16px] border border-border/70 bg-[#FCF8F4]/95 p-3 shadow-[0_4px_16px_rgba(23,33,29,0.06)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-muted-foreground">{answered} of {questions.length} answered</span>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => save(false)} className="h-10 rounded-[11px] border border-border/80 px-3.5 text-[13px] font-medium">Save</button>
            {confirm ? (
              <button type="button" disabled={pending} onClick={() => save(true)} className={buttonPrimary}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Confirm submit
              </button>
            ) : (
              <button type="button" disabled={pending || answered === 0} onClick={() => setConfirm(true)} className={buttonPrimary}>Submit</button>
            )}
          </div>
        </div>
        {confirm && answered < questions.length && <p className="mt-2 text-[12px] text-[#9A5B1E]">{questions.length - answered} question(s) unanswered. You can&apos;t change answers after submitting.</p>}
        {confirm && answered === questions.length && <p className="mt-2 text-[12px] text-muted-foreground">You can&apos;t change answers after submitting.</p>}
        {msg.error && <p className="mt-2 text-[12px] text-[#B4483D]">{msg.error}</p>}
        {msg.ok && <p className="mt-2 flex items-center gap-1 text-[12px] text-[#3F6B4A]"><Check className="h-3.5 w-3.5" />{msg.ok}</p>}
      </div>
    </div>
  );
}
