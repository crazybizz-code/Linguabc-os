import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/supabase/config";
import { workerConfig, workerVoicesFor } from "@/lib/ai/engines";
import { planScript, type Cast } from "@/lib/ai/script";
import { answersHash, idempotencyKey, isWorkerEngine, newToken, sha256, signedHeaders, type AnswerCheck, type JobRequest, type WorkerEngineId } from "@/lib/ai/worker-protocol";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Recordings by an open-source voice worker run as jobs (migration 0030):
 * this module starts them, retries them and reads their result. The
 * worker uploads the MP3 itself, with a signed upload URL made here as the
 * signed-in user, so Storage policies decide where it may write; the
 * worker's reports arrive at /api/audio-jobs/callback.
 *
 * Each job names its draft slot (draftKey) so a closed editor finds it again
 * (recoverAudioJob), and is attached to the draft at most once
 * (attach_audio_job). A test's answer key goes to the worker in the request
 * only; the job keeps the number of answers, and the database refuses to
 * mark it completed unless every one was checked and heard.
 */
export type JobTarget =
  | { purpose: "test"; testId: string }
  | { purpose: "podcast" }
  | { purpose: "homework"; centerId: string };

const BUCKET = { test: "library-audio", podcast: "library-podcasts", homework: "listening-audio" } as const;

function newPath(t: JobTarget): string {
  const file = `${crypto.randomUUID()}.mp3`;
  return t.purpose === "test" ? `tests/${t.testId}/${file}` : t.purpose === "podcast" ? `podcasts/${file}` : `${t.centerId}/${file}`;
}

const centerOf = (t: JobTarget) => (t.purpose === "homework" ? t.centerId : null);
const callbackUrl = () => process.env.AUDIO_JOBS_CALLBACK_URL || `${siteUrl()}/api/audio-jobs/callback`;

const friendly = (m: string) =>
  /forbidden|permission/i.test(m) ? "You don't have permission to do that." :
  /already running/i.test(m) ? "Three recordings are already running. Wait for one to finish." :
  /still running/i.test(m) ? "This recording is still running." :
  /only a completed/i.test(m) ? "Approve the recording before you use it." :
  /no attempts left/i.test(m) ? "This recording failed too many times. Change the script or try another voice engine." :
  /not stopped/i.test(m) ? "This recording is still running." : "Could not start the recording. Try again.";

/** Sends a job to its worker; on failure the job is marked failed so it can be retried. */
async function dispatch(engine: WorkerEngineId, req: JobRequest): Promise<string | undefined> {
  const cfg = workerConfig(engine);
  const body = JSON.stringify(req);
  let problem: string | undefined;
  if (!cfg) problem = "The voice worker is not configured.";
  else {
    const res = await fetch(`${cfg.url}/jobs`, { method: "POST", headers: signedHeaders(body, cfg.secret), body, signal: AbortSignal.timeout(15_000) })
      .catch(() => null);
    if (!res || res.status !== 202) problem = res ? `The voice worker refused the recording (${res.status}).` : "Could not reach the voice worker.";
  }
  if (problem) {
    const admin = createAdminClient();
    await admin?.rpc("audio_job_update", { p_job: req.job_id, p_token_hash: sha256(req.callback.token), p_attempt: req.attempt,
      p_status: "failed", p_progress: 0, p_error: problem });
  }
  return problem;
}

async function signedUpload(supabase: Client, bucket: string, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  return error || !data ? null : data.signedUrl;
}

/** The fingerprint of a script, kept with the job so recovery can tell whether the draft changed since. */
export const scriptHash = (script: string) => sha256(script.trim());

export async function startAudioJob(supabase: Client, opts: {
  engine: string; script: string; cast: Cast; target: JobTarget; draftKey: string; answers?: AnswerCheck[];
}): Promise<{ jobId?: string; error?: string }> {
  if (!isWorkerEngine(opts.engine)) return { error: "Unknown voice engine." };
  const engine = opts.engine;
  if (!workerConfig(engine)) return { error: "This voice engine is not configured." };
  const voices = await workerVoicesFor(engine);
  if (!voices.length) return { error: "The voice worker has no approved voices." };
  const plan = planScript(opts.script, opts.cast, voices);
  if (!plan.some((p) => p.kind === "speech")) return { error: "Write the script first." };

  const target = opts.target;
  const token = newToken();
  const answers = opts.answers ?? [];
  // Same draft, plan and answers = same job (no second recording, no second charge).
  const key = idempotencyKey({ engine, target, draft: opts.draftKey, plan, answers: answersHash(answers) });
  const { data, error } = await supabase.rpc("enqueue_audio_job", {
    p_center: centerOf(target), p_purpose: target.purpose, p_provider: engine, p_bucket: BUCKET[target.purpose],
    p_path: newPath(target), p_idempotency_key: key, p_token_hash: sha256(token),
    p_draft_key: opts.draftKey, p_script_hash: scriptHash(opts.script), p_answers_expected: answers.length,
  });
  if (error || !data) return { error: friendly(error?.message ?? "") };
  const job = data as { id: string; status: string; created: boolean; target_path: string };
  if (!job.created) return { jobId: job.id }; // the same recording is already running or done

  const upload = await signedUpload(supabase, BUCKET[target.purpose], job.target_path);
  const req: JobRequest = {
    version: 1, job_id: job.id, attempt: 1, engine, scope: centerOf(target) ?? "platform", language: "English", plan,
    checks: { answers }, upload: { url: upload ?? "", content_type: "audio/mpeg" }, callback: { url: callbackUrl(), token },
  };
  const problem = upload ? await dispatch(engine, req) : "Could not prepare the upload for this recording.";
  return problem ? { jobId: job.id, error: problem } : { jobId: job.id };
}

