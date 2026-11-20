# V1 roadmap

**Target: V1 by 15 January 2027** (confirmed by the owner on 2026-11-19).

## Done (merged to `main`)
| PR | Merged | What |
|---|---|---|
| #1 | 2026-11-18 | V1 schema: 23 tables, RLS for six roles, 15 RPCs, append-only ledger, booking-clash constraints, views, audit log, SQL tests |
| #2 | 2026-11-18 | Next.js app with Supabase auth: login, register, join, password reset |
| #3 | 2026-11-18 | Runs without env setup (public Supabase defaults, Vercel URL detection) |
| #4 | 2026-11-18 | Branded auth emails with links on `app.linguabc.xyz` |
| #5 | 2026-11-18 | Staff workspace: overview, branches, groups and courses, students (5-step wizard), staff invites |
| #6 | 2026-11-18 | Student 360, attendance marking, payments desk and receipts |
| #7 | 2026-11-18 | Owner panel in UZ/RU/EN; Click and Payme marked "Soon" |
| #8 | 2026-11-18 | Parent and student portals |
| #9 | 2026-11-18 | Mock sessions and band entry |
| #10 | 2026-11-18 | Homework 1: LinguABC library (277 items) and assigning |
| #11 | 2026-11-18 | Homework 2: student work, auto-marking, mentor review |
| #12 | 2026-11-18 | Homework 3: worksheet upload and AI creation, approval |
| #13 | 2026-11-18 | OpenRouter as an alternative AI provider |
| #14 | 2026-11-18 | AI token caps and usage accounting |
| #15 | 2026-11-19 | Frankfurt region, loading states, owner menu |
| #16 | 2026-11-19 | Settings marked "Soon" |
| #17 | 2026-11-19 | IELTS question types with database marking; vocabulary cue cards |
| #20 | 2026-11-20 | Listening: Fish Audio recordings in a private bucket, voice per speaker |
| #21 | 2026-11-20 | AI drafts always carry their answers (required `key` field) |
| #22 | 2026-11-20 | Mock engine A: LinguABC library tests (admin tool, 0018) |
| #23 | 2026-11-20 | Fish Audio: lower sampling (temperature 0.3) so a voice stays steady across lines |
| #24 | 2026-11-20 | Mock engine B: online IELTS mocks (exam mode, auto-marking, mentor release, 0019) |
| #25 | 2026-11-20 | Exam: listening plays at start (fix found in QA); three-colour highlighting |

## Current milestone: wrapping up the IELTS engine
- [x] PR #17 merged and deployed to production
- [x] Cue cards checked on a library-based homework: the data path under RLS, and the owner's visual check in the browser (2026-11-19)
- [x] QA centre `qa-q-centre` and its users `qa.q.%@linguabc.test` deleted (2026-11-19)

The milestone is complete.

## Current milestone: Fish Audio / AI listening (started 2026-11-20)
- [x] Storage decided: private Supabase bucket `listening-audio`, signed URLs (owner, 2026-11-20)
- [x] Migration 0017, SQL test section 18 (passes locally)
- [x] Fish Audio client, "Generate audio" in the listening draft editor, playback for staff and students, transcript after submitting
- [x] PR #20 merged (2026-11-20)
- [x] 0017 applied to production (2026-11-20)
- [x] `FISH_AUDIO_API_KEY` set in Vercel (owner, 2026-11-20); six voices chosen, defaults in code
- [x] SQL check as each role on production, in one transaction that was rolled back (nothing left behind)
- [x] Owner's UI check (2026-11-20): a B2 gap-fill listening with 6 questions, a two-speaker conversation recorded by Fish Audio. The live API works.

The milestone is complete. Next: the mock engine.

## Remaining V1 work, in order
The owner confirmed this order on 2026-11-19.

