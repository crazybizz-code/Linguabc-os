"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, Card, cn, inputClass } from "@/components/ui/primitives";
import { FormError } from "@/components/workspace/form-dialog";
import { useT } from "@/i18n/client";
import { draftFromUpload, draftWithAI, saveDraft } from "./actions";
import type { Draft, DraftQuestion } from "@/lib/ai/assignment-draft";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SKILLS = ["reading", "listening", "writing", "speaking", "vocabulary", "grammar"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const area = `${inputClass} h-auto py-2 leading-relaxed`;

function SkillLevel({ skill = "reading", level = "B1" }: { skill?: string; level?: string }) {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FieldLabel label={t("Skill")}>
        <select name="skill" defaultValue={skill} className={inputClass}>{SKILLS.map((s) => <option key={s} value={s}>{t(cap(s))}</option>)}</select>
      </FieldLabel>
      <FieldLabel label={t("Level")}>
        <select name="level" defaultValue={level} className={inputClass}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
      </FieldLabel>
    </div>
  );
}

function Working({ label }: { label: string }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-[#12392B]" />
      <p className="text-[14px] font-medium">{label}</p>
    </Card>
  );
}

export function UploadFlow() {
  const t = useT();
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (draft) return <DraftEditor initial={draft} source="upload" onRestart={() => setDraft(undefined)} />;
  if (pending) return <Working label={t("Reading your worksheet and preparing questions — this can take up to a minute.")} />;
  return (
    <Card className="max-w-2xl p-6">
      <form action={(f) => start(async () => { setError(undefined); const r = await draftFromUpload(f); if (r.error) setError(t(r.error)); else setDraft(r.draft); })} className="space-y-4">
        <FormError message={error} />
        <FieldLabel label={t("Worksheet")} hint={t("PDF, Word (.docx), text or a photo (PNG/JPG), up to 4 MB.")}>
          <input name="file" type="file" required accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
            className="block w-full rounded-[10px] border border-dashed border-border bg-white/50 p-4 text-[13px] file:mr-3 file:rounded-[8px] file:border-0 file:bg-[#12392B] file:px-3 file:py-1.5 file:text-[12.5px] file:text-white" />
        </FieldLabel>
        <SkillLevel />
        <p className="rounded-[10px] bg-[#F5ECE8] px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
          {t("The text and exercises are pulled out of your file and turned into questions. You check and edit everything before it is saved.")}
        </p>
        <div className="flex justify-end"><button className={buttonPrimary}><Upload className="h-4 w-4" /> {t("Extract questions")}</button></div>
      </form>
    </Card>
  );
}

export function AiFlow() {
  const t = useT();
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (draft) return <DraftEditor initial={draft} source="ai" onRestart={() => setDraft(undefined)} />;
  if (pending) return <Working label={t("Writing your assignment — this usually takes 10–30 seconds.")} />;
  return (
    <Card className="max-w-2xl p-6">
      <form action={(f) => start(async () => { setError(undefined); const r = await draftWithAI(f); if (r.error) setError(t(r.error)); else setDraft(r.draft); })} className="space-y-4">
        <FormError message={error} />
        <SkillLevel />
        <FieldLabel label={t("Sub-skill or focus")} hint={t("e.g. Matching headings, past perfect, Task 2 opinion essay")}>
          <input name="focus" maxLength={300} className={inputClass} />
        </FieldLabel>
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <FieldLabel label={t("Topic")} hint={t("Optional")}><input name="topic" maxLength={200} placeholder={t("e.g. City transport")} className={inputClass} /></FieldLabel>
          <FieldLabel label={t("Questions")}><input name="count" type="number" min={1} max={15} defaultValue={6} className={inputClass} /></FieldLabel>
        </div>
        <div className="flex justify-end"><button className={buttonPrimary}><Sparkles className="h-4 w-4" /> {t("Generate draft")}</button></div>
      </form>
    </Card>
  );
}

