/**
 * The spoken frame of a real IELTS Listening test, added around a section's
 * script so the recording sounds like the exam: the opening announcement,
 * time to read the questions before each set, the break in the middle of a
 * part, and the end-of-part check time. Shared by the AI drafting (server)
 * and the test editor (browser), so it is plain text in, plain text out.
 *
 * The script may mark the middle of a part with a line "[break]": the
 * second set of questions starts there. Lines in [brackets] are never read
 * out, so a leftover marker is harmless.
 */

export const NARRATOR = "Narrator";
const BREAK = /^\s*\[\s*break\s*\]\s*$/im;
/** Seconds to read the questions before each set, and to check at the end of a part. */
const READ = 30;
const CHECK = 30;

const WORDS = ["One", "Two", "Three", "Four"];
const KIND = [
  "a conversation",
  "a talk",
  "a discussion",
  "a lecture",
];

/** True when the script already carries the exam frame (so it is not added twice). */
export const hasFrame = (script: string) => /you (now )?have (some|half a minute|one minute|two minutes)/i.test(script) || /^\s*\[\s*pause\s+\d/im.test(script);

/**
 * Wraps a section script (part 0-3, questions first..last) in the exam's
 * instructions. A first line "Narrator: You will hear ..." from the writer
 * is kept as the description of the situation.
 */
export function frameListening(script: string, part: number, first: number, last: number): string {
  const lines = script.replace(/\r/g, "").trim().split("\n");
  let intro = `You will hear ${KIND[part] ?? "a recording"}.`;
  const head = /^\s*Narrator:\s*(.+)$/i.exec(lines[0] ?? "");
  if (head && /you will hear/i.test(head[1])) { intro = head[1].trim(); lines.shift(); }
  let body = lines.join("\n").trim();

  const word = WORDS[part] ?? String(part + 1);
  const breakAt = BREAK.exec(body);
  // Parts 1-3 have a break; part 4 is heard straight through. Without a marker, no break.
  const split = part < 3 && breakAt ? Math.min(last, first + Math.ceil((last - first + 1) / 2) - 1) : last;
  const sets = split < last ? `questions ${first} to ${split}` : `questions ${first} to ${last}`;

  const out: string[] = [];
  if (part === 0) out.push(`${NARRATOR}: This is an IELTS Listening test. There are four parts to the test. You will hear each part once only. As you listen, answer the questions.`);
  out.push(`${NARRATOR}: Part ${word}. ${intro} First, you have some time to look at ${sets}.`, `[pause ${READ}]`, `${NARRATOR}: Now listen carefully and answer ${sets}.`, "");

  if (split < last) {
    const rest = `questions ${split + 1} to ${last}`;
    body = body.replace(BREAK, ["", `${NARRATOR}: Before you hear the rest of the ${part === 1 ? "talk" : part === 2 ? "discussion" : "conversation"}, you have some time to look at ${rest}.`, `[pause ${READ}]`, `${NARRATOR}: Now listen and answer ${rest}.`, ""].join("\n"));
  }
  body = body.replace(new RegExp(BREAK.source, "gim"), "");
  out.push(body.trim(), "");

  if (part < 3) out.push(`${NARRATOR}: That is the end of Part ${word}. You now have half a minute to check your answers.`, `[pause ${CHECK}]`, `${NARRATOR}: Now turn to Part ${WORDS[part + 1]}.`);
  else out.push(`${NARRATOR}: That is the end of Part ${word}, and the end of the Listening test. You now have two minutes to check your answers.`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
