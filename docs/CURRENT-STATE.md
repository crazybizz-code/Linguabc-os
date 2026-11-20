# Current state

_Last updated: 2026-11-20. Update this file at the end of every working session._

## Code
- `main`: the last feature merge is **`8826a16`**, "IELTS question types, server marking and vocabulary cue cards (#17)". It's followed by docs-only commits: `4f02d1c` (#18, project memory) and this state update (#19).
- Latest merged PRs:
  - #19 docs: current state after QA cleanup
  - #18 docs: project memory (`CLAUDE.md`, `docs/`)
  - #17 IELTS engine and cue cards
  - #16 Settings marked "Soon"
  - #15 Frankfurt region, loading states, owner menu
- **Merged 2026-11-20:** #21, AI drafts always carry their answers (the owner had to type gap-fill answers by hand: Gemini drops optional fields). #20, Fish Audio / AI listening (migration 0017, `src/lib/ai/fish.ts`, `src/lib/audio.ts`, listening editor and playback).
- Old feature branches are still on the remote: `feat/*`, `fix/*`, `docs/*`, `backend/v1-schema`, `frontend/auth`, `chore/env-defaults`. They're all merged.

## Production
- **Vercel:** the production deployment of `8826a16` succeeded on 2026-11-19. URL: `https://linguabc-os.vercel.app`.
- **Supabase** `qycffcuuavtlojkxrkiz` holds **one centre**: `convora-5hqe` ("Convora"), with 1 member and no academic data. There's 1 auth user, Convora's.
- 277 published library items.
- **No QA centres or QA users are left.** `qa-q-centre` and its users `qa.q.owner`, `qa.q.mentor` and `qa.q.student` (`@linguabc.test`) were deleted on 2026-11-19, after the cue-card check.
  - Convora's data fingerprint was the same before and after.
  - The append-only `audit_log` keeps 15 rows for the deleted QA centre, plus 68 from earlier QA centres. They point to centre ids that no longer exist. That's expected and harmless.

**Production check on 2026-11-20 (read-only):** project `ACTIVE_HEALTHY`, Postgres 17. Still one centre (Convora), 1 membership, 1 auth user, no QA centres or users. Library: 277 published, 18 hidden. `audit_log` 84 rows. No storage buckets yet.
- Security advisor: `security definer` RPCs callable by `authenticated` (by design: each re-checks the role), `invite_preview` callable by `anon` (by design, for the join page), and **leaked-password protection is off** (Auth setting in the dashboard).
- Performance advisor: 47 foreign keys without an index, 6 RLS policies that call `auth.uid()` per row, and 10 tables with two permissive SELECT policies. None matter at today's size. Worth one clean-up migration before launch.
- Note: `finish_ai_request` takes token counts and cost from the caller. A mentor calling the RPC directly could under-report their own usage. The hourly and daily request limits still hold, so only the cost report is affected.

## Migrations applied to production
`0017_listening_audio` applied on 2026-11-20. The `listening-audio` bucket and its 3 storage policies exist.

**Listening SQL check on production (2026-11-20):** one transaction with throwaway QA users and a `qa-listening` centre, rolled back at the end, so nothing was left behind (verified by counts afterwards). All checks passed: the mentor can upload and outsiders and students can't; a student hears the audio only once it's set as homework, can't read the transcript or key before submitting, and gets the transcript and a 100% score after; an outsider can't hear it. Direct `DELETE` on `storage.objects` is blocked by Supabase (`storage.protect_delete`), so the delete policy is tested only in the local suite and through the Storage API.

`0001`–`0015`, and `0016` applied as three parts: `0016_ielts_questions_part1`, `_part2` and `_part3`. The repo has a single `0016_ielts_questions.sql`, and the parts were applied from it.

## Tests known to pass
**`8826a16`, checked on 2026-11-19:**
- `npx next typegen && npx tsc --noEmit`: clean
- `npx eslint src`: clean
- `npm run build`: clean
- The Vercel preview and production builds succeeded.

