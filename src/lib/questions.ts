/**
 * Shared shapes for IELTS-style question sets.
 *
 * Marking happens in the database against a key students never receive, so
 * nothing here decides whether an answer is right — these are display types
 * and the small helpers both the student and staff views need.
 */
export const QUESTION_TYPES = ["mc", "multi", "tfng", "ynng", "gap", "matching", "headings", "open"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type Question = {
  id: string;
  type: QuestionType | string;
  prompt: string;
  options?: string[];
  /** Matching and headings take their options from this group. */
  group?: string;
  /** Gap-fill word limit (default 3). */
  max_words?: number;
  /** How many options a "multi" question asks for. Never the answers. */
  select?: number;
};

export type QuestionGroup = { id: string; instructions?: string; options?: string[] };

export type Content = {
  passage?: string | null;
  audio_url?: string | null;
  groups?: QuestionGroup[];
  questions?: Question[];
};

/** One student answer: option index, several indices, or written text. */
export type AnswerValue = number | number[] | string;
export type Answers = Record<string, AnswerValue>;

export type KeyEntry = { answer?: number | number[] | string; accepted?: string[]; explanation?: string | null };
export type AnswerKey = Record<string, KeyEntry>;

/** What the database awarded per question: {earned, total}. */
export type Marks = Record<string, { earned: number; total: number }>;

export const TFNG = ["true", "false", "not_given"] as const;
export const YNNG = ["yes", "no", "not_given"] as const;
export const CHOICE_LABEL: Record<string, string> = {
  true: "TRUE", false: "FALSE", yes: "YES", no: "NO", not_given: "NOT GIVEN",
};

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv"];

/** Drops a marker the writer already put in front of an option, so it isn't shown twice. */
export function optionText(text: string) {
  return text.replace(/^\s*(?:[A-Z]|[ivx]{1,4}|\d{1,2})\s*[.)]?\s+/, "").trim() || text.trim();
}

/** Headings are listed with roman numerals, everything else with letters. */
export function optionLabel(index: number, type?: string) {
  return type === "headings" ? (ROMAN[index] ?? String(index + 1)) : String.fromCharCode(65 + index);
}

export function wordLimit(q: Question) {
  const n = q.max_words ?? 3;
  return n === 1 ? "ONE WORD" : n === 2 ? "TWO WORDS" : n === 3 ? "THREE WORDS" : `${n} WORDS`;
}

/** How many options a "choose TWO" question asks for. */
export function selectCount(q: Question) {
  return Math.max(2, q.select ?? 2);
}

export function content(raw: unknown): Content {
  return (raw ?? {}) as Content;
}

export function questionsOf(raw: unknown): Question[] {
  return content(raw).questions ?? [];
}

export function groupOf(groups: QuestionGroup[] | undefined, id: string | undefined) {
  return id ? groups?.find((g) => g.id === id) : undefined;
}

/** Options a question draws on: its own, or its group's for matching types. */
export function optionsFor(q: Question, groups?: QuestionGroup[]) {
  return q.options ?? groupOf(groups, q.group)?.options ?? [];
}

/** Fixed choices for the types that have them, so one renderer covers all. */
export function choicesFor(q: Question, groups?: QuestionGroup[]): string[] {
  if (q.type === "tfng") return TFNG.map((c) => CHOICE_LABEL[c]);
  if (q.type === "ynng") return YNNG.map((c) => CHOICE_LABEL[c]);
  return optionsFor(q, groups);
}

/** The value stored for choice `i` of a question: text for TF/YN, index otherwise. */
export function choiceValue(q: Question, i: number): AnswerValue {
  if (q.type === "tfng") return TFNG[i];
  if (q.type === "ynng") return YNNG[i];
  return i;
}

export function isChosen(q: Question, i: number, answer: AnswerValue | undefined) {
  if (answer == null) return false;
  if (q.type === "multi") return Array.isArray(answer) && answer.includes(i);
  return answer === choiceValue(q, i);
}

export function isAnswered(q: Question, answer: AnswerValue | undefined) {
  if (answer == null) return false;
  if (Array.isArray(answer)) return answer.length > 0;
  if (typeof answer === "string") return answer.trim() !== "";
  return true;
}

/** How the key reads in plain words, for the staff view. */
export function correctText(q: Question, key: KeyEntry | undefined, groups?: QuestionGroup[]): string {
  if (!key) return "—";
  if (q.type === "gap") return (key.accepted ?? []).join(" / ") || "—";
  if (q.type === "open") return "—";
  const opts = choicesFor(q, groups);
  if (q.type === "multi" && Array.isArray(key.answer)) {
    return key.answer.map((i) => `${optionLabel(i, q.type)}. ${optionText(opts[i] ?? "")}`).join(" · ");
  }
  if (q.type === "tfng" || q.type === "ynng") return CHOICE_LABEL[String(key.answer)] ?? String(key.answer ?? "—");
  const i = typeof key.answer === "number" ? key.answer : -1;
  return i >= 0 ? `${optionLabel(i, q.type)}. ${optionText(opts[i] ?? "")}` : "—";
}

/** The student's answer in plain words, for the mentor's review. */
export function answerText(q: Question, answer: AnswerValue | undefined, groups?: QuestionGroup[]): string | null {
  if (!isAnswered(q, answer)) return null;
  const opts = choicesFor(q, groups);
  if (Array.isArray(answer)) return answer.map((i) => `${optionLabel(i, q.type)}. ${optionText(opts[i] ?? "")}`).join(" · ");
  if (typeof answer === "number") return `${optionLabel(answer, q.type)}. ${optionText(opts[answer] ?? "")}`;
  if (typeof answer === "string") {
    return q.type === "tfng" || q.type === "ynng" ? CHOICE_LABEL[answer] ?? answer : answer;
  }
  return null;
}

/** Splits a gap prompt around its blank so the input can sit inline. */
export function splitGap(prompt: string): [string, string] | null {
  const m = prompt.match(/_{3,}/);
  if (!m || m.index === undefined) return null;
  return [prompt.slice(0, m.index), prompt.slice(m.index + m[0].length)];
}

/** Groups questions in order, starting a new block whenever the group changes. */
export function blocksOf(questions: Question[], groups?: QuestionGroup[]) {
  const blocks: { group?: QuestionGroup; type: string; items: { q: Question; n: number }[] }[] = [];
  questions.forEach((q, i) => {
    const last = blocks[blocks.length - 1];
    const g = groupOf(groups, q.group);
    if (last && last.group?.id === g?.id && (g || last.type === q.type)) last.items.push({ q, n: i + 1 });
    else blocks.push({ group: g, type: q.type, items: [{ q, n: i + 1 }] });
  });
  return blocks;
}
