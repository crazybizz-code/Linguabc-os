"use server";

import mammoth from "mammoth";
import { revalidatePath } from "next/cache";
import { getStaffContext } from "@/lib/auth/current";
import { aiConfigured, AiUnavailable, type Part } from "@/lib/ai/gemini";
import { extractDraft, generateDraft, LEVELS, SKILLS, type Draft, type Level, type Skill } from "@/lib/ai/assignment-draft";

export type DraftResult = { draft?: Draft; error?: string };
const MAX_FILE = 4 * 1024 * 1024;
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const pick = <T extends string>(v: string, list: readonly T[], fallback: T): T => ((list as readonly string[]).includes(v) ? (v as T) : fallback);

async function claim(kind: "generate" | "extract") {
  if (!aiConfigured()) return "AI is not configured yet. Add GEMINI_API_KEY in the hosting settings.";
  const { supabase, workspace } = await getStaffContext();
  const { error } = await supabase.rpc("claim_ai_request", { p_center: workspace.centerId, p_kind: kind });
  if (error) return /AI limit/.test(error.message) ? error.message : "You don't have permission to do that.";
  return null;
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
  const denied = await claim("generate");
  if (denied) return { error: denied };
  try { return { draft: await generateDraft({ skill, level, focus, topic, count }) }; } catch (e) { return { error: aiError(e) }; }
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
    part = { inlineData: { mimeType: "application/pdf", data: bytes.toString("base64") } };
  } else if (/\.(png|jpe?g|webp)$/.test(name) && ["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    part = { inlineData: { mimeType: file.type, data: bytes.toString("base64") } };
  } else if (name.endsWith(".docx")) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      if (!value.trim()) return { error: "That document has no text we can read." };
      part = { text: `WORKSHEET (from a Word document):\n\n${value.slice(0, 60000)}` };
    } catch { return { error: "That Word file could not be read. Save it again as .docx or PDF." }; }
  } else if (name.endsWith(".txt")) {
    const text = bytes.toString("utf8");
    if (!text.trim()) return { error: "That file is empty." };
    part = { text: `WORKSHEET (plain text):\n\n${text.slice(0, 60000)}` };
  } else {
    return { error: "Upload a PDF, Word (.docx), text file or a photo (PNG/JPG)." };
  }

  const denied = await claim("extract");
  if (denied) return { error: denied };
  try { return { draft: await extractDraft({ file: part, skill, level }) }; } catch (e) { return { error: aiError(e) }; }
}

/** Save an edited draft as one of the centre's assignments. */
export async function saveDraft(draft: Draft, source: "upload" | "ai"): Promise<{ id?: string; error?: string }> {
  const { supabase, workspace } = await getStaffContext();
  if (!["upload", "ai"].includes(source)) return { error: "Unsupported source." };
  const questions = draft.questions.map((q, i) => ({
    id: `q${i + 1}`, type: q.type, prompt: q.prompt.trim(), ...(q.type === "mc" ? { options: q.options.map((o) => o.trim()) } : {}),
  }));
  const answers = Object.fromEntries(draft.questions.map((q, i) => [`q${i + 1}`,
    q.type === "mc" ? { answer: q.answer, explanation: q.explanation?.trim() || null } : { explanation: q.explanation?.trim() || null }]));
  const { data, error } = await supabase.rpc("create_custom_assignment", {
    p_center: workspace.centerId, p_title: draft.title, p_skill: pick<Skill>(draft.skill, SKILLS, "reading"),
    p_level: pick<Level>(draft.level, LEVELS, "B1"), p_source: source, p_passage: draft.passage ?? "", p_questions: questions, p_answers: answers,
  });
  if (error) return { error: /forbidden|permission/i.test(error.message) ? "You don't have permission to do that." : error.message };
  revalidatePath("/homework", "layout");
  return { id: data ?? undefined };
}
