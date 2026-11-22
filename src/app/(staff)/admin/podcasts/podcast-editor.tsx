"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Plus, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { Badge, buttonPrimary, buttonSecondary, Card, inputClass, type Tone } from "@/components/ui/primitives";
import { AudioPanel } from "@/components/questions/audio-panel";
import { useT } from "@/i18n/client";
import { emptyQuestion, LEVELS, type DraftQuestion, type Level } from "@/lib/ai/draft";
import { FORMATS, PODCAST_TYPES, type PodcastDraft, type VocabWord } from "@/lib/ai/podcast";
import { MAX_SCRIPT_CHARS, type Voice } from "@/lib/ai/script";
import type { QuestionType } from "@/lib/questions";
import { QuestionEditor, questionProblem, typeLabel } from "../../homework/new/question-editor";
import { deletePodcast, draftPodcast, recordPodcast, savePodcast, setPodcastStatus, type PodcastSave } from "./actions";
import {
  attachStudioJob, dismissStudioJob, recoverStudioJob, retryStudioJob, reviewStudioJob, startStudioJob, studioJobResult,
} from "../audio-jobs/actions";
import type { StudioEngineOption, StudioJobs } from "@/components/questions/audio-panel";

/** Job actions for one podcast's recording (a new podcast's slot is "new" until it is saved). */
const podcastJobs = (podcastId: string | null): StudioJobs => ({
  start: (engine, script, cast) => startStudioJob(engine, script, cast, { kind: "podcast", podcastId }),
  retry: (jobId, script, cast) => retryStudioJob(jobId, script, cast),
  recover: (script, audioPath) => recoverStudioJob({ kind: "podcast", podcastId }, script, audioPath),
  result: studioJobResult, review: reviewStudioJob, attach: attachStudioJob, dismiss: dismissStudioJob,
});

const area = `${inputClass} h-auto py-2 leading-relaxed`;
const TONE: Record<string, Tone> = { draft: "amber", published: "green", hidden: "neutral" };
const FORMAT_LABEL: Record<string, string> = {
  "a host interviewing a guest": "Interview",
  "two friends chatting": "Two friends",
  "one host presenting a short show": "One host",
  "a host with two guests discussing": "Panel of three",
  "a short story told by a narrator": "Story",
};

