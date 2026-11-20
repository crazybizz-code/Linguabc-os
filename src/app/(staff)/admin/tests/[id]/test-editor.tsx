"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Megaphone, Plus, Sparkles, Trash2, Undo2 } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { Badge, buttonPrimary, buttonSecondary, Card, inputClass, type Tone } from "@/components/ui/primitives";
import { AudioPanel } from "@/components/questions/audio-panel";
import { useT } from "@/i18n/client";
import { emptyQuestion, type DraftGroup, type DraftQuestion, type Level } from "@/lib/ai/draft";
import { MAX_SCRIPT_CHARS, type Voice } from "@/lib/ai/script";
import { frameListening, hasFrame } from "@/lib/ai/listening-frame";
import type { QuestionType } from "@/lib/questions";
import { QuestionEditor, questionProblem, TYPE_ORDER, typeLabel } from "../../../homework/new/question-editor";
import { deleteTest, draftSection, recordSection, saveTest, setTestStatus, type TestDraft } from "../actions";

const area = `${inputClass} h-auto py-2 leading-relaxed`;
const TONE: Record<string, Tone> = { draft: "amber", published: "green", hidden: "neutral" };
type Section = TestDraft["sections"][number];

export function TestEditor({ id, status, initial, voices, audioUrls }: {
  id: string; status: string; initial: TestDraft; voices: Voice[]; audioUrls: (string | undefined)[];
}) {
  const t = useT();
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const locked = status === "published";
  const listening = d.skill === "listening";

  const update = (fn: (x: TestDraft) => TestDraft) => { setD(fn); setDirty(true); };
  const setSection = (i: number, patch: Partial<Section>) =>
    update((x) => ({ ...x, sections: x.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  const total = d.sections.reduce((n, s) => n + s.questions.length, 0);
  const firsts = d.sections.map((_, i) => 1 + d.sections.slice(0, i).reduce((n, s) => n + s.questions.length, 0));
  const problems = d.sections.flatMap((s, i) => s.questions.map((q, k) => ({ n: firsts[i] + k, p: questionProblem(q, s.groups) })));
  const firstProblem = problems.find((x) => x.p);

  const run = (job: () => Promise<{ error?: string }>, after?: () => void) => start(async () => {
    setError(undefined);
    const r = await job();
    if (r.error) setError(t(r.error));
    else { after?.(); router.refresh(); }
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={TONE[status]}>{t(status === "published" ? "Published" : status === "hidden" ? "Hidden" : "Draft")}</Badge>
            <span className="text-[12.5px] text-muted-foreground">{t(listening ? "Listening" : "Reading")} · {t("{n} of 40 questions", { n: String(total) })}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {status === "published" ? (
              <>
                <button type="button" disabled={pending} className={buttonSecondary} onClick={() => run(() => setTestStatus(id, "draft"))}><Undo2 className="h-4 w-4" /> {t("Unpublish to edit")}</button>
                <button type="button" disabled={pending} className={buttonSecondary} onClick={() => run(() => setTestStatus(id, "hidden"))}><EyeOff className="h-4 w-4" /> {t("Hide")}</button>
              </>
            ) : (
              <button type="button" disabled={pending || dirty} title={dirty ? t("Save first") : undefined} className={buttonSecondary}
                onClick={() => run(() => setTestStatus(id, "published"))}><Eye className="h-4 w-4" /> {t("Publish")}</button>
            )}
            {status === "draft" && (
              <button type="button" disabled={pending} className={buttonSecondary}
                onClick={() => { if (confirm(t("Delete this draft and its recordings?"))) run(() => deleteTest(id), () => router.push("/admin/tests")); }}>
                <Trash2 className="h-4 w-4" /> {t("Delete")}
              </button>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <FieldLabel label={t("Title")}><input value={d.title} disabled={locked} maxLength={200} onChange={(e) => update((x) => ({ ...x, title: e.target.value }))} className={inputClass} /></FieldLabel>
          <FieldLabel label={t("Level")}>
            <select value={d.level} disabled={locked} onChange={(e) => update((x) => ({ ...x, level: e.target.value as Level }))} className={inputClass}>
              {["B1", "B2", "C1"].map((l) => <option key={l}>{l}</option>)}
            </select>
          </FieldLabel>
        </div>
        {locked && <p className="rounded-[10px] bg-[#F5ECE8] px-3.5 py-3 text-[12.5px] text-muted-foreground">{t("Published tests can't be changed. Unpublish to edit.")}</p>}
      </Card>

      {d.sections.map((s, i) => (
        <SectionCard key={i} index={i} section={s} first={firsts[i]} testId={id} skill={d.skill} level={d.level}
          voices={voices} audioUrl={audioUrls[i]} locked={locked} busy={pending}
          onChange={(patch) => setSection(i, patch)} />
      ))}

      {!locked && (
        <div className="sticky bottom-3 z-[5] flex flex-wrap items-center justify-end gap-3 rounded-[16px] border border-border/70 bg-[#FCF8F4]/95 p-3 backdrop-blur">
          {error && <span className="mr-auto text-[12.5px] text-[#B4483D]">{error}</span>}
          {!error && firstProblem && <span className="mr-auto text-[12.5px] text-[#9A5B1E]">{t("Question {n}")} {t(firstProblem.p!)}</span>}
          {!error && !firstProblem && dirty && <span className="mr-auto text-[12.5px] text-muted-foreground">{t("Unsaved changes")}</span>}
          <button type="button" disabled={pending || !!firstProblem || total === 0} className={buttonPrimary}
            onClick={() => run(() => saveTest(id, d), () => setDirty(false))}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save draft")}
          </button>
        </div>
      )}
      {locked && error && <p className="text-[12.5px] text-[#B4483D]">{error}</p>}
    </div>
  );
}

function SectionCard({ index, section: s, first, testId, skill, level, voices, audioUrl, locked, busy, onChange }: {
  index: number; section: Section; first: number; testId: string; skill: TestDraft["skill"]; level: Level;
  voices: Voice[]; audioUrl?: string; locked: boolean; busy: boolean; onChange: (patch: Partial<Section>) => void;
}) {
  const t = useT();
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string>();
  const [drafting, start] = useTransition();
  const listening = skill === "listening";
  const last = first + s.questions.length - 1;

  const setQ = (k: number, patch: Partial<DraftQuestion>) => onChange({ questions: s.questions.map((q, j) => (j === k ? { ...q, ...patch } : q)) });
  const setGroup = (gid: string, patch: Partial<DraftGroup>) => onChange({ groups: s.groups.map((g) => (g.id === gid ? { ...g, ...patch } : g)) });
  const addQuestion = (type: QuestionType) => {
    const q = emptyQuestion(`q${s.questions.length + 1}`, type);
    if (type !== "matching" && type !== "headings") return onChange({ questions: [...s.questions, q] });
    const lastGroup = s.groups[s.groups.length - 1];
    const group: DraftGroup = lastGroup ?? { id: `g${s.groups.length + 1}`, instructions: "", options: ["", "", ""] };
    onChange({ groups: lastGroup ? s.groups : [...s.groups, group], questions: [...s.questions, { ...q, group: group.id }] });
  };

  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold">
          {s.title || `${t(listening ? "Part" : "Passage")} ${index + 1}`}
          <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">
            {s.questions.length ? t("Questions {a}–{b}", { a: String(first), b: String(last) }) : t("No questions yet")}
          </span>
        </h2>
      </div>
      {!locked && (
        <div className="flex flex-wrap items-end gap-3 rounded-[12px] bg-[#F5ECE8]/70 p-3">
          <FieldLabel label={t("Topic")} hint={t("Optional")} className="min-w-[220px] flex-1">
            <input value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} placeholder={t("e.g. Booking a sports centre")} className={inputClass} />
          </FieldLabel>
          <button type="button" disabled={drafting || busy} className={buttonPrimary}
            onClick={() => {
              if ((s.passage.trim() || s.questions.length) && !confirm(t("Replace this section with a new AI draft?"))) return;
              start(async () => {
                setError(undefined);
                const r = await draftSection(skill, index, level, topic);
                if (r.error || !r.section) setError(t(r.error ?? "Something went wrong. Try again."));
                else onChange({ ...r.section, audio_path: undefined });
              });
            }}>
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {t("Write with AI")}
          </button>
          {drafting && <p className="w-full text-[12px] text-muted-foreground">{t("Writing the section — this can take up to a minute.")}</p>}
          {error && <p className="w-full text-[12.5px] text-[#B4483D]">{error}</p>}
        </div>
      )}
      <FieldLabel label={t("Section title")}><input value={s.title} disabled={locked} maxLength={120} onChange={(e) => onChange({ title: e.target.value })} className={inputClass} /></FieldLabel>
      <FieldLabel label={t(listening ? "Listening script" : "Passage")}
        hint={listening ? t("Write one line per turn as \"Name: words\". A line [pause 30] is 30 seconds of silence. Students hear the recording and see this script only after they submit.") : undefined}>
        <textarea value={s.passage} disabled={locked} rows={listening ? 10 : 14} maxLength={listening ? MAX_SCRIPT_CHARS : 20000}
          onChange={(e) => onChange({ passage: e.target.value })} className={area} />
      </FieldLabel>
      {listening && !locked && s.passage.trim() && !hasFrame(s.passage) && (
        <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[#E7D3B5] bg-[#FBF3E6] px-3.5 py-3">
          <p className="min-w-[220px] flex-1 text-[12.5px] leading-relaxed text-[#8A5A26]">
            {t("This script has no exam instructions. Add them so the recording opens like the real test, with time to read the questions. To add the break in the middle of the part, first put a line [break] where the second set of questions starts.")}
          </p>
          <button type="button" className={buttonSecondary}
            onClick={() => onChange({ passage: frameListening(s.passage, index, first, last) })}>
            <Megaphone className="h-4 w-4" /> {t("Add exam instructions")}
          </button>
        </div>
      )}
      {listening && (locked ? (audioUrl && <audio controls preload="none" src={audioUrl} className="w-full" />) : (
        <AudioPanel script={s.passage} audioPath={s.audio_path} initialUrl={audioUrl} voices={voices}
          record={(script, previous, cast) => recordSection(testId, script, previous, cast)}
          onChange={(audio_path) => onChange({ audio_path })} />
      ))}

      {s.questions.map((q, k) => (
        locked ? (
          <div key={k} className="rounded-[12px] border border-border/60 px-4 py-3 text-[13px]"><span className="font-medium">{first + k}.</span> {q.prompt}</div>
        ) : (
          <QuestionEditor key={k} q={q} n={first + k} groups={s.groups}
            onChange={(patch) => setQ(k, patch)}
            onRemove={() => onChange({ questions: s.questions.filter((_, j) => j !== k) })}
            onGroupChange={setGroup} />
        )
      ))}
      {!locked && (
        <details className="rounded-[14px] border border-dashed border-border bg-white/40">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-[#3B4A42]"><Plus className="mr-1 inline h-4 w-4" /> {t("Add question")}</summary>
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {TYPE_ORDER.map((type) => (
              <button key={type} type="button" onClick={() => addQuestion(type)}
                className="h-9 rounded-[9px] border border-border/80 bg-[#FCF8F4] px-3 text-[12.5px] font-medium hover:bg-white">{t(typeLabel(type))}</button>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
