"use server";

import { getPlatformContext } from "@/lib/auth/platform";
import { withAdminAi } from "@/lib/ai/admin-ai";
import { engineEnabled } from "@/lib/ai/engines";
import { MAX_SCRIPT_CHARS, type Cast } from "@/lib/ai/script";
import { isWorkerEngine } from "@/lib/ai/worker-protocol";
import { audioJobResult, retryAudioJob, reviewAudioJob, startAudioJob, type JobResult, type JobTarget } from "@/lib/audio-jobs";

/**
 * Audio Studio jobs for the LinguABC library (platform admins only:
 * getPlatformContext is a 404 for anyone else, and the database checks
 * again in enqueue_audio_job). Fish recordings keep their direct actions.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type StudioTarget = { kind: "test"; testId: string } | { kind: "podcast" };

export async function startStudioJob(engine: string, script: string, cast: Cast, target: StudioTarget): Promise<{ jobId?: string; error?: string }> {
  if (!isWorkerEngine(engine) || !engineEnabled(engine)) return { error: "This voice engine is not available." };
  const text = String(script ?? "").trim();
  if (text.length < 20) return { error: "Write the script first." };
  if (text.length > MAX_SCRIPT_CHARS) return { error: "The script is too long for one recording (12,000 characters at most)." };
  if (target.kind === "test" && !UUID.test(target.testId)) return { error: "Test not found." };
  const jobTarget: JobTarget = target.kind === "test" ? { purpose: "test", testId: target.testId } : { purpose: "podcast" };
  const { supabase } = await getPlatformContext();
  // Counted as admin voice usage (no Fish bytes); the job itself runs on the worker.
  const r = await withAdminAi("audio", async () => {
    const started = await startAudioJob(supabase, { engine, script: text, cast: cast && typeof cast === "object" ? cast : {}, target: jobTarget });
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

export async function retryStudioJob(jobId: string, script: string, cast: Cast): Promise<{ error?: string }> {
  if (!UUID.test(jobId)) return { error: "Recording not found." };
  const { supabase } = await getPlatformContext();
  return retryAudioJob(supabase, jobId, String(script ?? "").trim(), cast && typeof cast === "object" ? cast : {});
}
