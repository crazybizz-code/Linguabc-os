/**
 * Converting between the editor's questions (answers inline) and the stored
 * shape (questions for students, answers in a separate key). Shared by the
 * homework and library-test editors; no server-only imports.
 */
import type { AnswerKey, Question, QuestionGroup } from "@/lib/questions";
import { emptyQuestion, type DraftGroup, type DraftQuestion } from "./draft";

/** Questions as stored (no answers), numbered from `from`. */
export function storedQuestions(qs: DraftQuestion[], from = 1, groupId: (id?: string) => string | undefined = (id) => id) {
  return qs.map((q, i) => ({
    id: `q${from + i}`,
    type: q.type,
    prompt: q.prompt.trim(),
    ...(q.type === "mc" || q.type === "multi" ? { options: q.options.map((o) => o.trim()).filter(Boolean) } : {}),
    ...(q.type === "matching" || q.type === "headings" ? { group: groupId(q.group) } : {}),
    ...(q.type === "gap" ? { max_words: q.max_words } : {}),
  }));
}

/** The answer key for the same numbering. */
export function storedAnswers(qs: DraftQuestion[], from = 1): AnswerKey {
  return Object.fromEntries(qs.map((q, i) => {
    const id = `q${from + i}`;
    const explanation = q.explanation.trim() || null;
    if (q.type === "multi") return [id, { answer: q.answers, explanation }];
    if (q.type === "tfng" || q.type === "ynng") return [id, { answer: q.choice, explanation }];
    if (q.type === "gap") return [id, { accepted: q.accepted.map((a) => a.trim()).filter(Boolean), explanation }];
    if (q.type === "open") return [id, { explanation }];
    return [id, { answer: q.answer, explanation }];
  }));
}

/** Groups some question uses, trimmed, renamed with `groupId`. */
export function storedGroups(groups: DraftGroup[], qs: DraftQuestion[], groupId: (id: string) => string = (id) => id): QuestionGroup[] {
  const used = new Set(qs.map((q) => q.group).filter(Boolean));
  return groups.filter((g) => used.has(g.id))
    .map((g) => ({ id: groupId(g.id), instructions: g.instructions.trim(), options: g.options.map((o) => o.trim()).filter(Boolean) }));
}

/** Back from stored question + key to the editor shape. */
export function toDraftQuestion(q: Question, key: AnswerKey[string] | undefined): DraftQuestion {
  const type = q.type as DraftQuestion["type"];
  const d = { ...emptyQuestion(q.id, type), prompt: q.prompt, options: q.options ?? [], group: q.group, explanation: key?.explanation ?? "" };
  const a = key?.answer;
  if (type === "multi") d.answers = Array.isArray(a) ? a : [];
  else if (type === "tfng" || type === "ynng") d.choice = typeof a === "string" ? a : "";
  else if (type === "gap") { d.accepted = key?.accepted?.length ? key.accepted : [""]; d.max_words = q.max_words ?? 3; }
  else if (type !== "open") d.answer = typeof a === "number" ? a : null;
  return d;
}
