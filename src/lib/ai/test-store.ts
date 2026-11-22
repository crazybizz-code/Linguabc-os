/**
 * A library test as edited (sections with answers inline) → as stored:
 * questions numbered q1.. across sections, group ids made unique per
 * section ("s2-g1"), answers in one key, listening scripts as transcripts.
 */
import type { AnswerKey } from "@/lib/questions";
import type { Level } from "./draft";
import { storedAnswers, storedGroups, storedQuestions } from "./draft-store";
import type { DraftGroup, DraftQuestion } from "./draft";

export type TestSkill = "reading" | "listening";
/** `id` is the stored section id (s1..s4), stable for the slot; new drafts take s<n>. */
export type SectionDraft = { id?: string; title: string; passage: string; audio_path?: string; groups: DraftGroup[]; questions: DraftQuestion[] };
export type TestDraft = { title: string; skill: TestSkill; level: Level; sections: SectionDraft[] };

export function testToStored(t: TestDraft) {
  const listening = t.skill === "listening";
  let from = 1;
  const answers: AnswerKey = {};
  const transcripts: Record<string, string> = {};
  const sections = t.sections.map((s, i) => {
    const id = `s${i + 1}`;
    const gid = (g?: string) => (g ? `${id}-${g.replace(/^s\d+-/, "")}` : undefined);
    const questions = storedQuestions(s.questions, from, gid);
    Object.assign(answers, storedAnswers(s.questions, from));
    from += s.questions.length;
    if (listening && s.passage.trim()) transcripts[id] = s.passage.trim();
    return {
      id,
      title: s.title.trim() || `${listening ? "Part" : "Passage"} ${i + 1}`,
      ...(listening ? (s.audio_path ? { audio_path: s.audio_path } : {}) : { passage: s.passage.trim() }),
      groups: storedGroups(s.groups, s.questions, (g) => gid(g)!),
      questions,
    };
  });
  return { sections, answers, transcripts };
}
