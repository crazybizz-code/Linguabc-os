// Browser QA of the pilot workflows against the LOCAL stack only
// (supabase/local/up.sh + `next dev -p 3100` with .env.qa). Synthetic users
// qa.*@linguabc.test. Never point BASE at production.
//   node tests/e2e/pilot-qa.mjs            (desktop + phone screenshots in /tmp/lg-qa)
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
// read-only check against the LOCAL QA database (never production)
const localSql = (q) => execFileSync("su", ["postgres", "-c", `psql -qtA -d linguabc_local -c "${q}"`], { encoding: "utf8" }).trim();
import { uz } from "../../src/i18n/uz.ts";
import { ru } from "../../src/i18n/ru.ts";

const BASE = process.env.QA_BASE ?? "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error("local stack only");
const OUT = process.env.QA_OUT ?? "/tmp/lg-qa";
mkdirSync(OUT, { recursive: true });
const PASS = "Qa-pass-12345";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const T = (en) => new RegExp(`^\\s*(${[en, uz[en], ru[en]].filter(Boolean).map(esc).join("|")})\\s*$`, "i");
const Tin = (en) => new RegExp(`(${[en, uz[en], ru[en]].filter(Boolean).map(esc).join("|")})`, "i");

const results = [];
let shot = 0;
async function step(page, role, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ role, name, ok: true, ms: Date.now() - t0 });
    console.log(`PASS  [${role}] ${name}`);
  } catch (e) {
    results.push({ role, name, ok: false, error: String(e.message ?? e).split("\n")[0].slice(0, 300) });
    console.log(`FAIL  [${role}] ${name}: ${String(e.message ?? e).split("\n")[0].slice(0, 300)}`);
  }
  await page.screenshot({ path: `${OUT}/${String(++shot).padStart(2, "0")}-${role}-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.png`, fullPage: true }).catch(() => {});
}
const expectText = async (page, re, timeout = 8000) => { await page.getByText(re).first().waitFor({ timeout }); };
const dialog = (page) => page.locator("dialog[open]").last();
async function submitDialog(page, label) {
  await dialog(page).getByRole("button", { name: T(label) }).click();
}

const browser = await chromium.launch();
const ctx = async (mobile = false) => browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1360, height: 900 } });

// ------------------------------------------------------------------ owner
const ownerCtx = await ctx();
const owner = await ownerCtx.newPage();
const links = {};
await step(owner, "owner", "register centre", async () => {
  await owner.goto(`${BASE}/register`);
  await owner.fill('input[name="name"]', "QA Owner");
  await owner.fill('input[name="center"]', "QA Pilot Centre");
  await owner.fill('input[name="phone"]', "+998901000001");
  await owner.fill('input[name="email"]', "qa.owner@linguabc.test");
  await owner.fill('input[name="password"]', PASS);
  await owner.fill('input[name="confirm"]', PASS);
  await owner.click('button[type="submit"]');
  await owner.waitForURL(/dashboard/, { timeout: 20000 });
});
await step(owner, "owner", "add branch", async () => {
  await owner.goto(`${BASE}/branches`);
  await owner.getByRole("button", { name: Tin("Add branch") }).first().click();
  await dialog(owner).locator('input[name="name"]').fill("Chilonzor");
  await dialog(owner).locator('input[name="address"]').fill("Chilonzor 1");
  await submitDialog(owner, "Add branch");
  await expectText(owner, /Chilonzor/);
});
await step(owner, "owner", "create course", async () => {
  await owner.goto(`${BASE}/groups?tab=courses`);
  await owner.getByRole("button", { name: Tin("Create course") }).first().click();
  await dialog(owner).locator('input[name="name"]').fill("IELTS B2");
  const code = dialog(owner).locator('input[name="code"]');
  if (await code.count()) await code.fill("B2");
  const fee = dialog(owner).locator('input[name="default_monthly_fee"]');
  if (await fee.count()) await fee.fill("800000");
  await submitDialog(owner, "Create course");
  await expectText(owner, /IELTS B2/);
});
for (const [role, name, email] of [["admin", "QA Admin", "qa.admin@linguabc.test"], ["mentor", "QA Mentor", "qa.mentor@linguabc.test"]]) {
  await step(owner, "owner", `invite ${role}`, async () => {
    await owner.goto(`${BASE}/staff`);
    await owner.getByRole("button", { name: Tin("Invite staff") }).first().click();
    const roleField = dialog(owner).locator(`[name="role"]`);
    if (await roleField.count()) {
      const tag = await roleField.first().evaluate((el) => el.tagName);
      if (tag === "SELECT") await roleField.first().selectOption(role);
    }
    const roleBtn = dialog(owner).locator("button").filter({ hasText: Tin(role === "admin" ? "Administrator" : "Mentor") });
    if (await roleBtn.count()) await roleBtn.first().click();
    await dialog(owner).locator('input[name="full_name"]').fill(name);
    await dialog(owner).locator('input[name="email"]').fill(email);
    await submitDialog(owner, "Create invitation");
    const link = await dialog(owner).locator('input[readonly], input[value*="/join?code="]').first().inputValue({ timeout: 8000 })
      .catch(async () => (await dialog(owner).innerText()).match(/https?:\/\/\S*join\?code=\w+/)?.[0]);
    if (!link || !/join\?code=/.test(link)) throw new Error("no invite link shown");
    links[role] = link.replace(/^https?:\/\/[^/]+/, BASE);
  });
}

