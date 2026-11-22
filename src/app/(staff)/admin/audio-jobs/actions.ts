"use server";

import { getPlatformContext } from "@/lib/auth/platform";
import { withAdminAi } from "@/lib/ai/admin-ai";
import { engineEnabled } from "@/lib/ai/engines";
import { MAX_SCRIPT_CHARS, type Cast } from "@/lib/ai/script";
import { cleanAnswers, isWorkerEngine } from "@/lib/ai/worker-protocol";
import {
  attachAudioJob, audioJobResult, dismissAudioJob, recoverAudioJob, retryAudioJob, reviewAudioJob, startAudioJob,
  type JobResult, type JobTarget, type RecoveredJob,
} from "@/lib/audio-jobs";

/**
 * Audio Studio jobs for the LinguABC library (platform admins only:
 * getPlatformContext is a 404 for anyone else, and the database checks
 * again in enqueue_audio_job). Fish recordings keep their direct actions.
 *
 * A test section's answer key (gap questions' accepted answers) comes with
 * the request, is validated here and goes only to the worker's ASR check.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The draft slot a recording is for: a test's section, or a podcast (new = not saved yet). */
export type StudioTarget = { kind: "test"; testId: string; section: number } | { kind: "podcast"; podcastId?: string | null };

function draftKeyOf(target: StudioTarget): string | null {
  if (target?.kind === "test") {
    return UUID.test(target.testId) && Number.isInteger(target.section) && target.section >= 0 && target.section < 100
      ? `test:${target.testId}:${target.section}` : null;
  }
  if (target?.kind === "podcast") {
    const id = target.podcastId ?? "new";
    return id === "new" || UUID.test(id) ? `podcast:${id}` : null;
  }
  return null;
}

const jobTargetOf = (target: StudioTarget): JobTarget =>
  target.kind === "test" ? { purpose: "test", testId: target.testId } : { purpose: "podcast" };

export async function startStudioJob(engine: string, script: string, cast: Cast, target: StudioTarget, answers?: unknown): Promise<{ jobId?: string; error?: string }> {
  if (!isWorkerEngine(engine) || !engineEnabled(engine)) return { error: "This voice engine is not available." };
  const text = String(script ?? "").trim();
  if (text.length < 20) return { error: "Write the script first." };
  if (text.length > MAX_SCRIPT_CHARS) return { error: "The script is too long for one recording (12,000 characters at most)." };
  const draftKey = draftKeyOf(target);
  if (!draftKey) return { error: "Test not found." };
  const checks = cleanAnswers(target.kind === "test" ? answers : []);
  if (!checks) return { error: "The answer key could not be checked. Fix the answers and try again." };
  const jobTarget = jobTargetOf(target);
  const { supabase } = await getPlatformContext();
  // Counted as admin voice usage (no Fish bytes); the job itself runs on the worker.
  const r = await withAdminAi("audio", async () => {
    const started = await startAudioJob(supabase, { engine, script: text, cast: cast && typeof cast === "object" ? cast : {}, target: jobTarget, draftKey, answers: checks });
    return { value: started, model: `${engine}/job`, prompt: 0, completion: 0, cost: 0 };
  });
  return r.value ?? { error: r.error };
}

export async function studioJobResult(jobId: string): Promise<JobResult> {
  if (!UUID.test(jobId)) return { status: "missing", error: "Recording not found." };
  const { supabase } = await getPlatformContext();
  return audioJobResult(supabase, jobId);
}

export async function reviewStudioJob(jobId: string, approve: boolean): Promise<{ status?: string; error?: string }> {
  if (!UUID.test(jobId)) return { error: "Recording not found." };
  const { supabase } = await getPlatformContext();
  return reviewAudioJob(supabase, jobId, approve === true);
}

export async function retryStudioJob(jobId: string, script: string, cast: Cast, answers?: unknown): Promise<{ error?: string }> {
  if (!UUID.test(jobId)) return { error: "Recording not found." };
  const checks = cleanAnswers(answers);
  if (!checks) return { error: "The answer key could not be checked. Fix the answers and try again." };
  const { supabase } = await getPlatformContext();
  return retryAudioJob(supabase, jobId, String(script ?? "").trim(), cast && typeof cast === "object" ? cast : {}, checks);
}

/** The editor reopened: its slot's running or finished recording, if the draft does not hold it yet. */
export async function recoverStudioJob(target: StudioTarget, script: string, audioPath?: string): Promise<RecoveredJob | null> {
  const draftKey = draftKeyOf(target);
  if (!draftKey) return null;
  const { supabase, userId } = await getPlatformContext();
  return recoverAudioJob(supabase, userId, draftKey, String(script ?? ""), typeof audioPath === "string" ? audioPath : undefined);
}

export async function attachStudioJob(jobId: string): Promise<{ path?: string; error?: string }> {
  if (!UUID.test(jobId)) return { error: "Recording not found." };
  const { supabase } = await getPlatformContext();
  return attachAudioJob(supabase, jobId);
}

export async function dismissStudioJob(jobId: string): Promise<{ error?: string }> {
  if (!UUID.test(jobId)) return { error: "Recording not found." };
  const { supabase } = await getPlatformContext();
  return dismissAudioJob(supabase, jobId);
}
