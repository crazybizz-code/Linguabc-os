/**
 * LinguABC podcast shapes shared by the editor (browser) and the AI and
 * save code (server). No server-only imports.
 */
import { splitScript } from "./script";
import type { DraftQuestion } from "./draft";

export const PODCAST_TYPES = ["mc", "multi", "tfng", "gap"] as const;
export type VocabWord = { word: string; pos: string; definition: string; example: string };
export type PodcastDraft = {
  title: string; description: string; topics: string[]; script: string;
  questions: DraftQuestion[]; vocabulary: VocabWord[];
};

export const FORMATS = [
  "a host interviewing a guest",
  "two friends chatting",
  "one host presenting a short show",
  "a host with two guests discussing",
  "a short story told by a narrator",
] as const;

/** The script as the library stores a transcript: one entry per turn. */
export const scriptToTranscript = (script: string) =>
  splitScript(script).filter((s) => !s.pause).map((s) => ({ ...(s.speaker ? { speaker: s.speaker } : {}), text: s.text.replace(/\n/g, " ") }));

/** Back from a stored transcript to an editable script. */
export const transcriptToScript = (lines: { speaker?: string; text?: string }[]) =>
  lines.map((l) => (l.speaker ? `${l.speaker}: ${l.text ?? ""}` : l.text ?? "")).join("\n");
