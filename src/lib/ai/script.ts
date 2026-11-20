/**
 * Listening scripts, shared by the editor (browser) and the voice code
 * (server). A line "Name: words" starts a turn; other lines continue the
 * current speaker; "[stage directions]" are not read out.
 */
export type Segment = { speaker: string | null; text: string };
export type Voice = { id: string; label: string };
/** Which voice reads each speaker. The key "" is the narrator (lines with no name). */
export type Cast = Record<string, string>;

const LABEL = /^\s*([A-Z][A-Za-z0-9 .'-]{0,30}|[A-Z]):\s+(.+)$/;

/** Splits a script into spoken segments, merging consecutive lines of one speaker. */
export function splitScript(script: string): Segment[] {
  const out: Segment[] = [];
  let current: string | null = null;
  for (const raw of script.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = LABEL.exec(line);
    const speaker: string | null = m ? m[1].trim() : current;
    const spoken = (m ? m[2] : line).replace(/\[[^\]]*\]/g, "").trim();
    current = speaker;
    if (!spoken) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text += `\n${spoken}`;
    else out.push({ speaker, text: spoken });
  }
  return out;
}

/** Speakers in the order they first talk ("" for unnamed narration). */
export const speakersOf = (script: string) => [...new Set(splitScript(script).map((s) => s.speaker ?? ""))];

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
