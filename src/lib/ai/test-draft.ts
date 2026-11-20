import "server-only";
import { generateJson, type Usage } from "./gemini";
import { normalize, SCHEMA, SYSTEM, type Raw } from "./assignment-draft";
import type { Level } from "./draft";
import type { SectionDraft, TestSkill } from "./test-store";

export type { SectionDraft, TestSkill };

/**
 * One section of a full IELTS Academic test, drafted by the AI in the
 * official shape. A full test is 40 questions:
 *   listening: 4 parts x 10;  reading: passages of 13, 13 and 14.
 */

type Spec = { title: string; count: number; words: string; brief: string; types: string };

export const SPECS: Record<TestSkill, Spec[]> = {
  listening: [
    { title: "Part 1", count: 10, words: "550-650",
      brief: "A conversation between two people in an everyday social context (e.g. booking, enquiry, registration). One person gives the other details: names to spell, numbers, dates, prices, addresses.",
      types: "mostly gap (form or note completion, max_words 2, answers are words or numbers heard in the conversation, spelled exactly); 2-3 mc allowed" },
    { title: "Part 2", count: 10, words: "600-700",
      brief: "A monologue in an everyday social context (e.g. a guide describing a facility, a radio talk about a local event).",
      types: "a mix of mc and matching (with one group of 5-8 options), optionally a few gap" },
    { title: "Part 3", count: 10, words: "650-750",
      brief: "A conversation between two to four people in an educational or training context (e.g. students and a tutor discussing an assignment).",
      types: "a mix of mc, multi (choose TWO) and matching; opinions and reasons, not just facts" },
    { title: "Part 4", count: 10, words: "700-800",
      brief: "A monologue on an academic subject (e.g. a university lecture), one speaker only.",
      types: "gap only (note or summary completion, max_words 1)" },
  ],
  reading: [
    { title: "Passage 1", count: 13, words: "750-850",
      brief: "A factual text on a general-interest topic (history of an invention, natural science, a place). Easiest of the three passages. Paragraphs labelled A, B, C...",
      types: "about half tfng, the rest gap (note or sentence completion from the text, max_words 2)" },
    { title: "Passage 2", count: 13, words: "850-950",
      brief: "A discursive text (e.g. research in a workplace, an industry, a social trend). Paragraphs labelled A, B, C...",
      types: "headings for each paragraph (one group: list of headings with 2-3 extra), then mc and gap" },
    { title: "Passage 3", count: 14, words: "900-1000",
      brief: "The hardest passage: an argumentative or academic text with the writer's views and claims.",
      types: "ynng (writer's views), mc, and a summary completion as matching with a group of word options" },
  ],
};

const PART_RULES = `This is one section of a full IELTS Academic test, not homework. Write it as the real exam does:
- Original content only; never copy published tests.
- Difficulty rises through the test: Part 1 / Passage 1 is the easiest, Part 4 / Passage 3 the hardest (denser language, abstract ideas, more paraphrase). Within this section, start with easier questions and end with harder ones.
- Questions follow the order of the information in the text.
- Each question is answerable from the text alone; distractors are plausible.
- Listening: "passage" is the script to be recorded, one line per turn as "Name: words"; spell out anything a speaker spells ("That's S-M-I-T-H"). No stage directions except [short pause].`;

export async function generateSection(input: { skill: TestSkill; part: number; level: Level; topic: string }): Promise<{ section: SectionDraft; usage: Usage }> {
  const spec = SPECS[input.skill][input.part];
  if (!spec) throw new Error("unknown part");
  const prompt = [
    `IELTS Academic ${input.skill}, ${spec.title}. Target level: ${input.level} (questions range from easier to harder).`,
    spec.brief,
    input.topic && `Topic: ${input.topic}.`,
    `Write a ${spec.words}-word ${input.skill === "listening" ? "script" : "passage"} and exactly ${spec.count} questions.`,
    `Question types: ${spec.types}.`,
    `Title: a short name for the topic.`,
  ].filter(Boolean).join("\n");
  const maxOutput = 1600 + spec.count * 170;
  const { data, usage } = await generateJson<Raw>([{ text: prompt }], SCHEMA, {
    system: `${SYSTEM}\n${PART_RULES}`, temperature: 0.8, maxOutput, reasoningBudget: 2048,
  });
  const draft = normalize(data, input.skill, input.level);
  return { section: { title: draft.title, passage: draft.passage, groups: draft.groups, questions: draft.questions }, usage };
}
