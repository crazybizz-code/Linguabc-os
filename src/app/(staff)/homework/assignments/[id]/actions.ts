"use server";

import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/auth/current";
import { AudioUnavailable, fishConfigured, planAudio, synthesize } from "@/lib/audio/fish";
import { audioStorageConfigured, removeAudio, uploadAudio } from "@/lib/audio/storage";

const NO_PERMISSION = "You don't have permission to do that.";
const friendly = (m: string) => (/forbidden|permission/i.test(m) ? NO_PERMISSION : m);

/**
 * Generates a listening set's audio once: lock the set, call Fish Audio,
 * check the result, upload it, record it. Playback never comes here.
 * `again` asks for a fresh take of the same script.
 */
export async function generateListeningAudio(setId: string, again = false): Promise<{ error?: string }> {
  if (!fishConfigured()) return { error: "Fish Audio is not configured yet. Add FISH_AUDIO_API_KEY in the hosting settings." };
  if (!audioStorageConfigured()) return { error: "Audio storage is not configured yet. Add the Supabase secret key in the hosting settings." };
  const { supabase, workspace } = await getStaffContext();
  const { data: set } = await supabase.from("listening_sets").select("id, assignment_id, script")
    .eq("id", setId).eq("center_id", workspace.centerId).maybeSingle();
  if (!set) return { error: NO_PERMISSION };

  let plan;
  try { plan = planAudio(set.script, again); } catch (e) { return { error: e instanceof AudioUnavailable ? e.message : "The audio script could not be read." }; }

  const { data: begun, error: beginError } = await supabase.rpc("begin_listening_audio", { p_set: set.id, p_hash: plan.hash });
  if (beginError || !begun) return { error: friendly(beginError?.message ?? NO_PERMISSION) };
  const job = begun as { skip: boolean; path: string };
  const done = () => revalidatePath(`/homework/assignments/${set.assignment_id}`);
  if (job.skip) { done(); return {}; }

  const { data: requestId, error: claimError } = await supabase.rpc("claim_ai_request", { p_center: workspace.centerId, p_kind: "tts" });
  if (claimError || requestId == null) {
    const message = claimError && /AI limit/.test(claimError.message) ? claimError.message : NO_PERMISSION;
    await supabase.rpc("fail_listening_audio", { p_set: set.id, p_error: message });
    return { error: message };
  }

  let uploaded = false;
  try {
    const audio = await synthesize(plan);
    await uploadAudio(job.path, audio.bytes);
    uploaded = true;
    const { data: old, error } = await supabase.rpc("finish_listening_audio", {
      p_set: set.id, p_path: job.path, p_bytes: audio.bytes.length, p_duration_ms: audio.durationMs, p_model: plan.model, p_voices: plan.voices,
    });
    if (error) throw new Error(error.message);
    await supabase.rpc("finish_ai_request", { p_id: requestId, p_model: plan.model, p_prompt: plan.characters, p_completion: 0, p_cost: 0, p_ok: true });
    if (old) await removeAudio(old);
    done();
    return {};
  } catch (e) {
    if (!(e instanceof AudioUnavailable)) console.error(e);
    const message = e instanceof AudioUnavailable ? e.message : "The audio could not be saved. Try again.";
    if (uploaded) await removeAudio(job.path);
    await supabase.rpc("fail_listening_audio", { p_set: set.id, p_error: message });
    await supabase.rpc("finish_ai_request", { p_id: requestId, p_model: plan.model, p_prompt: 0, p_completion: 0, p_cost: 0, p_ok: false });
    done();
    return { error: message };
  }
}
