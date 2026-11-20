"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, Loader2, Plus, Sparkles, Upload } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, Card, inputClass } from "@/components/ui/primitives";
import { FormError } from "@/components/workspace/form-dialog";
import { useT } from "@/i18n/client";
import { draftFromUpload, draftWithAI, generateAudio, saveDraft } from "./actions";
import { emptyQuestion, type Draft, type DraftGroup, type DraftQuestion } from "@/lib/ai/draft";
import { QuestionEditor, questionProblem, TYPE_ORDER, typeLabel } from "./question-editor";
import type { QuestionType } from "@/lib/questions";

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

/** Generates the recording for a listening script and previews it. */
function AudioPanel({ draft, onChange }: { draft: Draft; onChange: (path: string | undefined) => void }) {
  const t = useT();
  const [url, setUrl] = useState<string>();
  const [madeFrom, setMadeFrom] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const stale = draft.audio_path && madeFrom !== undefined && madeFrom !== draft.passage;

  return (
    <div className="space-y-3 rounded-[12px] border border-border/70 bg-[#FCF8F4] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-medium">{t("Recording")}</p>
          <p className="text-[12px] text-muted-foreground">
            {pending ? t("Recording the script — this can take up to a minute.") : draft.audio_path ? t("Listen before you save.") : t("No recording yet. Without one, students read the script instead.")}
          </p>
        </div>
        <button type="button" disabled={pending || draft.passage.trim().length < 20} className={buttonPrimary}
          onClick={() => start(async () => {
            setError(undefined);
            const r = await generateAudio(draft.passage, draft.audio_path);
            if (r.error || !r.path) { setError(t(r.error ?? "Something went wrong. Try again.")); return; }
            setUrl(r.url); setMadeFrom(draft.passage); onChange(r.path);
          })}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
          {draft.audio_path ? t("Record again") : t("Generate audio")}
        </button>
      </div>
      {url && <audio controls src={url} className="w-full" />}
      {stale && <p className="text-[12.5px] text-[#9A5B1E]">{t("The script changed after recording. Record again so they match.")}</p>}
      {error && <p className="text-[12.5px] text-[#B4483D]">{error}</p>}
    </div>
  );
}

function DraftEditor({ initial, source, onRestart }: { initial: Draft; source: "upload" | "ai"; onRestart: () => void }) {
  const t = useT();
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const setQ = (i: number, patch: Partial<DraftQuestion>) =>
    setD((x) => ({ ...x, questions: x.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const setGroup = (id: string, patch: Partial<DraftGroup>) =>
    setD((x) => ({ ...x, groups: x.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));

  const addQuestion = (type: QuestionType) =>
    setD((x) => {
      const q = emptyQuestion(`q${x.questions.length + 1}`, type);
      if (type !== "matching" && type !== "headings") return { ...x, questions: [...x.questions, q] };
      // Matching questions need a list; reuse the last one or start a new one.
      const last = x.groups[x.groups.length - 1];
      const group: DraftGroup = last ?? { id: `g${x.groups.length + 1}`, instructions: "", options: ["", "", ""] };
      return { ...x, groups: last ? x.groups : [...x.groups, group], questions: [...x.questions, { ...q, group: group.id }] };
    });

  const problems = d.questions.map((q) => questionProblem(q, d.groups));
  const firstProblem = problems.findIndex(Boolean);

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">{t("Check the draft")}</h2>
          <button type="button" onClick={onRestart} className="text-[12.5px] text-muted-foreground underline">{t("Start again")}</button>
        </div>
        <FieldLabel label={t("Title")}>
          <input value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} className={inputClass} />
        </FieldLabel>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label={t("Skill")}>
            <select value={d.skill} onChange={(e) => setD({ ...d, skill: e.target.value as Draft["skill"] })} className={inputClass}>
              {SKILLS.map((x) => <option key={x} value={x}>{t(cap(x))}</option>)}
            </select>
          </FieldLabel>
          <FieldLabel label={t("Level")}>
            <select value={d.level} onChange={(e) => setD({ ...d, level: e.target.value as Draft["level"] })} className={inputClass}>
              {LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </FieldLabel>
        </div>
        {d.skill === "listening" ? (
          <FieldLabel label={t("Listening script")} hint={t("Write one line per turn as \"Name: words\". Students hear the recording and see this script only after they submit.")}>
            <textarea value={d.passage} rows={10} maxLength={8000} onChange={(e) => setD({ ...d, passage: e.target.value })} className={area} />
          </FieldLabel>
        ) : (
          <FieldLabel label={t("Text for students")} hint={t("Optional — the passage, dialogue or instructions students read first.")}>
            <textarea value={d.passage} rows={8} maxLength={30000} onChange={(e) => setD({ ...d, passage: e.target.value })} className={area} />
          </FieldLabel>
        )}
        {d.skill === "listening" && <AudioPanel draft={d} onChange={(audio_path) => setD((x) => ({ ...x, audio_path }))} />}
      </Card>

      {d.questions.map((q, i) => (
        <QuestionEditor key={i} q={q} n={i + 1} groups={d.groups}
          onChange={(patch) => setQ(i, patch)}
          onRemove={() => setD({ ...d, questions: d.questions.filter((_, j) => j !== i) })}
          onGroupChange={setGroup} />
      ))}

      <details className="rounded-[14px] border border-dashed border-border bg-white/40">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-[#3B4A42]">
          <Plus className="mr-1 inline h-4 w-4" /> {t("Add question")}
        </summary>
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {TYPE_ORDER.map((type) => (
            <button key={type} type="button" onClick={() => addQuestion(type)}
              className="h-9 rounded-[9px] border border-border/80 bg-[#FCF8F4] px-3 text-[12.5px] font-medium hover:bg-white">
              {t(typeLabel(type))}
            </button>
          ))}
        </div>
      </details>

      <div className="sticky bottom-3 z-[5] flex flex-wrap items-center justify-end gap-3 rounded-[16px] border border-border/70 bg-[#FCF8F4]/95 p-3 backdrop-blur">
        {error && <span className="mr-auto text-[12.5px] text-[#B4483D]">{error}</span>}
        {!error && firstProblem >= 0 && (
          <span className="mr-auto text-[12.5px] text-[#9A5B1E]">
            {t("Question {n}")} {t(problems[firstProblem]!)}
          </span>
        )}
        <button type="button" disabled={pending || firstProblem >= 0 || d.questions.length === 0} className={buttonPrimary}
          onClick={() => start(async () => {
            setError(undefined);
            const r = await saveDraft(d, source);
            if (r.error) setError(t(r.error));
            else router.push(`/homework/assignments/${r.id}`);
          })}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save assignment")}
        </button>
      </div>
    </div>
  );
}
