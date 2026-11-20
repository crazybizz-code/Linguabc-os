import "server-only";
import { generateJson, type Usage } from "./gemini";
import { normalize, SCHEMA, SYSTEM, type Raw } from "./assignment-draft";
import type { Level } from "./draft";
import { FORMATS, PODCAST_TYPES, type PodcastDraft, type VocabWord } from "./podcast";

/**
 * LinguABC's own library podcasts: an original episode at one CEFR level,
 * written as a script for Fish Audio, with comprehension questions and key
 * vocabulary. The admin edits, records and publishes it.
 */


/** Length, pace and language for each level. */
const LEVEL_SPEC: Record<Level, { words: string; questions: number; language: string }> = {
  A1: { words: "180-260", questions: 5, language: "very short, simple sentences; present simple and can; the 500 most common words; speakers repeat key words and speak slowly" },
  A2: { words: "280-400", questions: 6, language: "short sentences; past simple and going to; everyday words; some repetition" },
  B1: { words: "420-600", questions: 7, language: "connected sentences; common tenses and modal verbs; a few less common words explained in context" },
  B2: { words: "620-850", questions: 8, language: "natural speech with opinions and reasons; idioms only when clear from context" },
  C1: { words: "850-1100", questions: 8, language: "fluent, idiomatic speech; abstract ideas, hedging and implied meaning" },
  C2: { words: "1000-1300", questions: 8, language: "sophisticated, fast, natural speech; nuance, irony and dense argument" },
};

const PODCAST_SCHEMA = {
  type: "object",
  properties: {
    ...SCHEMA.properties,
    description: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    vocabulary: {
      type: "array",
      items: {
        type: "object",
        properties: { word: { type: "string" }, pos: { type: "string" }, definition: { type: "string" }, example: { type: "string" } },
        required: ["word", "definition"],
      },
    },
  },
  required: ["title", "passage", "questions", "vocabulary"],
};

const RULES = `This is an episode of "The LinguABC English Podcast" for learners of English in Uzbekistan and elsewhere.
- "passage" is the script to be recorded: one line per turn as "Name: words", first names only (e.g. "Kate:", "Daniel:"). No stage directions, sound effects or music cues.
- Make it lively, not flat: put an expression tag in square brackets before a sentence where the feeling changes, about one turn in three, e.g. "Kate: [surprised] Wait, really? [laughing] That's amazing!" Use only: excited, surprised, happy, amused, laughing, chuckling, curious, enthusiastic, relieved, sad, disappointed, worried, nervous, confused, hesitant, thoughtful, doubtful, apologetic, sympathetic, sarcastic, serious, calm, sighing, whispering. Match the level: simple, clear feelings for A1-A2, subtler ones for C1-C2.
- The host opens by naming the show and the topic and closes with a short goodbye.
- Original content only; nothing copied from real podcasts or broadcasters. Everyday, study, work, travel, culture, science and nature topics; nothing political, religious, sexual or harmful.
- Write exactly at the requested CEFR level: vocabulary, grammar and ideas must suit it.
- Questions: only types mc, multi, tfng and gap; in the order the information is heard; every answer must be clearly heard in the script.
- "description": one sentence for the library card. "topics": 1-3 lowercase topic words. "vocabulary": 5-8 useful words or phrases from the script, each with part of speech, a simple definition and a new example sentence.`;

export async function generatePodcast(input: { level: Level; topic: string; format: string }): Promise<{ draft: PodcastDraft; usage: Usage }> {
  const spec = LEVEL_SPEC[input.level];
  const prompt = [
    `CEFR level: ${input.level}. Language: ${spec.language}.`,
    `Format: ${input.format || FORMATS[0]}.`,
    input.topic ? `Topic: ${input.topic}.` : "Choose an interesting everyday topic.",
    `Write a ${spec.words}-word script and exactly ${spec.questions} questions on it.`,
  ].join("\n");
  const { data, usage } = await generateJson<Raw & { description?: string; topics?: string[]; vocabulary?: Partial<VocabWord>[] }>(
    [{ text: prompt }], PODCAST_SCHEMA,
    { system: `${SYSTEM}\n${RULES}`, temperature: 0.9, maxOutput: 3000 + spec.questions * 150, reasoningBudget: 1536 },
  );
  const d = normalize(data, "listening", input.level);
  const allowed = new Set<string>(PODCAST_TYPES);
  const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  return {
    draft: {
      title: d.title,
      description: s(data.description, 300),
      topics: (data.topics ?? []).map((x) => s(x, 40).toLowerCase()).filter(Boolean).slice(0, 3),
      script: d.passage,
      questions: d.questions.filter((q) => allowed.has(q.type)),
      vocabulary: (data.vocabulary ?? []).map((v) => ({ word: s(v.word, 60), pos: s(v.pos, 30), definition: s(v.definition, 300), example: s(v.example, 300) }))
        .filter((v) => v.word && v.definition).slice(0, 10),
    },
    usage,
  };
}
