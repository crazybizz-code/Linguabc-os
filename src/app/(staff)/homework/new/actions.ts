"use server";

import mammoth from "mammoth";
import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/auth/current";
import { aiConfigured, AiUnavailable, type Part, type Usage } from "@/lib/ai/gemini";
import { extractDraft, generateDraft, LEVELS, SKILLS, type Draft, type Level, type Skill } from "@/lib/ai/assignment-draft";
import { fishConfigured, MAX_SCRIPT_CHARS, speakScript } from "@/lib/ai/fish";
import { AUDIO_BUCKET, audioUrl } from "@/lib/audio";
import type { Cast } from "@/lib/ai/script";
import { storedAnswers, storedGroups, storedQuestions } from "@/lib/ai/draft-store";

export type DraftResult = { draft?: Draft; error?: string };
const MAX_FILE = 4 * 1024 * 1024;
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const pick = <T extends string>(v: string, list: readonly T[], fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);

const MAX_PDF_PAGES = 12;
const MAX_TEXT_CHARS = 30000;

/** Checks permission and limits, then runs the AI call and records its tokens and cost. */
async function withAi(kind: "generate" | "extract", run: () => Promise<{ draft: Draft; usage: Usage }>): Promise<DraftResult> {
  if (!aiConfigured()) return { error: "AI is not configured yet. Add an AI key in the hosting settings." };
  const { supabase, workspace } = await getStaffContext();
  const { data: id, error } = await supabase.rpc("claim_ai_request", { p_center: workspace.centerId, p_kind: kind });
  if (error || id == null) return { error: error && /AI limit/.test(error.message) ? error.message : "You don't have permission to do that." };
  try {
    const { draft, usage } = await run();
    await supabase.rpc("finish_ai_request", { p_id: id, p_model: usage.model, p_prompt: usage.prompt, p_completion: usage.completion, p_cost: usage.cost ?? 0, p_ok: true });
    return { draft };
  } catch (e) {
    await supabase.rpc("finish_ai_request", { p_id: id, p_model: "", p_prompt: 0, p_completion: 0, p_cost: 0, p_ok: false });
    return { error: aiError(e) };
  }
}

function aiError(e: unknown) {
  if (e instanceof AiUnavailable) return e.message;
  console.error(e);
  return "Something went wrong. Try again.";
}

export async function draftWithAI(form: FormData): Promise<DraftResult> {
  const skill = pick<Skill>(str(form.get("skill")), SKILLS, "reading");
  const level = pick<Level>(str(form.get("level")), LEVELS, "B1");
  const count = Math.min(15, Math.max(1, Number(str(form.get("count"))) || 6));
  const focus = str(form.get("focus")).slice(0, 300);
  const topic = str(form.get("topic")).slice(0, 200);
  return withAi("generate", () => generateDraft({ skill, level, focus, topic, count }));
}

export async function draftFromUpload(form: FormData): Promise<DraftResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_FILE) return { error: "The file is larger than 4 MB. Split it or save a smaller PDF." };
  const skill = pick<Skill>(str(form.get("skill")), SKILLS, "reading");
  const level = pick<Level>(str(form.get("level")), LEVELS, "B1");
  const name = file.name.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());

  let part: Part;
  if (name.endsWith(".pdf") && bytes.subarray(0, 5).toString() === "%PDF-") {
    // Every PDF page is billed as input; keep worksheets short.
    const pages = (bytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    if (pages > MAX_PDF_PAGES) return { error: "The PDF is longer than 12 pages. Upload only the pages with the exercise." };
    part = { inlineData: { mimeType: "application/pdf", data: bytes.toString("base64") } };
  } else if (/\.(png|jpe?g|webp)$/.test(name) && ["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    part = { inlineData: { mimeType: file.type, data: bytes.toString("base64") } };
  } else if (name.endsWith(".docx")) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      if (!value.trim()) return { error: "That document has no text we can read." };
      part = { text: `WORKSHEET (from a Word document):\n\n${value.slice(0, MAX_TEXT_CHARS)}` };
    } catch { return { error: "That Word file could not be read. Save it again as .docx or PDF." }; }
  } else if (name.endsWith(".txt")) {
    const text = bytes.toString("utf8");
    if (!text.trim()) return { error: "That file is empty." };
    part = { text: `WORKSHEET (plain text):\n\n${text.slice(0, MAX_TEXT_CHARS)}` };
  } else {
    return { error: "Upload a PDF, Word (.docx), text file or a photo (PNG/JPG)." };
  }

  return withAi("extract", () => extractDraft({ file: part, skill, level }));
}