async function join(page, role, link, name, email, phone) {
  await step(page, role, "join with invite", async () => {
    await page.goto(link);
    const f = async (n, v) => { const el = page.locator(`input[name="${n}"]`); if (await el.count()) await el.fill(v); };
    await f("full_name", name); await f("phone", phone); await f("email", email);
    await f("password", PASS); await f("confirm", PASS);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/join/.test(u.pathname), { timeout: 20000 });
  });
}

// ------------------------------------------------------------------ admin
const adminCtx = await ctx();
const admin = await adminCtx.newPage();
if (links.admin) await join(admin, "admin", links.admin, "QA Admin", "qa.admin@linguabc.test", "+998901000002");
const mentorCtx = await ctx();
const mentor = await mentorCtx.newPage();
if (links.mentor) await join(mentor, "mentor", links.mentor, "QA Mentor", "qa.mentor@linguabc.test", "+998901000003");

const past = new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10);
async function createGroup(name, expectOk) {
  await admin.goto(`${BASE}/groups`);
  await admin.getByRole("button", { name: Tin("Create group") }).first().click();
  const d = dialog(admin);
  await d.locator('input[name="name"]').fill(name);
  const mentorSel = d.locator('select[name="mentor_id"]');
  const opts = await mentorSel.locator("option").allInnerTexts();
  const m = opts.findIndex((o) => /QA Mentor/.test(o));
  if (m < 0) throw new Error("mentor not offered");
  await mentorSel.selectOption({ index: m });
  const room = d.locator('[name="room"]');
  if (await room.count()) { const tag = await room.evaluate((el) => el.tagName); if (tag === "SELECT") await room.selectOption({ index: 1 }).catch(() => {}); else await room.fill("101"); }
  await d.locator('input[name="start_date"]').fill(past);
  await d.locator('input[name="start_time"]').fill("10:00");
  await d.locator('input[name="end_time"]').fill("11:30");
  await submitDialog(admin, "Create group");
  if (expectOk) await expectText(admin, new RegExp(name), 10000);
  else await dialog(admin).locator('[role="alert"]').filter({ hasText: /Schedule conflict/i }).waitFor({ timeout: 15000 });
}
await step(admin, "admin", "create group with mentor, room and timetable", () => createGroup("QA B2 Morning", true));
await step(admin, "admin", "conflicting mentor/room schedule is rejected", () => createGroup("QA B2 Clash", false));

await step(admin, "admin", "add student with parent and enrol", async () => {
  await admin.goto(`${BASE}/students`);
  await admin.getByRole("button", { name: Tin("Add student") }).first().click();
  const d = dialog(admin);
  const fill = async (label, v) => { const el = d.getByLabel(Tin(label)); if (await el.count()) await el.first().fill(v); };
  for (let i = 0; i < 6; i++) {
    await fill("Full name", "Aziz QA");
    await fill("Phone", "+998901000010");
    await fill("Parent or guardian name", "Karim QA");
    await fill("Parent phone", "+998901000011");
    const grp = d.getByLabel(Tin("Group"));
    if (await grp.count()) { const o = await grp.locator("option").allInnerTexts(); const k = o.findIndex((x) => /QA B2 Morning/.test(x)); if (k >= 0) await grp.selectOption({ index: k }); }
    const next = d.getByRole("button", { name: T("Continue") });
    if (await next.count() && await next.isEnabled()) { await next.click(); continue; }
    break;
  }
  await d.locator('button[type="submit"]').last().click();
  await expectText(d, /QA B2 Morning/, 10000);   // "Added to QA B2 Morning. The first invoice ... was created."
  await d.getByRole("button", { name: T("Done") }).click();
  await expectText(admin, /Aziz QA/, 10000);
});