export function PodcastEditor({ id, status, initial, voices, audioUrl, engines }: {
  id: string | null; status: string; initial: PodcastSave; voices: Voice[]; audioUrl?: string; engines?: StudioEngineOption[];
}) {
  const t = useT();
  const router = useRouter();
  const [d, setD] = useState<PodcastSave>(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState("");
  const [pending, start] = useTransition();
  const [drafting, startDraft] = useTransition();
  const locked = status === "published";

  const update = (patch: Partial<PodcastSave>) => { setD((x) => ({ ...x, ...patch })); setDirty(true); };
  const setQ = (k: number, patch: Partial<DraftQuestion>) => update({ questions: d.questions.map((q, j) => (j === k ? { ...q, ...patch } : q)) });
  const setV = (k: number, patch: Partial<VocabWord>) => update({ vocabulary: d.vocabulary.map((v, j) => (j === k ? { ...v, ...patch } : v)) });
  const problems = d.questions.map((q, k) => ({ n: k + 1, p: questionProblem(q, []) }));
  const firstProblem = problems.find((x) => x.p);

  const run = (job: () => Promise<{ error?: string; id?: string }>, after?: (r: { id?: string }) => void) => start(async () => {
    setError(undefined);
    const r = await job();
    if (r.error) setError(t(r.error));
    else { after?.(r); router.refresh(); }
  });

  const aiDraft = () => {
    if ((d.script.trim() || d.questions.length) && !confirm(t("Replace this podcast with a new AI draft?"))) return;
    startDraft(async () => {
      setError(undefined);
      const r = await draftPodcast(d.levelMin, topic, format);
      if (r.error || !r.draft) setError(t(r.error ?? "Something went wrong. Try again."));
      else update({ ...(r.draft as PodcastDraft), audioPath: undefined, seconds: undefined });
    });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={TONE[status]}>{t(status === "published" ? "Published" : status === "hidden" ? "Hidden" : "Draft")}</Badge>
            <span className="text-[12.5px] text-muted-foreground">
              {d.levelMin === d.levelMax ? d.levelMin : `${d.levelMin}–${d.levelMax}`} · {t("{n} questions", { n: String(d.questions.length) })}
              {d.seconds ? ` · ${Math.floor(d.seconds / 60)}:${String(d.seconds % 60).padStart(2, "0")}` : ""}
            </span>
          </div>
          {id && (
            <div className="flex flex-wrap gap-2">
              {status === "published" ? (
                <>
                  <button type="button" disabled={pending} className={buttonSecondary} onClick={() => run(() => setPodcastStatus(id, "draft"))}><Undo2 className="h-4 w-4" /> {t("Unpublish to edit")}</button>
                  <button type="button" disabled={pending} className={buttonSecondary} onClick={() => run(() => setPodcastStatus(id, "hidden"))}><EyeOff className="h-4 w-4" /> {t("Hide")}</button>
                </>
              ) : (
                <button type="button" disabled={pending || dirty} title={dirty ? t("Save first") : undefined} className={buttonSecondary}
                  onClick={() => run(() => setPodcastStatus(id, "published"))}><Eye className="h-4 w-4" /> {t("Publish")}</button>
              )}
              {status === "draft" && (
                <button type="button" disabled={pending} className={buttonSecondary}
                  onClick={() => { if (confirm(t("Delete this draft and its recording?"))) run(() => deletePodcast(id, d.audioPath), () => router.push("/admin/podcasts")); }}>
                  <Trash2 className="h-4 w-4" /> {t("Delete")}
                </button>
              )}
            </div>
          )}
        </div>

        {!locked && (
          <div className="flex flex-wrap items-end gap-3 rounded-[12px] bg-[#F5ECE8]/70 p-3">
            <FieldLabel label={t("Topic")} hint={t("Optional")} className="min-w-[200px] flex-1">
              <input value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} placeholder={t("e.g. A day at a market in Samarkand")} className={inputClass} />
            </FieldLabel>
            <FieldLabel label={t("Format")} className="w-[170px]">
              <select value={format} onChange={(e) => setFormat(e.target.value)} className={inputClass}>
                <option value="">{t("Any")}</option>
                {FORMATS.map((f) => <option key={f} value={f}>{t(FORMAT_LABEL[f])}</option>)}
              </select>
            </FieldLabel>
            <button type="button" disabled={drafting || pending} className={buttonPrimary} onClick={aiDraft}>
              {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {t("Write with AI")}
            </button>
            {drafting && <p className="w-full text-[12px] text-muted-foreground">{t("Writing the episode — this can take up to a minute.")}</p>}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_110px_110px]">
          <FieldLabel label={t("Title")}><input value={d.title} disabled={locked} maxLength={200} onChange={(e) => update({ title: e.target.value })} className={inputClass} /></FieldLabel>
          <FieldLabel label={t("From level")}>
            <select value={d.levelMin} disabled={locked} onChange={(e) => { const v = e.target.value as Level; update({ levelMin: v, levelMax: d.levelMax < v ? v : d.levelMax }); }} className={inputClass}>
              {LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </FieldLabel>
          <FieldLabel label={t("To level")}>
            <select value={d.levelMax} disabled={locked} onChange={(e) => update({ levelMax: e.target.value as Level })} className={inputClass}>
              {LEVELS.filter((l) => l >= d.levelMin).map((l) => <option key={l}>{l}</option>)}
            </select>
          </FieldLabel>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_260px]">
          <FieldLabel label={t("Description")}><input value={d.description} disabled={locked} maxLength={300} onChange={(e) => update({ description: e.target.value })} className={inputClass} /></FieldLabel>
          <FieldLabel label={t("Topics")} hint={t("Comma separated")}>
            <input value={d.topics.join(", ")} disabled={locked} onChange={(e) => update({ topics: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className={inputClass} />
          </FieldLabel>
        </div>
        <FieldLabel label={t("Script")} hint={t("Write one line per turn as \"Name: words\". Students hear the recording and can open this as the transcript.")}>
          <textarea value={d.script} disabled={locked} rows={14} maxLength={MAX_SCRIPT_CHARS} onChange={(e) => update({ script: e.target.value })} className={area} />
        </FieldLabel>
        {locked ? (audioUrl && <audio controls preload="none" src={audioUrl} className="w-full" />) : (
          <AudioPanel script={d.script} audioPath={d.audioPath} initialUrl={audioUrl} voices={voices}
            record={async (script, previous, cast) => {
              const r = await recordPodcast(script, previous, cast);
              if (r.seconds) update({ seconds: r.seconds });
              return r;
            }}
            onChange={(audioPath) => update({ audioPath })}
            engines={engines} jobs={podcastJobs(id)} onSeconds={(seconds) => update({ seconds: Math.round(seconds) })} />
        )}
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-[16px] font-semibold">{t("Questions")}</h2>
        {d.questions.map((q, k) => locked ? (
          <div key={k} className="rounded-[12px] border border-border/60 px-4 py-3 text-[13px]"><span className="font-medium">{k + 1}.</span> {q.prompt}</div>
        ) : (
          <QuestionEditor key={k} q={q} n={k + 1} groups={[]} onChange={(patch) => setQ(k, patch)}
            onRemove={() => update({ questions: d.questions.filter((_, j) => j !== k) })} onGroupChange={() => {}} />
        ))}
        {!locked && (
          <div className="flex flex-wrap gap-2">
            {PODCAST_TYPES.map((type) => (
              <button key={type} type="button" onClick={() => update({ questions: [...d.questions, emptyQuestion(`q${d.questions.length + 1}`, type as QuestionType)] })}
                className="h-9 rounded-[9px] border border-border/80 bg-[#FCF8F4] px-3 text-[12.5px] font-medium hover:bg-white"><Plus className="mr-1 inline h-3.5 w-3.5" />{t(typeLabel(type as QuestionType))}</button>
            ))}
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-6">
        <h2 className="text-[16px] font-semibold">{t("Vocabulary")}</h2>
        {d.vocabulary.map((v, k) => (
          <div key={k} className="grid gap-2 rounded-[12px] border border-border/60 p-3 sm:grid-cols-[160px_110px_1fr_auto]">
            <input value={v.word} disabled={locked} placeholder={t("Word")} onChange={(e) => setV(k, { word: e.target.value })} className={inputClass} />
            <input value={v.pos} disabled={locked} placeholder={t("Part of speech")} onChange={(e) => setV(k, { pos: e.target.value })} className={inputClass} />
            <div className="space-y-2">
              <input value={v.definition} disabled={locked} placeholder={t("Definition")} onChange={(e) => setV(k, { definition: e.target.value })} className={inputClass} />
              <input value={v.example} disabled={locked} placeholder={t("Example")} onChange={(e) => setV(k, { example: e.target.value })} className={inputClass} />
            </div>
            {!locked && <button type="button" aria-label={t("Remove")} onClick={() => update({ vocabulary: d.vocabulary.filter((_, j) => j !== k) })} className="self-start p-2 text-muted-foreground hover:text-[#B4483D]"><X className="h-4 w-4" /></button>}
          </div>
        ))}
        {!locked && (
          <button type="button" onClick={() => update({ vocabulary: [...d.vocabulary, { word: "", pos: "", definition: "", example: "" }] })}
            className="h-9 rounded-[9px] border border-border/80 bg-[#FCF8F4] px-3 text-[12.5px] font-medium hover:bg-white"><Plus className="mr-1 inline h-3.5 w-3.5" />{t("Add word")}</button>
        )}
      </Card>

      {!locked && (
        <div className="sticky bottom-3 z-[5] flex flex-wrap items-center justify-end gap-3 rounded-[16px] border border-border/70 bg-[#FCF8F4]/95 p-3 backdrop-blur">
          {error && <span className="mr-auto text-[12.5px] text-[#B4483D]">{error}</span>}
          {!error && firstProblem && <span className="mr-auto text-[12.5px] text-[#9A5B1E]">{t("Question {n}", { n: String(firstProblem.n) })} {t(firstProblem.p!)}</span>}
          {!error && !firstProblem && dirty && <span className="mr-auto text-[12.5px] text-muted-foreground">{t("Unsaved changes")}</span>}
          <button type="button" disabled={pending || !!firstProblem || d.title.trim().length < 3} className={buttonPrimary}
            onClick={() => run(() => savePodcast(id, { ...d, vocabulary: d.vocabulary.filter((v) => v.word.trim() && v.definition.trim()) }), (r) => {
              setDirty(false);
              if (!id && r.id) router.replace(`/admin/podcasts/${r.id}`);
            })}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save draft")}
          </button>
        </div>
      )}
      {locked && error && <p className="text-[12.5px] text-[#B4483D]">{error}</p>}
    </div>
  );
}
