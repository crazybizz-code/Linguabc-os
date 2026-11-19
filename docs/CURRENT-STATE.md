# Current state

_Last updated: 2026-11-19. Update this file at the end of every working session._

## Code
- `main` is at **`8826a16`**: "IELTS question types, server marking and vocabulary cue cards (#17)".
- Latest merged PRs:
  - #17 IELTS engine and cue cards (2026-11-19)
  - #16 Settings marked "Soon"
  - #15 Frankfurt region, loading states, owner menu
  - #14 AI usage accounting
  - #13 OpenRouter
- No open PRs except this docs PR.
- Old feature branches are still on the remote: `feat/*`, `fix/*`, `backend/v1-schema`, `frontend/auth`, `chore/env-defaults`. They're all merged.

## Production
- **Vercel:** the production deployment of `8826a16` succeeded on 2026-11-19. URL: `https://linguabc-os.vercel.app`.
- **Supabase** `qycffcuuavtlojkxrkiz` holds two centres:
  - `convora-5hqe` ("Convora"): 1 member, no academic data
  - `qa-q-centre` ("QA Questions Centre"): a QA centre that hasn't been deleted yet (see Blockers)
- 277 published library items.

## Migrations applied to production
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

**Cue cards on live (2026-11-19)**
In `qa-q-centre`, acting as the QA mentor and then the QA student under RLS:
- the mentor assigned the library article `article-e73e608a45dddf39` (homework `ba78020f-3444-4c6c-a9d5-0f4c881c7547`);
- the student submitted it (100%);
- the student can read its 8 vocabulary words;
- `my_homework_result` returns the result.

These are the page's conditions for showing the deck.

## Not yet verified
- **Visual check of the cue cards:** the deck rendering in the browser, flip, hear, Again/Got it, start over. It needs someone to sign in as `qa.q.student@linguabc.test`.
- **AI keys in Vercel:** whether `OPENROUTER_API_KEY` or `GEMINI_API_KEY` is set in production. Earlier AI checks used mock servers.
- **Phone sign-in key:** whether `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) is set in Vercel. Phone sign-in needs it.
- **Domain:** whether `app.linguabc.xyz` is attached to the Vercel project as the production domain. The auth email config says it's the Site URL.
- **Custom SMTP** in the Supabase dashboard.
- **README.md is out of date:** it lists migrations only up to 0008 and an `app/(workspace)/` folder that is now `app/(portal)/`.

## Blockers and open items
- **`qa-q-centre` is still in production**, waiting for the visual cue-card check. It holds:
  - 3 users: `qa.q.owner`, `qa.q.mentor`, `qa.q.student` (`@linguabc.test`)
  - 1 student, 1 group, 2 assignments, 2 homework, 2 submissions

  On 2026-11-19 the mentor and student accounts were given a temporary password for that check. Delete the centre and all three users once the check is done.
- No staging environment, so all QA happens on production.

## Exact next task
1. Owner signs in as the QA student and checks the cue cards on homework `ba78020f-…`.
2. Delete `qa-q-centre` with all its rows and the users `qa.q.%@linguabc.test`. Look at the rows first, and leave every other centre alone.
3. Start **week 2: Fish Audio integration and AI-generated listening sections with audio.** Decide on audio storage first (see `V1-ROADMAP.md`).