**SQL suite**
- `supabase/tests/run.sh` has 17 sections, the last being "17. IELTS question types". All passed on the machine where #17 was written.
- They weren't re-run on 2026-11-19: the current Windows machine has no local Postgres.

**Cue cards on live: passed (2026-11-19).**
- In a QA centre, acting as the mentor and then the student under RLS, a library article was assigned and submitted. The student could read its 8 vocabulary words, and `my_homework_result` returned the result.
- The owner then checked the deck visually in the browser.

## Not yet verified
Checked 2026-11-20. None of these can be seen from the agent's environment: the Supabase token can't read auth settings, and Vercel and `app.linguabc.xyz` are blocked by its network. The owner has to check them in the dashboards.
- ~~AI keys in Vercel~~: **confirmed 2026-11-20.** OpenRouter is set: `ai_requests` shows a live `google/gemini-3.7-flash` call from the owner. Fish Audio is set too (a live `fish/s1` call).
- **Phone sign-in key:** whether `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) is set in Vercel. Phone sign-in needs it.
- **Domain:** whether `app.linguabc.xyz` is attached to the Vercel project as the production domain. The auth email config says it's the Site URL.
- **Custom SMTP** in the Supabase dashboard.

## Blockers and open items
**Pre-launch security blockers** (must be fixed before V1 goes live; see `SECURITY.md`):
- Unused invite codes never expire.
- Every mentor in a centre can read and write answer keys, not only the mentor of the group.

**Launch gate (owner, 2026-11-20):** V1 goes to no centre until all Base44 prototype sections exist, the library has at least 5 full reading and 5 full listening mocks plus enough homework content, and all 3 ways of creating homework work. See `V1-ROADMAP.md` → Launch gate.

**Open decisions:** target counts for library podcasts, articles, sections and passages at launch.

**Settled on 2026-11-20:** listening audio lives in a private Supabase Storage bucket and plays through signed URLs (`ARCHITECTURE.md` → Storage). The owner set `FISH_AUDIO_API_KEY` in Vercel and chose six voices (now the defaults in `src/lib/ai/fish.ts`).

**Settled on 2026-11-19:**
- Click is the first payment provider.
- V1 notifications are in-app.
- The V1 build order is in `V1-ROADMAP.md`.

**Environment:** there's no staging, so all QA happens on production.

**Documentation debt:** `README.md` is out of date. It lists migrations only up to 0008 and an `app/(workspace)/` folder that is now `app/(portal)/`. It hasn't been edited yet.

**Listening UI check passed (2026-11-20):** the owner created a B2 gap-fill listening (6 questions) with AI in Convora, and Fish Audio recorded the conversation. This was the first live Fish call.

**Mock engine part A merged and live (2026-11-20):** #22. 0018 applied; the Convora owner's auth user is the only row in `platform_admins` (checked: `am_platform_admin()` returns true as that user). Library drafts on 2026-11-20:
- **Listening Test 1:** Part 1 was written with AI and recorded by the owner. Parts 2–4 were written by Claude, are not recorded yet, and the owner records them in the editor.
- **Reading Test 1:** written by Claude, 40 questions; all-correct answers score 40/40 in the database.

Both are drafts waiting for the owner's review before publishing.

**Known marking bug:** `app.norm_answer` strips the dot from decimals, so "1.5" becomes "1 5" (two words). A gap answer with a decimal can then break its word limit. Fix it in part B.

 Live checks: section drafting works (one early failed attempt, cause unknown), and after #23 the owner confirmed voices stay steady across lines.

## Exact next task
1. **V1 step 4, in-app notifications:** built on the branch (0022 triggers; a bell in the student and parent portals; translated text). With the owner's go-ahead: apply 0022, then merge.
2. Then V1 step 5: Click payments (with a provider interface so Payme and Uzum can follow). This needs Click merchant credentials and a sandbox.
