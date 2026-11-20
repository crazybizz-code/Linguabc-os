"use server";

import { revalidatePath } from "next/cache";
import { getPlatformContext } from "@/lib/auth/platform";
import { AiUnavailable } from "@/lib/ai/gemini";
import { fishConfigured, MAX_SCRIPT_CHARS, podcastModel, speakScript } from "@/lib/ai/fish";
import { generatePodcast } from "@/lib/ai/podcast-draft";
import { FORMATS, scriptToTranscript, type PodcastDraft } from "@/lib/ai/podcast";
import { storedAnswers, storedQuestions } from "@/lib/ai/draft-store";
import { LEVELS, type Level } from "@/lib/ai/draft";
import { withAdminAi } from "@/lib/ai/admin-ai";
import type { Cast } from "@/lib/ai/script";

const BUCKET = "library-podcasts";
const PATH = /^podcasts\/[0-9a-f-]{36}\.mp3$/;
const level = (v: string): Level => ((LEVELS as readonly string[]).includes(v) ? (v as Level) : "B1");
const friendly = (m: string) => (/forbidden|permission/i.test(m) ? "You don't have permission to do that." : m);

export async function draftPodcast(lvl: string, topic: string, format: string): Promise<{ draft?: PodcastDraft; error?: string }> {
  const f = (FORMATS as readonly string[]).includes(format) ? format : FORMATS[Math.floor(Math.random() * FORMATS.length)];
  const r = await withAdminAi("test", async () => {
    const { draft, usage } = await generatePodcast({ level: level(lvl), topic: String(topic ?? "").slice(0, 200), format: f });
    return { value: draft, model: usage.model, prompt: usage.prompt, completion: usage.completion, cost: usage.cost ?? 0 };
  });
  return { draft: r.value, error: r.error };
}

/** Records the script with the podcast voice model into the public podcast bucket. */
export async function recordPodcast(script: string, previous?: string, cast?: Cast): Promise<{ path?: string; url?: string; seconds?: number; error?: string }> {
  if (!fishConfigured()) return { error: "Audio is not configured yet. Add a Fish Audio key in the hosting settings." };
  const text = String(script ?? "").trim();
  if (text.length < 20) return { error: "Write the script first." };
  if (text.length > MAX_SCRIPT_CHARS) return { error: "The script is too long for one recording (12,000 characters at most)." };
  const { supabase } = await getPlatformContext();
  const r = await withAdminAi("audio", async () => {
    const speech = await speakScript(text, cast && typeof cast === "object" ? cast : {}, { model: podcastModel() });
    const path = `podcasts/${crypto.randomUUID()}.mp3`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, speech.audio, { contentType: "audio/mpeg", upsert: false });
    if (error) { console.error("Podcast upload failed", error.message); throw new AiUnavailable("The audio could not be saved. Try again."); }
    return { value: { path, seconds: speech.seconds }, model: speech.model, prompt: speech.bytes, completion: 0, cost: 0 };
  });
  if (!r.value) return { error: r.error };
  // The previous take goes once nothing uses it (storage policy checks).
  if (previous && PATH.test(previous)) await supabase.storage.from(BUCKET).remove([previous]);
  return { ...r.value, url: supabase.storage.from(BUCKET).getPublicUrl(r.value.path).data.publicUrl };
}

export type PodcastSave = PodcastDraft & { levelMin: Level; levelMax: Level; audioPath?: string; seconds?: number };

export async function savePodcast(id: string | null, p: PodcastSave): Promise<{ id?: string; error?: string }> {
  const { supabase } = await getPlatformContext();
  const audioPath = p.audioPath && PATH.test(p.audioPath) ? p.audioPath : null;
  const { data: before } = id ? await supabase.from("library_items").select("audio_path").eq("id", id).maybeSingle() : { data: null };
  const { data, error } = await supabase.rpc("save_library_podcast", {
    p_id: id, p_title: String(p.title ?? "").slice(0, 200), p_description: String(p.description ?? "").slice(0, 300),
    p_level_min: level(p.levelMin), p_level_max: level(p.levelMax), p_topics: (p.topics ?? []).slice(0, 5),
    p_transcript: scriptToTranscript(p.script ?? ""), p_questions: storedQuestions(p.questions ?? []),
    p_answers: storedAnswers(p.questions ?? []), p_vocabulary: (p.vocabulary ?? []).slice(0, 12),
    p_audio_path: audioPath, p_audio_url: audioPath ? supabase.storage.from(BUCKET).getPublicUrl(audioPath).data.publicUrl : null,
    p_seconds: Math.max(0, Math.round(Number(p.seconds) || 0)),
  });
  if (error || !data) return { error: friendly(error?.message ?? "Could not save the podcast.") };
  // A replaced recording is no longer used by anything: remove it.
  if (before?.audio_path && before.audio_path !== audioPath) await supabase.storage.from(BUCKET).remove([before.audio_path]);
  revalidatePath("/admin/podcasts", "layout");
  return { id: data };
}

export async function setPodcastStatus(id: string, status: "draft" | "published" | "hidden"): Promise<{ error?: string }> {
  const { supabase } = await getPlatformContext();
  const { error } = await supabase.rpc("set_library_podcast_status", { p_id: id, p_status: status });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/admin/podcasts", "layout");
  return {};
}

export async function deletePodcast(id: string, audioPath?: string): Promise<{ error?: string }> {
  const { supabase } = await getPlatformContext();
  const { error } = await supabase.rpc("delete_library_podcast", { p_id: id });
  if (error) return { error: friendly(error.message) };
  if (audioPath && PATH.test(audioPath)) await supabase.storage.from(BUCKET).remove([audioPath]);
  revalidatePath("/admin/podcasts");
  return {};
}
