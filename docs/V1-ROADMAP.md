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

## Current milestone: wrapping up the IELTS engine
- [x] PR #17 merged and deployed to production
- [x] Cue cards checked on a library-based homework: the data path under RLS, and the owner's visual check in the browser (2026-11-19)
- [ ] Delete the QA centre `qa-q-centre` and its users `qa.q.%@linguabc.test`

## Remaining V1 work, in order
The owner confirmed this order on 2026-11-19.

1. **Fish Audio / AI listening.** Fish Audio integration; AI-generated listening sections with audio.
2. **Mock engine:** online mocks, with reading and listening taken in the app. Today mocks are scheduled and band results are typed in by hand.
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
- Needs an API key and account. None is configured, and no code exists yet.
- **Where the audio is stored is an open decision.** Supabase Storage isn't used at all today, and existing audio is external URLs. Choose (bucket, access rules, signed or public URLs) before building.

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
