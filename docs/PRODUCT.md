# Product

> Sources: merged PRs #1–#17, the code, and product decisions the owner confirmed on 2026-11-19. Anything marked **(to confirm)** is still open.

## Vision
LinguABC OS is a B2B platform sold to language learning centres. The app calls itself "the operating system behind a well-run learning centre". One deployment hosts many centres, and each is isolated from the others. The first market is Uzbekistan: UZS currency, Asia/Tashkent time, Uzbek and Russian interface, and local payment methods (Click, Payme, Uzum). The teaching side centres on IELTS preparation.

The product has two halves that meet in Student 360.

### Administrative OS
The business side of a centre:
- branches, rooms, courses
- groups with a weekly schedule; lessons are generated automatically, and room or mentor double-booking is refused
- enrolment
- monthly invoicing, the payments desk with numbered printable receipts, refunds
- staff invites and roles

**(to confirm)** The name "Administrative OS" comes from the handoff note. The repo itself only uses "ACADEMIC OS", as a label under the logo.

### Academic OS
The teaching side:
- attendance marking
- homework from the LinguABC library (277 published articles and podcasts), from uploaded worksheets or written by AI
- IELTS question types, marked in the database
- mentor review and approval
- mock exam sessions with band entry
- vocabulary cue cards after library texts

### Student 360
One page per student (`/students/[id]`) that brings both halves together:
- attendance, homework, payment and next-lesson KPIs
- activity timeline
- latest mock bands
- tabs for attendance history, payments (owner and admin only) and parent portal status
- invite a student or parent login from here

## Roles
The database has six roles (`member_role`):

| Role | Sees and does |
|---|---|
| **Owner** | Everything in the centre, including money. Only role that can invite or change owners and admins, and refund. Day-to-day teaching pages (Students, Attendance, Homework, Mocks) are hidden from the owner's menu. Owner panel in UZ/RU/EN, Uzbek by default. |
| **Admin** | Everything in the centre, including money and personal data. Invites the other roles and runs enrolment and payments. |
| **Academic Manager** | Everything academic in the centre, no money. Approves mentors' assignments. |
| **Mentor** | Only the groups they teach and those students. Marks attendance, sets homework (their AI or uploaded drafts wait for approval), reviews work, enters mock results when they are the examiner. |
| **Student** | Only themselves: schedule, homework, results, payments, receipts. Portal at `/student`, in English. |
| **Parent** | Only their linked children: attendance, homework, mock results, invoices and receipts. Switches between children if they have several. Portal at `/parent`, in Uzbek by default, with UZ/RU/EN. |

Admins, academic managers and mentors use the staff workspace in English. This was agreed in PR #7.

## V1 scope
**Shipped** (details in `V1-ROADMAP.md`):
- sign-up and invites; email or phone sign-in
- staff workspace, Student 360, attendance, payments desk (cash, card, transfer, Uzum)
- owner panel in UZ/RU/EN
- parent and student portals
- mock sessions with manual band entry
- homework: library, upload and AI, auto-marking, IELTS question types, vocabulary cue cards

**Still to do for V1** (due 15 January 2027):
1. **Listening with audio:** AI-generated listening sections, with audio from Fish Audio.
2. **Online mocks:** reading and listening taken in the app.
3. **Online parent payments,** through at least one real payment provider.
   - Flow: Parent app → **Pay now** → provider → payment verified → the student's invoice and payment records are updated.
   - More providers can come later.
4. **Basic progress:**
   - Student 360 academic and administrative history
   - homework completion and results
   - mock history and results
   - attendance history
   - basic academic progress and trends
5. **Basic notifications** triggered by the product for attendance, payments, homework, mock sessions and schedule changes.
6. **Settings:** "Soon" in the sidebar.
7. **Excel import.**
8. **Parents page:** the staff side; "Soon" in the sidebar.
9. **Reports:** "Soon" in the sidebar.

Two security issues also have to be fixed before launch. See `SECURITY.md` → Pre-launch blockers.

**The code is behind these decisions in two places:**
- Click and Payme still show "Soon", the server refuses them, and the code comments still call online payments V2 (PR #7). Bringing online payments into V1 means changing that.
- The `notifications` table and its channel enum (`in_app`, `sms`, `telegram`, `push`) exist from 0001, but no code writes to or reads from them yet.

## Out of scope for V1
- **Payment providers beyond the first.** V1 needs at least one; the rest can follow.
- **Advanced adaptive intelligence** in progress. V1 progress is history and basic trends.
- **SMS, Telegram and push notifications.** None is built yet, so they can come after V1.
- **Translated staff workspace** for admins, academic managers and mentors: they stay in English (PR #7).

**(to confirm)**
- Which provider comes first: Click, Payme or Uzum.
- Which channel basic notifications use in V1. In-app is the only one that needs no outside integration.
- No other exclusions are recorded.
