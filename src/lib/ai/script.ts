/**
 * Listening scripts, shared by the editor (browser) and the voice code
 * (server). A line "Name: words" starts a turn; other lines continue the
 * current speaker; "[stage directions]" are not read out. A line that is
 * only "[pause 30]" (or "[pause 30s]") becomes that many seconds of silence,
 * as in the real exam when students read the questions; "[short pause]"
 * inside a line is a one-second break in the speech.
 */
export type Segment = { speaker: string | null; text: string; pause?: number };
export type Voice = { id: string; label: string };
/** Longest script one recording takes (an exam part with its instructions fits). */
export const MAX_SCRIPT_CHARS = 12000;
/** Which voice reads each speaker. The key "" is the narrator (lines with no name). */
export type Cast = Record<string, string>;

const LABEL = /^\s*([A-Z][A-Za-z0-9 .'-]{0,30}|[A-Z]):\s+(.+)$/;
const SHORT_PAUSE = /\s*\[\s*short pause\s*\]\s*/i;
const PAUSE = /^\[\s*pause\s+(\d{1,3})\s*s?\s*\]$/i;
/** Longest silence one pause line may ask for. */
export const MAX_PAUSE = 120;

/** Splits a script into spoken segments, merging consecutive lines of one speaker. */
export function splitScript(script: string): Segment[] {
  const out: Segment[] = [];
  let current: string | null = null;
  for (const raw of script.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const p = PAUSE.exec(line);
    if (p) {
      const seconds = Math.min(Number(p[1]), MAX_PAUSE);
      if (seconds > 0) out.push({ speaker: null, text: "", pause: seconds });
      continue;
    }
    const m = LABEL.exec(line);
    const speaker: string | null = m ? m[1].trim() : current;
    current = speaker;
    (m ? m[2] : line).split(SHORT_PAUSE).forEach((chunk, i) => {
      if (i > 0) out.push({ speaker: null, text: "", pause: 1 });
      const spoken = chunk.replace(/\[[^\]]*\]/g, "").trim();
      if (!spoken) return;
      const last = out[out.length - 1];
      if (last && !last.pause && last.speaker === speaker) last.text += `\n${spoken}`;
      else out.push({ speaker, text: spoken });
    });
  }
  return out;
}

/**
 * Words voices tend to misread, and how to spell them so they are said
 * right. Only the audio uses this; the transcript keeps the real spelling.
 */
const SAY: [RegExp, string][] = [
  [/\bIELTS\b/g, "eye-elts"],
];
export const speakable = (text: string) => SAY.reduce((s, [re, say]) => s.replace(re, say), text);

/**
 * The natural break before a turn, in seconds: longer around the narrator's
 * instructions than between two people talking, and never quite the same.
 */
export function turnGap(prev: string | null, next: string | null, i: number): number {
  const narrator = (s: string | null) => !s || /^narrator$/i.test(s);
  // Short, like real conversation; a long fixed gap sounds staged.
  const base = narrator(prev) || narrator(next) ? 0.6 : 0.3;
  return base + (((i * 7919) % 13) / 13) * 0.1;
}

/** Speakers in the order they first talk ("" for unnamed narration). */
export const speakersOf = (script: string) => [...new Set(splitScript(script).filter((s) => !s.pause).map((s) => s.speaker ?? ""))];

/** Keeps each valid choice; other speakers get the first voices nobody else has. */
export function defaultCast(speakers: string[], voices: Voice[], chosen: Cast = {}): Cast {
  const ids = new Set(voices.map((v) => v.id));
  const cast: Cast = {};
  for (const s of speakers) if (ids.has(chosen[s])) cast[s] = chosen[s];
  const taken = new Set(Object.values(cast));
  const free = voices.map((v) => v.id).filter((id) => !taken.has(id));
  let n = 0;
  for (const s of speakers) if (!cast[s]) cast[s] = free[n++] ?? voices[n % Math.max(voices.length, 1)]?.id ?? "";
  return cast;
}
