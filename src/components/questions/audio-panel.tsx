"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AudioLines, Loader2 } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, buttonSecondary, inputClass } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";
import { defaultCast, speakersOf, type Cast, type Voice } from "@/lib/ai/script";
import { useAudioJob } from "./use-audio-job";

/** An engine offered in the LinguABC Audio Studio (platform admins only; see src/lib/ai/engines.ts). */
export type StudioEngineOption = { id: string; label: string; voices: Voice[]; async: boolean };

/** Job actions for engines that run on a voice worker (src/app/(staff)/admin/audio-jobs/actions.ts). */
export type StudioJobs = {
  start: (engine: string, script: string, cast: Cast) => Promise<{ jobId?: string; error?: string }>;
  result: (jobId: string) => Promise<{ status: string; path?: string; url?: string; seconds?: number; qa?: unknown; error?: string }>;
  review: (jobId: string, approve: boolean) => Promise<{ status?: string; error?: string }>;
  retry: (jobId: string, script: string, cast: Cast) => Promise<{ error?: string }>;
  /** The editor's slot's earlier recording that the draft does not hold yet (after the page was closed). */
  recover: (script: string, audioPath?: string) => Promise<RecoveredStudioJob | null>;
  /** Marks a completed recording as put into the draft (once) and returns its file. */
  attach: (jobId: string) => Promise<{ path?: string; error?: string }>;
  dismiss: (jobId: string) => Promise<{ error?: string }>;
};

export type RecoveredStudioJob = { id: string; provider: string; status: string; attached: boolean; sameScript: boolean; startedAt: string };

/**
 * Generates the recording for a listening script and previews it.
 *
 * Without `engines` (centres' homework) it behaves as before: one direct
 * recording through `record`. With `engines` (LinguABC Audio Studio, platform
 * admins), the admin picks an engine; Fish still records directly, and the
 * open-source engines run as a job with live progress, automatic QA and,
 * when QA flags something, a listen-and-approve step.
 *
 * Jobs survive the page: on opening, the panel asks for its slot's newest
 * recording the draft does not hold yet and follows it again. A recording
 * started here goes into the draft when it completes; one found again is
 * offered ("Use this recording"), so nothing is re-recorded or re-charged.
 */
