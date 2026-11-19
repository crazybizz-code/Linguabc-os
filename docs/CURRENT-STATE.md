# Current state

_Last updated: 2026-11-19. Update this file at the end of every working session._

## Code
- `main`: the last feature merge is **`8826a16`**, "IELTS question types, server marking and vocabulary cue cards (#17)". It's followed by docs-only commits: `4f02d1c` (#18, project memory) and this state update (#19).
- Latest merged PRs:
  - #19 docs: current state after QA cleanup
  - #18 docs: project memory (`CLAUDE.md`, `docs/`)
  - #17 IELTS engine and cue cards
  - #16 Settings marked "Soon"
  - #15 Frankfurt region, loading states, owner menu
- **In progress: Week 2, Fish Audio / AI listening**, on branch `claude/optimistic-mccarthy-d1hduu` (not merged, no PR yet).
  - Migration `0017_listening_audio.sql`, `src/lib/audio/` (Fish client, MP3 checks, storage), the generate button and player on the assignment page, the student player and transcript after submitting.
  - **0017 is not applied to production.** It needs the owner's go-ahead.
- Old feature branches are still on the remote: `feat/*`, `fix/*`, `docs/*`, `backend/v1-schema`, `frontend/auth`, `chore/env-defaults`. They're all merged.

## Production
- **Vercel:** the production deployment of `8826a16` succeeded on 2026-11-19. URL: `https://linguabc-os.vercel.app`.
- **Supabase** `qycffcuuavtlojkxrkiz` holds **one centre**: `convora-5hqe` ("Convora"), with 1 member and no academic data. There's 1 auth user, Convora's.
- 277 published library items.
- **No QA centres or QA users are left.** `qa-q-centre` and its users `qa.q.owner`, `qa.q.mentor` and `qa.q.student` (`@linguabc.test`) were deleted on 2026-11-19, after the cue-card check.
  - Convora's data fingerprint was the same before and after.
  - The append-only `audit_log` keeps 15 rows for the deleted QA centre, plus 68 from earlier QA centres. They point to centre ids that no longer exist. That's expected and harmless.

## Migrations applied to production
`0001`–`0015`, and `0016` applied as three parts: `0016_ielts_questions_part1`, `_part2` and `_part3`. The repo has a single `0016_ielts_questions.sql`, and the parts were applied from it.

## Tests known to pass
**`8826a16`, checked on 2026-11-19:**
- `npx next typegen && npx tsc --noEmit`: clean
- `npx eslint src`: clean
- `npm run build`: clean
- The Vercel preview and production builds succeeded.

**SQL suite**
- On the Week 2 branch (2026-11-19, local Postgres 16): all 18 sections passed, including the new "18. listening audio".
- `supabase/tests/run.sh` has 17 sections, the last being "17. IELTS question types". All passed on the machine where #17 was written.
- They weren't re-run on 2026-11-19: the current Windows machine has no local Postgres.

**Cue cards on live: passed (2026-11-19).**
- In a QA centre, acting as the mentor and then the student under RLS, a library article was assigned and submitted. The student could read its 8 vocabulary words, and `my_homework_result` returned the result.
- The owner then checked the deck visually in the browser.

## Not yet verified
- **AI keys in Vercel:** whether `OPENROUTER_API_KEY` or `GEMINI_API_KEY` is set in production. Earlier AI checks used mock servers.
- **Phone sign-in key:** whether `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) is set in Vercel. Phone sign-in needs it.
- **Domain:** whether `app.linguabc.xyz` is attached to the Vercel project as the production domain. The auth email config says it's the Site URL.
- **Custom SMTP** in the Supabase dashboard.

## Blockers and open items
**Pre-launch security blockers** (must be fixed before V1 goes live; see `SECURITY.md`):
- Unused invite codes never expire.
- Every mentor in a centre can read and write answer keys, not only the mentor of the group.

**Open decisions**
- Fish Audio voices (`FISH_AUDIO_VOICES`). Until they're set, one default voice reads every speaker.

**Settled on 2026-11-19:**
- Listening audio lives in the private Supabase Storage bucket `listening-audio`, played through 1-hour signed links (`ARCHITECTURE.md` → Storage). V1 builds only centre audio; shared library audio comes later.
- Fish Audio model `s2.1-pro-free`, through the API key now set in Vercel. The same model is to be used for library enrichment, mocks and homework.
- Audio limits: 10 generations per user per hour, 30 per centre per day.
- Click is the first payment provider.
- V1 notifications are in-app.
- The V1 build order is in `V1-ROADMAP.md`.

**Environment:** there's no staging, so all QA happens on production.

**Documentation debt:** `README.md` is out of date. It lists migrations only up to 0008 and an `app/(workspace)/` folder that is now `app/(portal)/`. It hasn't been edited yet.

## Exact next task
**Week 2: Fish Audio / AI listening, finishing.**
1. Owner reviews the branch; open a PR into `main`.
2. With the owner's go-ahead, apply `0017` to production.
3. QA in a `qa-*` centre with the real Fish Audio key: generate one short listening, play it as a student, check another centre is refused. Then delete the centre, its users and its `centres/<id>/` folder in the bucket.
4. Choose voices and set `FISH_AUDIO_VOICES` in Vercel.