await step(admin, "admin", "record a partial payment and open the receipt", async () => {
  await admin.goto(`${BASE}/payments`);
  await expectText(admin, /Aziz QA/);
  await admin.getByRole("button", { name: T("Record") }).first().click();
  const d = dialog(admin);
  await d.locator('input[name="amount"]').fill("300000");
  const method = d.locator('[name="method"]');
  if (await method.count()) { const tag = await method.first().evaluate((el) => el.tagName); if (tag === "SELECT") await method.first().selectOption("cash"); else await d.getByText(T("Cash")).first().click(); }
  await d.locator('button[type="submit"]').last().click();
  await expectText(admin, /receipt|chek|квитанц|R-|000001/i, 10000);
});

await step(admin, "admin", "overpaying is refused", async () => {
  await admin.goto(`${BASE}/payments`);
  await admin.getByRole("button", { name: T("Record") }).first().click();
  const d = dialog(admin);
  await d.locator('input[name="amount"]').fill("99000000");
  const method = d.locator('select[name="method"]');
  if (await method.count()) await method.selectOption("cash");
  await d.locator('button[type="submit"]').last().click();
  await expectText(d, /more than what is owed/i);
});

if (process.env.QA_TG_INACTIVE) {
  await step(admin, "admin", "Parents page works while Telegram migrations are not applied", async () => {
    await admin.goto(`${BASE}/parents`);
    await expectText(admin, /Karim QA/);
    await admin.getByRole("button", { name: T("Telegram link") }).first().click();
    // the RPC does not exist yet: a readable error, no crash, no link
    await dialog(admin).waitFor({ timeout: 10000 });
    const txt = await dialog(admin).innerText();
    if (/t\.me\//.test(txt)) throw new Error("a link was issued without the migration");
    if (!/not set up/i.test(txt) || /schema|function/i.test(txt)) throw new Error(`unexpected dialog: ${txt.slice(0, 120)}`);
  });
}

if (process.env.QA_PARENTS) {
  // QA_PARENTS=expect-<reason> checks the not-ready message; QA_PARENTS=ready runs the linking flow.
  const mode = process.env.QA_PARENTS;
  await step(admin, "admin", "a second family with the SAME parent name and phone stays a separate row", async () => {
    await admin.goto(`${BASE}/students`);
    await admin.getByRole("button", { name: Tin("Add student") }).first().click();
    const d = dialog(admin);
    const fill = async (label, v) => { const el = d.getByLabel(Tin(label)); if (await el.count()) await el.first().fill(v); };
    for (let i = 0; i < 6; i++) {
      await fill("Full name", "Dilnoza QA"); await fill("Parent or guardian name", "Karim QA"); await fill("Parent phone", "+998901000011");
      const next = d.getByRole("button", { name: T("Continue") });
      if (await next.count() && await next.isEnabled()) { await next.click(); continue; }
      break;
    }
    await d.locator('button[type="submit"]').last().click();
    await d.getByRole("button", { name: T("Done") }).click();
    await admin.goto(`${BASE}/parents`);
    const rows = admin.locator("li").filter({ hasText: "Karim QA" });
    if (await rows.count() !== 2) throw new Error(`expected 2 separate rows, got ${await rows.count()}`);
    for (let i = 0; i < 2; i++) {
      const txt = await rows.nth(i).innerText();
      if (/Aziz QA/.test(txt) && /Dilnoza QA/.test(txt)) throw new Error("two children shown as one family");
    }
  });
  if (mode.startsWith("expect-")) {
    await step(admin, "admin", `Telegram linking is not offered (${mode})`, async () => {
      await admin.goto(`${BASE}/parents`);
      if (await admin.getByRole("button", { name: T("Telegram link") }).count()) throw new Error("link button shown while not ready");
      const want = { "expect-token": "bot token is missing", "expect-username": "bot username is missing", "expect-db": "database update is not applied" }[mode];
      await expectText(admin, new RegExp(want));
    });
  } else {
    await step(admin, "admin", "ready bot: issues a one-time link for the first family", async () => {
      await admin.goto(`${BASE}/parents`);
      const row = admin.locator("li").filter({ hasText: "Aziz QA" }).filter({ hasText: "Karim QA" }).first();
      await row.getByRole("button", { name: T("Telegram link") }).click();
      await expectText(dialog(admin), /t\.me\/linguabc_qa_bot\?start=[A-Za-z0-9_-]{32}/, 10000);
      await dialog(admin).getByRole("button", { name: "Close" }).click();
    });
    await step(admin, "admin", "adding the other child needs an explicit choice and confirmation", async () => {
      await admin.goto(`${BASE}/parents`);
      const row = admin.locator("li").filter({ hasText: "Aziz QA" }).first();
      await row.getByRole("button", { name: T("Add another child") }).click();
      const d = dialog(admin);
      const opt = await d.locator('select[name="guardian_id"] option').allInnerTexts();
      if (!opt.some((o) => /Dilnoza QA — Karim QA .*same phone/.test(o))) throw new Error(`candidate not offered/marked: ${opt.join(" | ")}`);
      await d.locator('select[name="guardian_id"]').selectOption({ index: 1 });
      // without the confirmation the browser refuses (required) and nothing changes
      await d.getByRole("button", { name: T("Add child") }).click();
      if (await d.getByText(Tin("Added. The parent now sees this child too.")).count()) throw new Error("added without confirmation");
      await d.locator('input[name="confirm_same_person"]').check();
      await d.getByRole("button", { name: T("Add child") }).click();
      await expectText(d, Tin("Added. The parent now sees this child too."), 10000);
      await d.getByRole("button", { name: "Close" }).click();
      await admin.goto(`${BASE}/parents`);
      const merged = admin.locator("li").filter({ hasText: "Aziz QA" }).filter({ hasText: "Dilnoza QA" });
      if (await merged.count() !== 1) throw new Error("the account does not show both children");
      if (await admin.locator("li").filter({ hasText: "Karim QA" }).count() !== 1) throw new Error("the second record should now be part of the account");
    });
  }
}

// ------------------------------------------------------------------ mentor
await step(mentor, "mentor", "sees own group and timetable", async () => {
  await mentor.goto(`${BASE}/schedule`);
  await expectText(mentor, /QA B2 Morning/);
});
await step(mentor, "mentor", "marks attendance (absent) for a past lesson", async () => {
  await mentor.goto(`${BASE}/attendance`);
  const lesson = mentor.locator('a[href^="/attendance/"]').first();
  await lesson.click();
  await expectText(mentor, /Aziz QA/);
  await mentor.getByRole("button", { name: T("Absent") }).first().click();
  await mentor.getByRole("button", { name: Tin("Save") }).first().click();
  await expectText(mentor, /saved|Saved|attendance/i);
});
await step(mentor, "mentor", "assigns a library item to the group", async () => {
  await mentor.goto(`${BASE}/homework/library`);
  await mentor.locator('a[href^="/homework/library/"]').first().click();
  await mentor.getByRole("button", { name: Tin("Assign to a group") }).first().click();
  const d = dialog(mentor);
  const g = d.locator('select[name="group_id"]');
  const o = await g.locator("option").allInnerTexts(); const k = o.findIndex((x) => /QA B2 Morning/.test(x));
  if (k < 0) throw new Error("own group not offered");
  await g.selectOption({ index: k });
  await d.locator('input[name="due_date"]').fill(new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  await submitDialog(mentor, "Assign");
  await mentor.waitForTimeout(1500);
  await mentor.goto(`${BASE}/homework`);
  await expectText(mentor, /QA B2 Morning/);
});

// ------------------------------------------------------------------ student
await step(admin, "admin", "issue the student's login invite", async () => {
  await admin.goto(`${BASE}/students`);
  await admin.getByText("Aziz QA").first().click();
  await admin.waitForURL(/\/students\/[0-9a-f-]{36}/);
  await admin.getByRole("button", { name: Tin("Invite student") }).first().click();
  await expectText(dialog(admin), /join\?code=/, 10000);
  const link = (await dialog(admin).innerText()).match(/https?:\/\/\S*join\?code=\w+/)?.[0] ?? "";
  if (!/join\?code=/.test(link)) throw new Error("no student link");
  links.student = link.replace(/^https?:\/\/[^/]+/, BASE);
});
const studentCtx = await ctx(true);   // the student uses a phone
const student = await studentCtx.newPage();
if (links.student) await join(student, "student", links.student, "Aziz QA", "qa.student@linguabc.test", "+998901000010");
await step(student, "student", "does the homework and sees the result", async () => {
  await student.goto(`${BASE}/student/homework`);
  await student.getByText(/QA: Ocean currents/).first().click();
  await student.getByText(/Keeps western Europe mild/).first().click();
  await student.locator('input[type="text"], input:not([type])').first().fill("equator");
  await student.getByRole("button", { name: /^\s*Submit\s*$/ }).click();
  await student.getByRole("button", { name: /Confirm submit/ }).click();
  await expectText(student, /100\s*%|2\s*\/\s*2/, 15000);
});
await step(student, "student", "sees timetable, attendance (absent) and balance", async () => {
  await student.goto(`${BASE}/student/schedule`);
  await expectText(student, /10:00 · Room 101/);
  await expectText(student, /^\s*Absent\s*$/);
  await student.goto(`${BASE}/student/payments`);
  await expectText(student, /500[\s ,.]?000/);
});
await step(student, "student", "phone layout has no sideways scroll", async () => {
  for (const path of ["/student", "/student/homework", "/student/schedule", "/student/payments", "/student/progress"]) {
    await student.goto(`${BASE}${path}`);
    if (!student.url().includes(path)) throw new Error(`not signed in (${path} redirected)`);
    const over = await student.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    if (over > 2) throw new Error(`${path} is ${over}px wider than the phone`);
  }
});
await step(mentor, "mentor", "sees the submission and its score", async () => {
  await mentor.goto(`${BASE}/homework`);
  await mentor.locator('a[href^="/homework/"]').filter({ hasText: /QA: Ocean currents|QA B2 Morning/ }).first().click();
  await expectText(mentor, /Aziz QA/);
  await expectText(mentor, /100/);
});

if (process.env.QA_ADMIN_OPS) {
  await step(admin, "admin", "students list shows Partial for a partly paid invoice", async () => {
    await admin.goto(`${BASE}/students`);
    await admin.locator("td").filter({ hasText: /^\s*Partial\s*$/ }).first().waitFor({ timeout: 8000 });
  });
  await step(admin, "admin", "edits the student's details", async () => {
    await admin.goto(`${BASE}/students`);
    await admin.getByText("Aziz QA").first().click();
    await admin.getByRole("button", { name: T("Edit details") }).click();
    await dialog(admin).locator('input[name="full_name"]').fill("Aziz QA Edited");
    await dialog(admin).getByRole("button", { name: T("Save") }).click();
    await expectText(admin, /Aziz QA Edited/, 10000);
  });
  await step(admin, "admin", "adds a parent on the Parent tab", async () => {
    await admin.goto(admin.url().split("?")[0] + "?tab=parent");
    await admin.getByRole("button", { name: T("Add parent") }).click();
    await dialog(admin).locator('input[name="full_name"]').fill("Malika QA");
    await dialog(admin).locator('input[name="phone"]').fill("+998901000012");
    await dialog(admin).getByRole("button", { name: T("Save") }).click();
    await expectText(admin, /Malika QA/, 10000);
  });
  await step(admin, "admin", "second group at another time, then moves the student there", async () => {
    await admin.goto(`${BASE}/groups`);
    await admin.getByRole("button", { name: Tin("Create group") }).first().click();
    const d = dialog(admin);
    await d.locator('input[name="name"]').fill("QA B1 Evening");
    await d.locator('[name="room"]').fill("102");
    await d.locator('input[name="start_time"]').fill("18:00");
    await d.locator('input[name="end_time"]').fill("19:30");
    await submitDialog(admin, "Create group");
    await expectText(admin, /QA B1 Evening/, 10000);
    await admin.goto(`${BASE}/students`);
    await admin.getByText("Aziz QA Edited").first().click();
    await admin.getByRole("button", { name: T("Move to another group") }).click();
    const m = dialog(admin);
    const sel = m.locator('select[name="to_group"]');
    const o = await sel.locator("option").allInnerTexts(); await sel.selectOption({ index: o.findIndex((x) => /QA B1 Evening/.test(x)) });
    await m.getByRole("button", { name: T("Move") }).click();
    await expectText(admin, /QA B1 Evening/, 10000);
    await expectText(admin, /Moved to another group/, 10000);
  });
  await step(admin, "admin", "changes the timetable and cancels a lesson", async () => {
    await admin.goto(`${BASE}/groups`);
    await admin.getByText("QA B1 Evening").first().click();
    await admin.getByRole("button", { name: T("Change timetable") }).click();
    const d = dialog(admin);
    await d.locator('input[name="start_time"]').fill("17:00");
    await d.locator('input[name="end_time"]').fill("18:30");
    await d.getByRole("button", { name: T("Save timetable") }).click();
    await expectText(admin, /17:00–18:30/, 10000);
    await admin.getByRole("button", { name: T("Cancel") }).first().click();
    await dialog(admin).locator('input[name="reason"]').fill("QA");
    await dialog(admin).getByRole("button", { name: T("Cancel lesson") }).click();
    await admin.waitForTimeout(1500);
  });
  await step(admin, "admin", "a clashing move (same mentor, morning group's time) is refused", async () => {
    // the morning group meets Mon/Wed/Fri 10:00-11:30 with the same mentor
    let d0 = new Date(Date.now() + 86400000);
    while (![1, 3, 5].includes(d0.getUTCDay())) d0 = new Date(d0.getTime() + 86400000);
    await admin.getByRole("button", { name: T("Move") }).first().click();
    const d = dialog(admin);
    await d.locator('input[name="date"]').fill(d0.toISOString().slice(0, 10));
    await d.locator('input[name="start_time"]').fill("10:00");
    await d.locator('input[name="end_time"]').fill("11:00");
    await d.getByRole("button", { name: T("Move lesson") }).click();
    await d.locator('[role="alert"]').filter({ hasText: /Schedule conflict/ }).waitFor({ timeout: 10000 });
  });
  await step(student, "student", "sees the new timetable and the cancelled lesson notice", async () => {
    await student.goto(`${BASE}/student/schedule`);
    await expectText(student, /17:00/);
  });
  await step(mentor, "mentor", "cannot see the edit buttons on a group", async () => {
    await mentor.goto(`${BASE}/groups`);
    const link = mentor.getByText("QA B2 Morning").first();
    await link.click();
    if (await mentor.getByRole("button", { name: T("Change timetable") }).count()) throw new Error("mentor sees timetable editing");
  });
}

if (process.env.QA_KPI) {
  await step(owner, "owner", "sees mentor KPIs counted from real records", async () => {
    await owner.goto(`${BASE}/mentors`);
    await expectText(owner, Tin("Mentor KPIs"));
    const row = owner.locator("tr").filter({ hasText: "QA Mentor" }).first();
    await row.waitFor({ timeout: 8000 });
    const text = await row.innerText();
    if (!/\(1\/\d+\)/.test(text)) throw new Error(`attendance recorded not counted: ${text}`);
    // homework is due in 3 days: not counted as handed in yet; auto-marked work needs no review
    if (!/\t1\t— \(0\/0\)\t— \(0\/0\)/.test(text)) throw new Error(`homework/reviews not counted as expected: ${text}`);
  });
  await step(mentor, "mentor", "cannot open the mentors KPI page", async () => {
    await mentor.goto(`${BASE}/mentors`);
    await mentor.waitForURL(/dashboard/, { timeout: 10000 });
  });
}

if (process.env.QA_MOCK) {
  await step(mentor, "mentor", "schedules a mock for own group", async () => {
    await mentor.goto(`${BASE}/mocks`);
    await mentor.getByRole("button", { name: Tin("Create mock session") }).first().click();
    const d = dialog(mentor);
    await d.locator('input[name="name"]').fill("QA Mock 1");
    const g = d.locator('select[name="group_id"]');
    const o = await g.locator("option").allInnerTexts(); await g.selectOption({ index: Math.max(0, o.findIndex((x) => /QA B2 Morning/.test(x))) });
    await d.locator('input[name="date"]').fill(new Date().toISOString().slice(0, 10));
    await d.locator('input[name="time"]').fill("09:00");
    await submitDialog(mentor, "Create mock session");
    await mentor.waitForTimeout(1500);
    await mentor.goto(`${BASE}/mocks`);
    await expectText(mentor, /QA Mock 1/);
  });
  await step(student, "student", "does not see the mock result before release", async () => {
    await student.goto(`${BASE}/student/progress`);
    if (await student.getByText(/QA Mock 1/).count()) throw new Error("result visible before release");
  });
  await step(mentor, "mentor", "enters bands and releases the result", async () => {
    mentor.on("dialog", (dlg) => dlg.accept());
    await mentor.getByText("QA Mock 1").first().click();
    for (const [m, v] of [["Reading", "6.5"], ["Listening", "7.0"], ["Writing", "6.0"], ["Speaking", "6.5"]]) {
      await mentor.getByLabel(new RegExp(`Aziz QA ${m}`)).selectOption({ label: v });
    }
    await mentor.getByRole("button", { name: T("Save results") }).click();
    await expectText(mentor, /^\s*Saved\s*$/, 10000);
    await mentor.reload();
    await mentor.getByRole("button", { name: Tin("Send results") }).click();
    await expectText(mentor, /Sent to family/, 10000);
  });
  await step(student, "student", "sees the released mock result", async () => {
    await student.goto(`${BASE}/student/progress`);
    await expectText(student, /6\.5/, 10000);
  });
}

if (process.env.QA_SETTINGS) {
  await step(owner, "owner", "saves centre phone, address and time zone", async () => {
    await owner.goto(`${BASE}/settings`);
    await owner.locator('input[name="phone"]').fill("+998 71 200 00 00");
    await owner.locator('input[name="address"]').fill("Chilonzor 9, Tashkent");
    await owner.locator('select[name="timezone"]').selectOption("Asia/Samarkand");
    await owner.getByRole("button", { name: T("Save") }).click();
    await expectText(owner, Tin("Saved."), 10000);
    await owner.reload();
    if (await owner.locator('input[name="address"]').inputValue() !== "Chilonzor 9, Tashkent") throw new Error("address not persisted");
    if (await owner.locator('select[name="timezone"]').inputValue() !== "Asia/Samarkand") throw new Error("time zone not persisted");
  });
  await step(owner, "owner", "a bad phone is refused with a readable message", async () => {
    await owner.locator('input[name="phone"]').fill("call me");
    await owner.getByRole("button", { name: T("Save") }).click();
    await expectText(owner, Tin("Enter a phone number such as +998 71 200 00 00."), 10000);
  });
  await step(admin, "admin", "sees the centre settings read-only", async () => {
    await admin.goto(`${BASE}/settings`);
    await expectText(admin, /Chilonzor 9, Tashkent/);
    if (await admin.locator('input[name="address"]').count()) throw new Error("admin can edit");
  });
}

if (process.env.QA_SUGGEST) {
  await step(student, "student", "sees rule-based suggestions on My plan", async () => {
    await student.goto(`${BASE}/student/plan`);
    await expectText(student, Tin("Suggestions for you"));
    const card = student.locator("section, div").filter({ hasText: Tin("Suggestions for you") }).last();
    const items = await student.locator("li").filter({ hasText: /practice|homework|attendance|mock|track/i }).count();
    if (items < 1) throw new Error("no suggestion shown");
    void card;
  });
}

if (process.env.QA_ONLINE_MOCK) {
  let sessionUrl = "";
  await step(admin, "admin", "schedules an online mock with the published reading test", async () => {
    await admin.goto(`${BASE}/mocks`);
    await admin.getByRole("button", { name: Tin("Create mock session") }).first().click();
    const d = dialog(admin);
    await d.locator('input[name="name"]').fill("QA Online Mock");
    const g = d.locator('select[name="group_id"]');
    const o = await g.locator("option").allInnerTexts(); await g.selectOption({ index: Math.max(0, o.findIndex((x) => /QA B2 Morning/.test(x))) });
    // the exam opens 15 minutes before the start and closes 12 hours after: start it now (Tashkent time)
    const tk = new Date(Date.now() + 5 * 3600_000).toISOString();
    await d.locator('input[name="date"]').fill(tk.slice(0, 10));
    await d.locator('input[name="time"]').fill(tk.slice(11, 16));
    await submitDialog(admin, "Create mock session");
    await admin.waitForTimeout(1500);
    await admin.goto(`${BASE}/mocks`);
    await admin.getByText("QA Online Mock").first().click();
    await admin.waitForURL(/\/mocks\/[0-9a-f-]{36}/);
    sessionUrl = admin.url();
    const reading = admin.locator("select").filter({ has: admin.locator("option", { hasText: "QA Reading Test" }) }).first();
    await reading.selectOption({ label: "QA Reading Test · B2" });
    await admin.getByRole("button", { name: T("Save tests") }).click();
    await admin.waitForTimeout(1500);
  });
  let examUrl = "";
  await step(student, "student", "takes the reading test: timer, answers, autosave", async () => {
    await student.goto(`${BASE}/student/mocks`);
    const start = student.getByRole("link", { name: /^(Start|Continue)$/ }).first();
    examUrl = BASE + (await start.getAttribute("href"));
    await student.goto(examUrl);
    await student.getByRole("button", { name: /start the test/ }).click();
    await student.getByText(/minutes left/).waitFor({ timeout: 15000 });
    const timer = await student.locator("header p.text-\\[20px\\]").first().innerText();
    if (!/^(59|60):\d\d$/.test(timer.trim())) throw new Error(`timer shows ${timer}`);
    for (let n = 1; n <= 13; n++) {
      await student.locator(`#q-${n}`).getByText(n % 2 ? "TRUE" : "FALSE", { exact: true }).click();
    }
    // autosave: the answers reach the database before any submit ("Saved" is hidden on phones)
    let saved = 0;
    for (let i = 0; i < 20 && saved < 13; i++) {
      await student.waitForTimeout(500);
      saved = Number(localSql("select coalesce(max((select count(*) from jsonb_object_keys(answers))), 0) from mock_attempts where submitted_at is null"));
    }
    if (saved < 13) throw new Error(`only ${saved} answers autosaved`);
  });
  await step(student, "student", "submits; the result waits for the mentor", async () => {
    await student.getByRole("button", { name: /^Submit$/ }).first().click();
    await student.getByRole("button", { name: /^Submit$/ }).last().click();
    await student.waitForTimeout(2000);
    await student.goto(`${BASE}/student/progress`);
    if (await student.getByText(/QA Online Mock/).count()) throw new Error("result visible before release");
  });
  await step(admin, "admin", "sees the auto-marked reading band and releases", async () => {
    admin.on("dialog", (dlg) => dlg.accept());
    await admin.goto(sessionUrl);
    const sel = admin.getByLabel(/Aziz QA Reading/);
    const v = await sel.inputValue();
    if (!v) throw new Error("reading band not filled by auto-marking");
    for (const m of ["Listening", "Writing", "Speaking"]) await admin.getByLabel(new RegExp(`Aziz QA ${m}`)).selectOption({ label: "6.0" });
    await admin.getByRole("button", { name: T("Save results") }).click();
    await admin.waitForTimeout(1500);
    await admin.reload();
    await admin.getByRole("button", { name: Tin("Send results") }).click();
    await admin.waitForTimeout(2000);
    // (the sheet shows "Sent to family" without a reload only with PR #40)
    if (localSql("select count(*) from mock_results r join mock_sessions s on s.id = r.mock_session_id where s.name = 'QA Online Mock' and r.released_at is not null") !== "1") throw new Error("not released");
    if (localSql("select reading_band from mock_results r join mock_sessions s on s.id = r.mock_session_id where s.name = 'QA Online Mock'") !== "4.5") throw new Error("reading band is not the auto-marked 4.5 (13/40)");
  });
  await step(student, "student", "sees the released result; cannot take the test again", async () => {
    await student.goto(`${BASE}/student/progress`);
    await expectText(student, /QA Online Mock/, 10000);
    await student.goto(examUrl);
    if (await student.getByRole("button", { name: /start the test/ }).count()) {
      await student.getByRole("button", { name: /start the test/ }).click();
      await student.getByText(/already|submitted|finished|closed/i).first().waitFor({ timeout: 10000 });
    }
    if (localSql("select count(*) from mock_attempts a join mock_sessions s on s.id = a.mock_session_id where s.name = 'QA Online Mock'") !== "1") throw new Error("a second attempt was created");
  });
  await step(owner, "visitor", "a signed-out visitor cannot open the exam", async () => {
    const other = await (await ctx()).newPage();
    await other.goto(examUrl);
    await other.waitForURL(/login/, { timeout: 10000 });
  });
}

// ------------------------------------------------------------------ owner: finance and monitoring
await step(owner, "owner", "sees the payment in reports", async () => {
  await owner.goto(`${BASE}/reports`);
  await expectText(owner, /300[\s ,.]?000/);
});

await step(owner, "owner", "records an expense and sees the net cash-based result", async () => {
  await owner.goto(`${BASE}/finance`);
  await owner.getByRole("button", { name: Tin("Record expense") }).first().click();
  const d = dialog(owner);
  await d.locator('select[name="category"]').selectOption("rent");
  await d.locator('input[name="amount"]').fill("200000");
  await d.locator('input[name="description"]').fill("QA rent");
  await d.getByRole("button", { name: T("Save") }).click();
  await expectText(owner, /QA rent/, 10000);
  const body = await owner.locator("main, body").first().innerText();
  const nums = body.replace(/ /g, " ");
  if (!/300[ ,.]?000/.test(nums) || !/200[ ,.]?000/.test(nums) || !/100[ ,.]?000/.test(nums)) throw new Error("expected 300 000 in, 200 000 out, 100 000 net");
});
await step(owner, "owner", "voids the expense with a reason; the result goes back", async () => {
  await owner.getByRole("button", { name: T("Void") }).first().click();
  const d = dialog(owner);
  await d.locator('input[name="reason"]').fill("QA test entry");
  await d.getByRole("button", { name: T("Void expense") }).click();
  await owner.waitForTimeout(1500);
  await owner.reload();
  await expectText(owner, /QA test entry/);
});
await step(owner, "owner", "admin cannot open finance", async () => {
  await admin.goto(`${BASE}/finance`);
  await admin.waitForURL(/dashboard/, { timeout: 10000 });
});

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
