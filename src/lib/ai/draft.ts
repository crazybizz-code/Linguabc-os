/**
 * Draft shapes shared by the editor (browser) and the AI code (server).
 * No server-only imports here, so client components can use them.
 */
import type { QuestionType } from "@/lib/questions";

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const SKILLS = ["reading", "listening", "writing", "speaking", "vocabulary", "grammar"] as const;
export type Level = (typeof LEVELS)[number];
export type Skill = (typeof SKILLS)[number];

/** One question as the mentor edits it, before it is saved and the key split off. */
export type DraftQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  /** mc and multi carry their own options; matching and headings use the group's. */
  options: string[];
  /** mc, matching, headings: index of the correct option. */
  answer: number | null;
  /** multi: indices of the correct options. */
  answers: number[];
  /** tfng, ynng: the correct choice. */
  choice: string;
  /** gap: answers a marker would accept. */
  accepted: string[];
  max_words: number;
  group?: string;
  explanation: string;
};

export type DraftGroup = { id: string; instructions: string; options: string[] };
export type Draft = {
  title: string;
  skill: Skill;
  level: Level;
  passage: string;
  groups: DraftGroup[];
  questions: DraftQuestion[];
};

export function emptyQuestion(id: string, type: QuestionType = "mc"): DraftQuestion {
  return {
    id, type, prompt: "", options: type === "mc" || type === "multi" ? ["", "", "", ""] : [],
    answer: null, answers: [], choice: "", accepted: [""], max_words: 2, explanation: "",
  };
}

