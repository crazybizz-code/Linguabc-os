// Rule-based student suggestions (src/lib/suggestions.ts). Run: npm run test:ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggest } from "../../src/lib/suggestions.ts";

const NOW = "2026-11-25T10:00:00Z";
const base = { now: NOW, attendancePct: 95, attendanceCounted: 10, homework: [], bySkill: [], latestMock: null };
const hw = (id, due, status, onTime = null, skill = "reading") => ({ id, title: `HW ${id}`, skill, due_at: due, status, onTime });
const kinds = (p) => suggest({ ...base, ...p }).map((s) => s.kind);

test("all good: one positive suggestion", () => {
  assert.deepEqual(kinds({}), ["keep_going"]);
});

test("missed homework in the last 30 days comes first and links to the newest one", () => {
  const s = suggest({ ...base, attendancePct: 60, homework: [hw("a", "2026-11-01T00:00:00Z", "missed"), hw("b", "2026-11-20T00:00:00Z", "missed"), hw("old", "2026-09-01T00:00:00Z", "missed")] });
  assert.equal(s[0].kind, "missed_homework");
  assert.equal(s[0].vars.n, 2);
  assert.equal(s[0].href, "/student/homework/b");
  assert.equal(s[1].kind, "attendance");
});

test("attendance under 80% only with at least 4 lessons", () => {
  assert.ok(kinds({ attendancePct: 75, attendanceCounted: 4 }).includes("attendance"));
  assert.ok(!kinds({ attendancePct: 50, attendanceCounted: 3 }).includes("attendance"));
  assert.ok(!kinds({ attendancePct: 80, attendanceCounted: 10 }).includes("attendance"));
});

test("weak homework skill needs two marked tasks under 60%", () => {
  assert.deepEqual(kinds({ bySkill: [{ skill: "listening", avg: 45, count: 2 }] }), ["weak_skill_homework"]);
  assert.deepEqual(kinds({ bySkill: [{ skill: "listening", avg: 45, count: 1 }] }), ["keep_going"]);
  assert.deepEqual(kinds({ bySkill: [{ skill: "vocabulary", avg: 10, count: 5 }] }), ["keep_going"], "only the four IELTS skills");
  const s = suggest({ ...base, bySkill: [{ skill: "listening", avg: 45, count: 2 }] })[0];
  assert.equal(s.href, "/student/practice?kind=podcast");
});

test("weak mock skill: half a band below overall or under 5.5; not repeated if already suggested", () => {
  assert.deepEqual(kinds({ latestMock: { reading: 6, listening: 7, writing: 6.5, speaking: 7, overall: 6.5 } }), ["weak_skill_mock"]);
  assert.deepEqual(kinds({ latestMock: { reading: 7, listening: 7, writing: 7, speaking: 7, overall: 7 } }), ["keep_going"]);
  assert.deepEqual(kinds({ latestMock: { reading: 5, listening: 5, writing: 5, speaking: 5, overall: 5 } }), ["weak_skill_mock"]);
  assert.deepEqual(kinds({ bySkill: [{ skill: "reading", avg: 40, count: 3 }], latestMock: { reading: 5, listening: 7, writing: 7, speaking: 7, overall: 6.5 } }), ["weak_skill_homework"]);
});

test("late hand-ins: 3+ handed in and under 70% on time", () => {
  const late = [hw("1", NOW, "submitted", false), hw("2", NOW, "submitted", false), hw("3", NOW, "submitted", true)];
  assert.deepEqual(kinds({ homework: late }), ["late_homework"]);
  assert.deepEqual(kinds({ homework: late.slice(0, 2) }), ["keep_going"]);
});

test("at most three, most urgent first", () => {
  const s = suggest({ ...base, attendancePct: 50, homework: [hw("m", "2026-11-20T00:00:00Z", "missed"), hw("1", NOW, "submitted", false), hw("2", NOW, "submitted", false), hw("3", NOW, "submitted", false)],
    bySkill: [{ skill: "writing", avg: 30, count: 3 }], latestMock: { reading: 4, listening: 7, writing: 3, speaking: 7, overall: 5.5 } });
  assert.deepEqual(s.map((x) => x.kind), ["missed_homework", "attendance", "weak_skill_homework"]);
});