export type AudioResult = { path?: string; url?: string; error?: string };
const AUDIO_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp3$/;

/**
 * Speaks a listening script with Fish Audio and keeps the MP3 in the
 * centre's private folder. Returns the storage path (saved with the
 * assignment) and a short-lived link for the preview player. A previous
 * preview the mentor is replacing is removed if no assignment uses it.
 */
export async function generateAudio(script: string, previous?: string, cast?: Cast): Promise<AudioResult> {
  if (!fishConfigured()) return { error: "Audio is not configured yet. Add a Fish Audio key in the hosting settings." };
  const text = String(script ?? "").trim();
  if (text.length < 20) return { error: "Write the script first." };
  if (text.length > MAX_SCRIPT_CHARS) return { error: "The script is too long for one recording (8,000 characters at most)." };

  const { supabase, workspace } = await getStaffContext();
  const { data: id, error } = await supabase.rpc("claim_ai_request", { p_center: workspace.centerId, p_kind: "audio" });
  if (error || id == null) return { error: error && /AI limit/.test(error.message) ? error.message : "You don't have permission to do that." };

  try {
    const speech = await speakScript(text, cast && typeof cast === "object" ? cast : {});
    const path = `${workspace.centerId}/${crypto.randomUUID()}.mp3`;
    const { error: upErr } = await supabase.storage.from(AUDIO_BUCKET).upload(path, speech.audio, { contentType: "audio/mpeg", upsert: false });
    if (upErr) {
      console.error("Audio upload failed", upErr.message);
      throw new AiUnavailable("The audio could not be saved. Try again.");
    }
    // Fish Audio bills by UTF-8 bytes; they go in the prompt column.
    await supabase.rpc("finish_ai_request", { p_id: id, p_model: speech.model, p_prompt: speech.bytes, p_completion: 0, p_cost: 0, p_ok: true });
    if (previous && AUDIO_PATH.test(previous) && previous.startsWith(`${workspace.centerId}/`)) {
      await supabase.storage.from(AUDIO_BUCKET).remove([previous]);
    }
    return { path, url: (await audioUrl(supabase, path)) ?? undefined };
  } catch (e) {
    await supabase.rpc("finish_ai_request", { p_id: id, p_model: "", p_prompt: 0, p_completion: 0, p_cost: 0, p_ok: false });
    return { error: aiError(e) };
  }
}

/** Save an edited draft: questions go to the assignment, answers to the key. */
export async function saveDraft(draft: Draft, source: "upload" | "ai"): Promise<{ id?: string; error?: string }> {
  const { supabase, workspace } = await getStaffContext();
  if (!["upload", "ai"].includes(source)) return { error: "Unsupported source." };

  const questions = storedQuestions(draft.questions);
  const answers = storedAnswers(draft.questions);
  const groups = storedGroups(draft.groups, draft.questions);

  const { data, error } = await supabase.rpc("create_custom_assignment", {
    p_center: workspace.centerId,
    p_title: draft.title,
    p_skill: pick<Skill>(draft.skill, SKILLS, "reading"),
    p_level: pick<Level>(draft.level, LEVELS, "B1"),
    p_source: source,
    p_passage: draft.passage ?? "",
    p_questions: questions,
    p_answers: answers,
    p_groups: groups,
    // With generated audio, the passage is the transcript; the database keeps it with the key.
    ...(draft.skill === "listening" && draft.audio_path ? { p_audio_path: draft.audio_path } : {}),
  });
  if (error) return { error: /forbidden|permission/i.test(error.message) ? "You don't have permission to do that." : error.message };
  revalidatePath("/homework", "layout");
  return { id: data ?? undefined };
}
