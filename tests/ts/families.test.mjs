// Parents page grouping (src/lib/families.ts): rows merge ONLY by parent
// membership, never by name or phone. Run: npm run test:ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachCandidates, groupFamilies } from "../../src/lib/families.ts";

const st = (id, name) => ({ id, full_name: name, open_balance: 0, overdue_count: 0 });
const m = (id) => ({ id, status: "invited", invite_code: null, invite_expires_at: null });
const g = (id, student, name, phone, membership = null) =>
  ({ id, student_id: student, full_name: name, phone, relationship: "mother", membership_id: membership, membership: membership ? m(membership) : null });
const students = [st("s1", "Aziz"), st("s2", "Dilnoza"), st("s3", "Bobur"), st("s4", "Kamola")];

test("same name, different people: two rows", () => {
  const rows = groupFamilies([g("g1", "s1", "Karim Karimov", "+998901111111"), g("g2", "s2", "Karim Karimov", "+998902222222")], students);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.children.map((c) => c.name)), [["Aziz"], ["Dilnoza"]]);
});

test("shared phone without a linked account: still separate rows", () => {
  const rows = groupFamilies([g("g1", "s1", "Malika", "+998 90 111 11 11"), g("g2", "s2", "Karim", "+998901111111")], students);
  assert.equal(rows.length, 2);
});

test("missing phones never merge", () => {
  const rows = groupFamilies([g("g1", "s1", "Ota", null), g("g2", "s2", "Ota", null), g("g3", "s3", "Ota", "")], students);
  assert.equal(rows.length, 3);
});

test("one parent account with several children: one row with all of them", () => {
  const rows = groupFamilies([g("g1", "s1", "Karim", "+998901111111", "M1"), g("g2", "s2", "Karim K.", null, "M1"), g("g3", "s3", "Karim", "+998901111111")], students);
  assert.equal(rows.length, 2);
  const acct = rows.find((r) => r.key === "m:M1");
  assert.deepEqual(acct.children.map((c) => c.name), ["Aziz", "Dilnoza"]);
  assert.deepEqual(acct.guardianIds, ["g1", "g2"]);
  assert.equal(rows.find((r) => r.key === "g:g3").children.length, 1, "same phone but not linked: its own row");
});

test("candidates to add: only unlinked records of other children; same phone is a hint, first", () => {
  const gs = [g("g1", "s1", "Karim", "+998901111111", "M1"), g("g2", "s2", "Malika", "+998 90 111 11 11"), g("g3", "s3", "Ali", null),
              g("g4", "s4", "Vali", "+998905555555", "M2"), g("g5", "s1", "Karim again", "+998901111111")];
  const rows = groupFamilies(gs, students);
  const c = attachCandidates(rows.find((r) => r.key === "m:M1"), gs, students);
  assert.deepEqual(c.map((x) => x.guardianId), ["g2", "g3"], "not linked records, not its own child, not other accounts");
  assert.equal(c[0].samePhone, true);
  assert.equal(c[1].samePhone, false);
  assert.deepEqual(attachCandidates(rows.find((r) => r.key === "g:g2"), gs, students), [], "no account: nothing to add");
});
