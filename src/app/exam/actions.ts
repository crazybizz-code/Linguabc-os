"use server";

import { getPortalContext } from "@/lib/portal/context";
import { audioUrl, LIBRARY_AUDIO } from "@/lib/audio";
import type { Answers, Question, QuestionGroup } from "@/lib/questions";

export type ExamSection = { id: string; title: string; passage?: string; audio?: string; groups: QuestionGroup[]; questions: Question[] };
export type ExamStart = {
  attemptId: string; skill: "reading" | "listening"; startedAt: string; deadlineAt: string; serverNow: string;
  answers: Answers; title: string; sections: ExamSection[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const friendly = (m: string) => (/forbidden|permission/i.test(m) ? "You can't take this test." : m);

/** Starts (or resumes) the student's attempt; the server sets the deadline. */
export async function startExam(sessionId: string, skill: string): Promise<{ exam?: ExamStart; error?: string }> {
  if (!UUID.test(sessionId) || (skill !== "reading" && skill !== "listening")) return { error: "Test not found." };
  const { supabase } = await getPortalContext("student");
  const { data, error } = await supabase.rpc("start_mock_module", { p_session: sessionId, p_skill: skill });
  if (error || !data) return { error: friendly(error?.message ?? "Could not start the test.") };
  const d = data as {
    attempt_id: string; skill: "reading" | "listening"; started_at: string; deadline_at: string; server_now: string; answers: Answers;
    test: { title: string; sections: { id: string; title?: string; passage?: string; audio_path?: string; groups?: QuestionGroup[]; questions?: Question[] }[] };
  };
  // Recordings are signed for this student only while the attempt is open.
  const sections = await Promise.all((d.test.sections ?? []).map(async (s) => ({
    id: s.id, title: s.title ?? "", passage: s.passage, groups: s.groups ?? [], questions: s.questions ?? [],
    audio: s.audio_path ? (await audioUrl(supabase, s.audio_path, LIBRARY_AUDIO)) ?? undefined : undefined,
  })));
  return {
    exam: {
      attemptId: d.attempt_id, skill: d.skill, startedAt: d.started_at, deadlineAt: d.deadline_at, serverNow: d.server_now,
      answers: d.answers ?? {}, title: d.test.title, sections,
    },
  };
}

export async function saveExam(attemptId: string, answers: Answers): Promise<{ error?: string }> {
  if (!UUID.test(attemptId)) return { error: "Test not found." };
  const { supabase } = await getPortalContext("student");
  const { error } = await supabase.rpc("save_mock_answers", { p_attempt: attemptId, p_answers: answers });
  return error ? { error: friendly(error.message) } : {};
}

export async function submitExam(attemptId: string, answers: Answers): Promise<{ error?: string }> {
  if (!UUID.test(attemptId)) return { error: "Test not found." };
  const { supabase } = await getPortalContext("student");
  const { error } = await supabase.rpc("submit_mock_module", { p_attempt: attemptId, p_answers: answers });
  return error ? { error: friendly(error.message) } : {};
}

export async function reportFocus(attemptId: string): Promise<void> {
  if (!UUID.test(attemptId)) return;
  const { supabase } = await getPortalContext("student");
  await supabase.rpc("report_mock_focus", { p_attempt: attemptId });
}