function DraftEditor({ initial, source, onRestart }: { initial: Draft; source: "upload" | "ai"; onRestart: () => void }) {
  const t = useT();
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const setQ = (i: number, patch: Partial<DraftQuestion>) => setD((x) => ({ ...x, questions: x.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const missing = d.questions.findIndex((q) => q.type === "mc" && (q.answer == null || q.options.filter((o) => o.trim()).length < 2));

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">{t("Check the draft")}</h2>
          <button type="button" onClick={onRestart} className="text-[12.5px] text-muted-foreground underline">{t("Start again")}</button>
        </div>
        <FieldLabel label={t("Title")}><input value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} className={inputClass} /></FieldLabel>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label={t("Skill")}>
            <select value={d.skill} onChange={(e) => setD({ ...d, skill: e.target.value as Draft["skill"] })} className={inputClass}>{SKILLS.map((s) => <option key={s} value={s}>{t(cap(s))}</option>)}</select>
          </FieldLabel>
          <FieldLabel label={t("Level")}>
            <select value={d.level} onChange={(e) => setD({ ...d, level: e.target.value as Draft["level"] })} className={inputClass}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
          </FieldLabel>
        </div>
        <FieldLabel label={t("Text for students")} hint={t("Optional — the passage, dialogue or instructions students read first.")}>
          <textarea value={d.passage} rows={8} maxLength={30000} onChange={(e) => setD({ ...d, passage: e.target.value })} className={area} />
        </FieldLabel>
      </Card>

      {d.questions.map((q, i) => (
        <Card key={i} className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[#5F6B66]">{i + 1}</span>
            <select value={q.type} onChange={(e) => setQ(i, { type: e.target.value as DraftQuestion["type"], options: e.target.value === "mc" && q.options.length < 2 ? ["", "", "", ""] : q.options, answer: null })}
              className="h-8 rounded-[8px] border border-border/80 bg-[#FCF8F4] px-2 text-[12px]">
              <option value="mc">{t("Multiple choice")}</option>
              <option value="open">{t("Open answer")}</option>
            </select>
            <button type="button" aria-label={t("Remove question")} onClick={() => setD({ ...d, questions: d.questions.filter((_, j) => j !== i) })}
              className="ml-auto rounded-[8px] p-1.5 text-muted-foreground hover:bg-[#F8E1DE] hover:text-[#B4483D]"><Trash2 className="h-4 w-4" /></button>
          </div>
          <textarea value={q.prompt} rows={2} maxLength={2000} onChange={(e) => setQ(i, { prompt: e.target.value })} placeholder={t("Question")} className={area} />
          {q.type === "mc" && (
            <div className="space-y-2">
              {q.options.map((o, k) => (
                <div key={k} className="flex items-center gap-2">
                  <input type="radio" name={`correct-${i}`} aria-label={t("Correct option")} checked={q.answer === k} onChange={() => setQ(i, { answer: k })} className="accent-[#12392B]" />
                  <input value={o} maxLength={500} onChange={(e) => setQ(i, { options: q.options.map((x, m) => (m === k ? e.target.value : x)) })}
                    className={cn(inputClass, "h-9", q.answer === k && "border-[#3F6B4A] bg-[#E7EFE4]/50")} />
                  {q.options.length > 2 && (
                    <button type="button" aria-label={t("Remove option")} onClick={() => setQ(i, { options: q.options.filter((_, m) => m !== k), answer: q.answer === k ? null : q.answer != null && q.answer > k ? q.answer - 1 : q.answer })}
                      className="rounded-[8px] p-1 text-muted-foreground hover:text-[#B4483D]"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
              {q.options.length < 6 && <button type="button" onClick={() => setQ(i, { options: [...q.options, ""] })} className="text-[12px] font-medium text-[#12392B]">+ {t("Add option")}</button>}
              <p className="text-[11px] text-muted-foreground">{t("Select the circle next to the correct option.")}</p>
            </div>
          )}
          <input value={q.explanation} maxLength={1000} onChange={(e) => setQ(i, { explanation: e.target.value })} placeholder={t("Explanation (shown after submitting)")} className={cn(inputClass, "h-9 text-[12.5px]")} />
        </Card>
      ))}

      <button type="button" onClick={() => setD({ ...d, questions: [...d.questions, { id: "", type: "mc", prompt: "", options: ["", "", "", ""], answer: null, explanation: "" }] })}
        className="flex w-full items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-border py-3 text-[13px] font-medium text-[#3B4A42] hover:bg-white/60">
        <Plus className="h-4 w-4" /> {t("Add question")}
      </button>

      <div className="sticky bottom-3 z-[5] flex flex-wrap items-center justify-end gap-3 rounded-[16px] border border-border/70 bg-[#FCF8F4]/95 p-3 backdrop-blur">
        {error && <span className="mr-auto text-[12.5px] text-[#B4483D]">{error}</span>}
        {!error && missing >= 0 && <span className="mr-auto text-[12.5px] text-[#9A5B1E]">{t("Question {n} needs at least two options and a correct answer.", { n: missing + 1 })}</span>}
        <button type="button" disabled={pending || missing >= 0 || d.questions.length === 0} className={buttonPrimary}
          onClick={() => start(async () => {
            setError(undefined);
            const r = await saveDraft(d, source);
            if (r.error) setError(t(r.error)); else router.push(`/homework/assignments/${r.id}`);
          })}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save assignment")}
        </button>
      </div>
    </div>
  );
}