1. **Fish Audio / AI listening.** Fish Audio integration; AI-generated listening sections with audio.
2. **Mock engine:** online mocks, with reading and listening taken in the app. Today mocks are scheduled and band results are typed in by hand.
   Owner's rules (2026-11-20):
   - Reading and listening are marked by the database the moment the student submits, **but the result goes to the mentor first, not the student.**
   - The mentor sees the reading and listening bands, adds the speaking and writing bands they marked themselves, then **releases the full result** (all four bands and the overall band) to the student and parent.
   - Homework is different: when a full listening or reading test, a single section or a single passage is set as homework, the student sees the result as soon as they submit (as today).
   - **Content:** homework is made by the centre (AI or upload), and centres may also use LinguABC library tests. **Full mocks use LinguABC library tests only.** The mentor previews the library's full reading and listening tests and picks the one they like for the session.
   - **IELTS Academic** band tables for reading and listening (40 questions each).
   - **Online mocks (PR B, built 2026-11-20):** 0019, the exam screen, test choice on the session page, release. The decimal-marking fix is included.
   - **Content tool (PR A, built 2026-11-20):** LinguABC admins write full tests at `/admin/tests` (AI drafts each section, Fish records listening, admin edits and publishes). Migration 0018.
   - **Easy to hard (owner, 2026-11-20):** every test rises in difficulty, from listening Part 1 to Part 4 and from reading Passage 1 to Passage 3, and within each section. The AI prompt requires it, and human-written tests follow it.
   - **Full IELTS exam mode (owner, 2026-11-20):** students take mocks in a locked, full-screen screen that looks like the real computer-delivered IELTS:
     - a header with the timer;
     - the passage and questions side by side;
     - a question navigator at the bottom;
     - flag for review;
     - no leaving the test. Leaving full screen or switching tabs is recorded and warned.
   - **Timed like the exam:** listening audio plays once with no pausing, then 2 minutes to check; reading is 60 minutes. Answers submit automatically when time runs out, and the deadline is enforced on the server.
3. **Basic progress:**
   - Student 360 academic and administrative history
   - homework completion and results
   - mock history and results
   - attendance history
   - basic trends

   Advanced adaptive intelligence comes later.
4. **In-app notifications** for attendance, payments, homework, mock sessions and schedule changes. SMS, Telegram and push delivery come later.
5. **Click payments.**
   - Flow: Parent app → Pay now → Click → payment verified → invoice and payment records updated.
   - Design it so the provider is one part that can be swapped: Payme and Uzum must be addable later without rewriting the core payment model.
6. **Settings, reports and the rest of V1:** settings, Excel import, the staff-side parents page, reports, and whatever else V1 still needs.

### Pre-launch blockers (security)
Both must be fixed before V1 goes live. Details in `SECURITY.md`.
- [ ] Unused invite codes never expire.
- [ ] Answer keys are visible to every mentor in the centre, not only the mentor of the group.

## Known dependencies
**Fish Audio**
- The owner has an account; the key goes in Vercel as `FISH_AUDIO_API_KEY`. The six voices the owner chose are the defaults in `src/lib/ai/fish.ts`; `FISH_AUDIO_VOICES` overrides them.
- The request format (`POST /v1/tts`, `model` header, JSON body) was written from memory: the docs site was unreachable from the build environment. It worked on the first live call (2026-11-20).
- Audio is stored in the private `listening-audio` bucket (see `ARCHITECTURE.md` → Storage).

**Click payments**
- Needs a Click merchant account and credentials, and a way to test against it (a sandbox, if Click offers one).
- The provider should sit behind a common interface (create a payment, verify a callback) so Payme and Uzum can be added later.
- The payment is marked paid only after the server verifies it with the provider (signature or callback check). It's then written through `record_payment`, so the existing ledger rules apply.
- The current "V2" refusal of Click and Payme in the UI and server has to change.

**In-app notifications**
- The `notifications` table (with the `in_app` channel) exists but nothing writes to it. The triggers have to hook into the attendance, payment, homework, mock and schedule flows.

**AI**
- Listening scripts and online-mock content build on the AI drafting pipeline (`src/lib/ai/`). That pipeline only works in production if `OPENROUTER_API_KEY` or `GEMINI_API_KEY` is set in Vercel, which isn't verified.

**Online mocks**
- Build on the 0016 question types and database marking, plus the listening audio from phase 1.

**Excel import**
- Needs a library to read spreadsheets. None is installed.
- Should go through the existing transactional RPCs (`create_student`, and so on) so RLS and validation still apply.

**Environment**
- QA runs on production because there's no staging. A staging Supabase project would make payment, online-mock and import testing safer.
