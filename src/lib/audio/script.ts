/**
 * Listening scripts: plain text, one speaker turn per line, written as
 * "Name: what they say". Lines without a name continue the previous turn
 * (or are read by a narrator). Shared by the editor and the generator.
 */
export type Turn = { speaker: string | null; text: string };

export const SCRIPT_MIN = 20;
export const SCRIPT_MAX = 6000;
/** Longest text sent to the voice service in one request. */
const PIECE_MAX = 1200;

const SPEAKER = /^\s*([A-Za-z][A-Za-z .'’-]{0,29}?)\s*:\s+(\S.*)$/;

export function parseScript(script: string): Turn[] {
  const turns: Turn[] = [];
  for (const raw of script.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = SPEAKER.exec(line);
    const speaker = m ? m[1].trim() : null;
    const text = (m ? m[2] : line).trim();
    const last = turns[turns.length - 1];
    if (last && (speaker === null || speaker.toLowerCase() === last.speaker?.toLowerCase())) last.text += ` ${text}`;
    else turns.push({ speaker, text });
  }
  return turns.flatMap((t) => split(t.text).map((text) => ({ speaker: t.speaker, text })));
}

/** Keeps each request short, breaking at sentence ends. */
function split(text: string): string[] {
  if (text.length <= PIECE_MAX) return [text];
  const out: string[] = [];
  let cur = "";
  for (const s of text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text]) {
    if (cur && cur.length + s.length > PIECE_MAX) { out.push(cur.trim()); cur = ""; }
    cur += s;
    while (cur.length > PIECE_MAX) { out.push(cur.slice(0, PIECE_MAX).trim()); cur = cur.slice(PIECE_MAX); }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Speakers in order of first appearance (the narrator is not one). */
export function speakersOf(turns: Turn[]): string[] {
  const seen = new Map<string, string>();
  for (const t of turns) if (t.speaker && !seen.has(t.speaker.toLowerCase())) seen.set(t.speaker.toLowerCase(), t.speaker);
  return [...seen.values()];
}

export const wordCount = (turns: Turn[]) => turns.reduce((n, t) => n + t.text.split(/\s+/).filter(Boolean).length, 0);
