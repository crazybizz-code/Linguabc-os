// Regression tests for the script rules every provider shares
// (src/lib/ai/script.ts, src/lib/ai/listening-frame.ts). Run: npm run test:ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPRESSIONS, planScript, readableScript, speakable, splitScript } from "../../src/lib/ai/script.ts";
import { frameListening } from "../../src/lib/ai/listening-frame.ts";

const script = [
  "Narrator: You will hear a conversation.",
  "[pause 30]",
  "Kate: [surprised] Really? [laughing] I had no idea!",
  "Tom: It's on the 23rd of March. [stage note]",
  "It costs £12.50.",
  "Kate: Can you spell it? [short pause] S-M-Y-T-H-E.",
].join("\n");

test("splitScript: speakers, pauses, expression tags kept, stage notes dropped", () => {
  const s = splitScript(script);
  assert.deepEqual(s.map((x) => x.pause ?? x.speaker), ["Narrator", 30, "Kate", "Tom", "Kate", 1, "Kate"]);
  assert.equal(s[2].text, "[surprised] Really? [laughing] I had no idea!");
  assert.equal(s[3].text, "It's on the 23rd of March.\nIt costs £12.50.");
});

test("the transcript students read has no tags or pauses", () => {
  const t = readableScript(script);
  assert.doesNotMatch(t, /\[|\]/);
  assert.match(t, /Kate: Really\? I had no idea!/);
});

test("speakable: Fish S2 brackets, s1 parentheses, none for plain voices", () => {
  assert.equal(speakable("[excited] IELTS is here."), "[excited] eye-elts is here.");
  assert.equal(speakable("[excited] Hi.", "paren"), "(excited) Hi.");
  assert.equal(speakable("[excited] Hi.", "none"), "Hi.");
});

test("planScript: turns, explicit pauses and turn gaps for the worker", () => {
  const plan = planScript(script, { Kate: "Serena" }, [{ id: "Ryan", label: "Ryan" }, { id: "Aiden", label: "Aiden" }, { id: "Serena", label: "Serena" }]);
  const speech = plan.filter((p) => p.kind === "speech");
  assert.deepEqual(speech.map((p) => [p.speaker, p.voice]), [["Narrator", "Ryan"], ["Kate", "Serena"], ["Tom", "Aiden"], ["Kate", "Serena"], ["Kate", "Serena"]]);
  assert.equal(plan[1].kind, "pause");
  assert.equal(plan[1].seconds, 30);
  // a natural gap between two people talking, never after an explicit pause
  assert.equal(plan[2].kind, "speech");
  assert.equal(plan[3].kind, "pause");
  assert.ok(plan[3].seconds > 0.25 && plan[3].seconds < 0.5);
  assert.match(speech[1].text, /^\[surprised\] Really\? \[laughing\]/);
});

test("31 expression tags are still supported", () => {
  assert.equal(EXPRESSIONS.length, 31);
});

test("listening mock frame still wraps a part in the exam instructions", () => {
  const framed = frameListening("Narrator: You will hear a man booking a hotel.\nA: Hello.\n[break]\nB: Hi.", 0, 1, 10);
  assert.match(framed, /^Narrator: This is an IELTS Listening test/);
  assert.match(framed, /\[pause 30\]/);
  assert.match(framed, /questions 1 to 5/);
  assert.match(framed, /That is the end of Part One/);
});
