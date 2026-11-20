"use server";

import { revalidatePath } from "next/cache";
import { getPlatformContext } from "@/lib/auth/platform";
import { AiUnavailable } from "@/lib/ai/gemini";
import { fishConfigured, MAX_SCRIPT_CHARS, speakScript } from "@/lib/ai/fish";
import { generateSection, SPECS, type TestSkill } from "@/lib/ai/test-draft";
import { LEVELS, type Level } from "@/lib/ai/draft";
import { testToStored, type SectionDraft, type TestDraft } from "@/lib/ai/test-store";
import type { Cast } from "@/lib/ai/script";
import { LIBRARY_AUDIO } from "@/lib/audio";
import { withAdminAi } from "@/lib/ai/admin-ai";


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const level = (v: string): Level => ((LEVELS as readonly string[]).includes(v) ? (v as Level) : "B2");
const skillOf = (v: string): TestSkill => (v === "listening" ? "listening" : "reading");
const friendly = (m: string) => (/forbidden|permission/i.test(m) ? "You don't have permission to do that." : m);

export async function createTest(form: FormData): Promise<{ id?: string; error?: string }> {
  const { supabase } = await getPlatformContext();
  const { data, error } = await supabase.rpc("new_library_test", {
    p_skill: skillOf(String(form.get("skill") ?? "")),
    p_title: String(form.get("title") ?? "").trim().slice(0, 200),
    p_level: level(String(form.get("level") ?? "")),
  });
  if (error || !data) return { error: friendly(error?.message ?? "Could not create the test.") };
  revalidatePath("/admin/tests");
  return { id: data };
}

export async function draftSection(skill: TestSkill, part: number, lvl: string, topic: string): Promise<{ section?: SectionDraft; error?: string }> {
  if (!SPECS[skillOf(skill)][part]) return { error: "Unknown section." };
  const r = await withAdminAi("test", async () => {
    const { section, usage } = await generateSection({ skill: skillOf(skill), part, level: level(lvl), topic: String(topic ?? "").slice(0, 200) });
    return { value: section, model: usage.model, prompt: usage.prompt, completion: usage.completion, cost: usage.cost ?? 0 };
  });
  return { section: r.value, error: r.error };
}

/** Records a listening section into the library bucket under its test. */
export async function recordSection(testId: string, script: string, previous?: string, cast?: Cast): Promise<{ path?: string; url?: string; error?: string }> {
  if (!UUID.test(testId)) return { error: "Test not found." };
  if (!fishConfigured()) return { error: "Audio is not configured yet. Add a Fish Audio key in the hosting settings." };
  const text = String(script ?? "").trim();
  if (text.length < 20) return { error: "Write the script first." };
  if (text.length > MAX_SCRIPT_CHARS) return { error: "The script is too long for one recording (12,000 characters at most)." };
  const { supabase } = await getPlatformContext();
  const r = await withAdminAi("audio", async () => {
    const speech = await speakScript(text, cast && typeof cast === "object" ? cast : {});
    const path = `tests/${testId}/${crypto.randomUUID()}.mp3`;
    const { error } = await supabase.storage.from(LIBRARY_AUDIO).upload(path, speech.audio, { contentType: "audio/mpeg", upsert: false });
    if (error) { console.error("Library audio upload failed", error.message); throw new AiUnavailable("The audio could not be saved. Try again."); }
    return { value: path, model: speech.model, prompt: speech.bytes, completion: 0, cost: 0 };
  });
  if (!r.value) return { error: r.error };
  if (previous && previous.startsWith(`tests/${testId}/`)) await supabase.storage.from(LIBRARY_AUDIO).remove([previous]);
  const { data } = await supabase.storage.from(LIBRARY_AUDIO).createSignedUrl(r.value, 7200);
  return { path: r.value, url: data?.signedUrl };
}

export type { TestDraft };

/** Saves the whole test: questions numbered q1.. across sections, group ids made unique per section. */
export async function saveTest(testId: string, t: TestDraft): Promise<{ error?: string }> {
  if (!UUID.test(testId)) return { error: "Test not found." };
  const { supabase } = await getPlatformContext();
  const { sections, answers, transcripts } = testToStored(t);
  const { error } = await supabase.rpc("save_library_test", {
    p_id: testId, p_skill: t.skill, p_title: t.title, p_level: t.level,
    p_sections: sections, p_answers: answers, p_transcripts: transcripts,
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/admin/tests", "layout");
  return {};
}

export async function setTestStatus(testId: string, status: "draft" | "published" | "hidden"): Promise<{ error?: string }> {
  const { supabase } = await getPlatformContext();
  const { error } = await supabase.rpc("set_library_test_status", { p_id: testId, p_status: status });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/admin/tests", "layout");
  return {};
}

export async function deleteTest(testId: string): Promise<{ error?: string }> {
  if (!UUID.test(testId)) return { error: "Test not found." };
  const { supabase } = await getPlatformContext();
  const { error } = await supabase.rpc("delete_library_test", { p_id: testId });
  if (error) return { error: friendly(error.message) };
  // Its recordings are now unused; remove them.
  const { data: files } = await supabase.storage.from(LIBRARY_AUDIO).list(`tests/${testId}`);
  if (files?.length) await supabase.storage.from(LIBRARY_AUDIO).remove(files.map((f) => `tests/${testId}/${f.name}`));
  revalidatePath("/admin/tests");
  return {};
}