export function AudioPanel({ script, audioPath, initialUrl, voices, record, onChange, engines, jobs, onSeconds }: {
  script: string; audioPath?: string; initialUrl?: string; voices: Voice[];
  record: (script: string, previous?: string, cast?: Cast) => Promise<{ path?: string; url?: string; error?: string }>;
  onChange: (path: string | undefined) => void;
  engines?: StudioEngineOption[];
  jobs?: StudioJobs;
  onSeconds?: (seconds: number) => void;
}) {
  const t = useT();
  const [engineId, setEngineId] = useState(engines?.[0]?.id ?? "fish");
  const engine = engines?.find((e) => e.id === engineId);
  const engineVoices = engine ? engine.voices : voices;
  const [chosen, setChosen] = useState<Cast>({});
  const speakers = speakersOf(script).slice(0, 8);
  const cast = defaultCast(speakers, engineVoices, chosen);
  const [url, setUrl] = useState<string | undefined>(initialUrl);
  const [madeFrom, setMadeFrom] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [jobId, setJobId] = useState<string>();
  const [jobNonce, setJobNonce] = useState(0);
  const [review, setReview] = useState<{ path: string; problems: string[] }>();
  const [recovered, setRecovered] = useState<RecoveredStudioJob>();
  const [offer, setOffer] = useState<{ path: string; url?: string; seconds?: number }>();
  const job = useAudioJob(jobId, jobNonce);
  const asked = useRef(false);
  const handled = useRef<string>("");
  const running = Boolean(job && (job.status === "queued" || job.status === "processing"));
  const busy = pending || running;
  const stale = audioPath && madeFrom !== undefined && madeFrom !== script;

  // Once per opening: find a recording made for this slot while the page was closed.
  useEffect(() => {
    if (asked.current || !jobs) return;
    asked.current = true;
    void jobs.recover(script, audioPath).then((r) => {
      if (!r) return;
      setRecovered(r);
      setJobId(r.id);
      setJobNonce((n) => n + 1);
      if (engines?.some((e) => e.id === r.provider)) setEngineId(r.provider);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the editor opens
  }, []);

  const use = (id: string, fallback?: string) => start(async () => {
    const a = jobs ? await jobs.attach(id) : { error: "Something went wrong. Try again." };
    if (a.error || !(a.path ?? fallback)) { setError(t(a.error ?? "Something went wrong. Try again.")); return; }
    setReview(undefined); setOffer(undefined); setRecovered(undefined);
    setMadeFrom(recovered && !recovered.sameScript ? "" : script);
    onChange(a.path ?? fallback);
  });

  // A finished job: fetch its file once; one started here goes into the draft, one found again is offered.
  useEffect(() => {
    if (!jobId || !job || !jobs) return;
    const key = `${jobId}:${job.attempts}:${job.status}`;
    if (handled.current === key || (job.status !== "completed" && job.status !== "needs_review" && job.status !== "failed")) return;
    handled.current = key;
    if (job.status === "failed") return;
    void jobs.result(jobId).then((r) => {
      if (!r.path) { setError(t(r.error ?? "Something went wrong. Try again.")); return; }
      setUrl(r.url);
      if (r.seconds) onSeconds?.(r.seconds);
      if (job.status === "completed") {
        if (recovered) { setOffer({ path: r.path, url: r.url, seconds: r.seconds }); return; }
        const path = r.path;
        void jobs.attach(jobId).then((a) => {
          if (a.error) { setError(t(a.error)); return; }
          setReview(undefined); setMadeFrom(script); onChange(a.path ?? path);
        });
        return;
      }
      const qa = (r.qa ?? {}) as { problems?: unknown };
      setReview({ path: r.path, problems: Array.isArray(qa.problems) ? qa.problems.map(String) : [] });
    });
  }, [job, jobId, jobs, onChange, onSeconds, recovered, script, t]);

  // The admin chose another recording: the old finished one is not offered again.
  const forget = () => {
    if (jobId && jobs && job && !(job.status === "queued" || job.status === "processing")) void jobs.dismiss(jobId).catch(() => undefined);
    setRecovered(undefined); setOffer(undefined); setReview(undefined); setJobId(undefined);
  };

  const go = () => start(async () => {
    setError(undefined);
    setReview(undefined);
    if (offer || (job && job.status !== "queued" && job.status !== "processing")) forget();
    if (engine?.async && jobs) {
      const r = await jobs.start(engine.id, script, cast);
      if (r.jobId) { setRecovered(undefined); setJobId(r.jobId); setJobNonce((n) => n + 1); }
      if (r.error) setError(t(r.error));
      return;
    }
    const r = await record(script, audioPath, cast);
    if (r.error || !r.path) { setError(t(r.error ?? "Something went wrong. Try again.")); return; }
    setUrl(r.url); setMadeFrom(script); onChange(r.path);
  });

  const status = running && job
    ? (job.status === "queued" ? t("Waiting for the voice worker…")
      : t("Recording on the voice worker: {progress}% ({done} of {total} parts).", { progress: job.progress, done: job.segments_done, total: job.segments_total ?? "?" }))
    : pending ? t("Recording the script — this can take up to a minute.")
    : audioPath ? t("Listen before you save.") : t("No recording yet. Without one, students read the script instead.");

  return (
    <div className="space-y-3 rounded-[12px] border border-border/70 bg-[#FCF8F4] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-medium">{t("Recording")}</p>
          <p className="text-[12px] text-muted-foreground">{status}</p>
        </div>
        <button type="button" disabled={busy || script.trim().length < 20} className={buttonPrimary} onClick={go}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
          {audioPath ? t("Record again") : t("Generate audio")}
        </button>
      </div>
      {engines && engines.length > 1 && (
        <FieldLabel label={t("Voice engine")}>
          <select value={engineId} disabled={busy} onChange={(e) => { setEngineId(e.target.value); setChosen({}); }} className={inputClass}>
            {engines.map((e) => <option key={e.id} value={e.id}>{t(e.label)}</option>)}
          </select>
        </FieldLabel>
      )}
      {speakers.length > 0 && engineVoices.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {speakers.map((s) => (
            <FieldLabel key={s} label={s || t("Narrator")}>
              <select value={cast[s]} disabled={busy} onChange={(e) => setChosen({ ...chosen, [s]: e.target.value })} className={inputClass}>
                {engineVoices.map((v) => <option key={v.id} value={v.id}>{t(v.label)}</option>)}
              </select>
            </FieldLabel>
          ))}
        </div>
      )}
      {running && job && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-border/60"><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(3, job.progress)}%` }} /></div>
          <p className="text-[12px] text-muted-foreground">{t("You can close this page: the recording continues and is offered here when you come back.")}</p>
        </div>
      )}
      {url && <audio controls src={url} className="w-full" />}
      {recovered && (
        <p className="text-[12.5px] text-muted-foreground">
          {t("Found a recording started earlier for this part.")}{" "}
          {!recovered.sameScript && <span className="text-[#9A5B1E]">{t("It was made from an earlier version of the script.")}</span>}
        </p>
      )}
      {offer && jobId && jobs && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border/70 bg-white/60 p-3 text-[12.5px]">
          <span className="mr-auto">{t("This recording finished while the page was closed. Listen, then use it or dismiss it.")}</span>
          <button type="button" className={buttonPrimary} disabled={pending} onClick={() => use(jobId, offer.path)}>{t("Use this recording")}</button>
          <button type="button" className={buttonSecondary} disabled={pending} onClick={() => { forget(); setUrl(initialUrl); }}>{t("Dismiss")}</button>
        </div>
      )}
      {review && jobId && jobs && (
        <div className="space-y-2 rounded-[10px] border border-[#E8C9A0] bg-[#FFF6EA] p-3 text-[12.5px]">
          <p>{t("The automatic check flagged this recording. Listen to it, then approve or reject it.")}</p>
          {review.problems.length > 0 && <ul className="list-disc pl-5 text-[#9A5B1E]">{review.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <div className="flex gap-2">
            <button type="button" className={buttonPrimary} disabled={pending} onClick={() => start(async () => {
              const r = await jobs.review(jobId, true);
              if (r.error) { setError(t(r.error)); return; }
              const a = await jobs.attach(jobId);
              if (a.error) { setError(t(a.error)); return; }
              const path = a.path ?? review.path; setReview(undefined); setRecovered(undefined);
              setMadeFrom(recovered && !recovered.sameScript ? "" : script); onChange(path);
            })}>{t("Approve")}</button>
            <button type="button" className={buttonSecondary} disabled={pending} onClick={() => start(async () => {
              const r = await jobs.review(jobId, false);
              if (r.error) setError(t(r.error)); else { setReview(undefined); setRecovered(undefined); setUrl(initialUrl); }
            })}>{t("Reject")}</button>
          </div>
        </div>
      )}
      {job?.status === "failed" && jobId && jobs && (
        <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-[#B4483D]">
          <span>{t("This recording failed: {error}", { error: t(job.error ?? "Something went wrong. Try again.") })}</span>
          {job.attempts < job.max_attempts && (
            <button type="button" className={buttonSecondary} disabled={pending} onClick={() => start(async () => {
              setError(undefined);
              const r = await jobs.retry(jobId, script, cast);
              if (r.error) setError(t(r.error)); else { setRecovered(undefined); setJobNonce((n) => n + 1); }
            })}>{t("Try again")}</button>
          )}
          {recovered && <button type="button" className={buttonSecondary} disabled={pending} onClick={forget}>{t("Dismiss")}</button>}
        </div>
      )}
      {stale && <p className="text-[12.5px] text-[#9A5B1E]">{t("The script changed after recording. Record again so they match.")}</p>}
      {error && <p className="text-[12.5px] text-[#B4483D]">{error}</p>}
    </div>
  );
}