export async function retryAudioJob(supabase: Client, jobId: string, script: string, cast: Cast, answers: AnswerCheck[] = []): Promise<{ error?: string }> {
  const { data: job } = await supabase.from("audio_jobs").select("id, provider, purpose, center_id, target_bucket, target_path").eq("id", jobId).maybeSingle();
  if (!job || !isWorkerEngine(job.provider)) return { error: "Recording not found." };
  const target: JobTarget = job.purpose === "homework" ? { purpose: "homework", centerId: job.center_id! }
    : job.purpose === "test" ? { purpose: "test", testId: job.target_path.split("/")[1] } : { purpose: "podcast" };
  const token = newToken();
  const path = newPath(target);
  const { data: attempt, error } = await supabase.rpc("retry_audio_job", { p_job: jobId, p_token_hash: sha256(token), p_path: path });
  if (error || !attempt) return { error: friendly(error?.message ?? "") };
  const voices = await workerVoicesFor(job.provider);
  const upload = await signedUpload(supabase, job.target_bucket, path);
  const req: JobRequest = {
    version: 1, job_id: jobId, attempt: Number(attempt), engine: job.provider, scope: job.center_id ?? "platform", language: "English",
    plan: planScript(script, cast, voices), checks: { answers }, upload: { url: upload ?? "", content_type: "audio/mpeg" },
    callback: { url: callbackUrl(), token },
  };
  const problem = upload ? await dispatch(job.provider, req) : "Could not prepare the upload for this recording.";
  return problem ? { error: problem } : {};
}

export type JobResult = { status: string; path?: string; url?: string; seconds?: number; qa?: unknown; error?: string };

/** A finished job's file and QA, readable by whoever may see the job (RLS). */
export async function audioJobResult(supabase: Client, jobId: string): Promise<JobResult> {
  const { data: job } = await supabase.from("audio_jobs")
    .select("status, target_bucket, target_path, seconds, qa, error").eq("id", jobId).maybeSingle();
  if (!job) return { status: "missing", error: "Recording not found." };
  if (job.status !== "completed" && job.status !== "needs_review") return { status: job.status, error: job.error ?? undefined };
  const url = job.target_bucket === "library-podcasts"
    ? supabase.storage.from(job.target_bucket).getPublicUrl(job.target_path).data.publicUrl
    : (await supabase.storage.from(job.target_bucket).createSignedUrl(job.target_path, 7200)).data?.signedUrl;
  return { status: job.status, path: job.target_path, url: url ?? undefined, seconds: job.seconds ? Number(job.seconds) : undefined, qa: job.qa };
}

export async function reviewAudioJob(supabase: Client, jobId: string, approve: boolean): Promise<{ status?: string; error?: string }> {
  const { data, error } = await supabase.rpc("review_audio_job", { p_job: jobId, p_approve: approve });
  return error ? { error: friendly(error.message) } : { status: String(data) };
}

export type RecoveredJob = {
  id: string; provider: string; status: string; attached: boolean; sameScript: boolean; startedAt: string;
};

/**
 * The newest recording this person made for a draft slot that the draft does
 * not hold yet (running, finished, waiting for review or failed), unless they
 * dismissed it. RLS limits rows to jobs they may see; nothing is re-sent.
 */
export async function recoverAudioJob(supabase: Client, userId: string, draftKey: string, script: string, audioPath?: string): Promise<RecoveredJob | null> {
  const { data: job } = await supabase.from("audio_jobs")
    .select("id, provider, status, target_path, script_hash, attached_at, created_at")
    .eq("draft_key", draftKey).eq("created_by", userId).is("dismissed_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!job || (audioPath && job.target_path === audioPath)) return null;
  return { id: job.id, provider: job.provider, status: job.status, attached: Boolean(job.attached_at),
    sameScript: job.script_hash === scriptHash(script), startedAt: job.created_at };
}

/** Puts a completed recording into the draft: returns its path (the same file every time). */
export async function attachAudioJob(supabase: Client, jobId: string): Promise<{ path?: string; error?: string }> {
  const { data, error } = await supabase.rpc("attach_audio_job", { p_job: jobId });
  return error || !data ? { error: friendly(error?.message ?? "") } : { path: String(data) };
}

export async function dismissAudioJob(supabase: Client, jobId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("dismiss_audio_job", { p_job: jobId });
  return error ? { error: friendly(error.message) } : {};
}
