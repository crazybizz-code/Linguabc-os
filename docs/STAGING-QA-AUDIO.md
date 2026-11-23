# Audio jobs: isolated QA environment and results (PR #33)

There is no staging Supabase project. The Vercel Preview of this PR uses the
same Supabase variables as production, so it was **not** used for QA: signing
in there would mean production data, and 0029/0030 are not applied there.
Instead, everything below ran on a throwaway local stack with no connection
to production.

## The isolated environment (how to rebuild it)

| Part | What was used |
|---|---|
| Supabase | `supabase start` (CLI 2.58.5) in a scratch project, Postgres 17.6, Auth, Realtime, Storage, PostgREST, Kong. Images from Docker Hub (`SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io`). In a sandbox without IPv6 the Realtime image must listen on IPv4: rebuild it locally with `socket_opts: [:inet]` in `runtime.exs` (local only) |
| Migrations | 0001–0028 at start (= production), then 0029 and 0030 applied by hand with `psql -1 -f`, as the production rollout would |
| Data | QA users `qa.admin@linguabc.test`, `qa.admin2@linguabc.test` (platform admins), `qa.owner@linguabc.test` (centre owner only), centres `qa-audio`, `qa-audio-2`, `qa-owner`, one listening test with three gap questions (price, date, spelled name) |
| App | `npm run build && next start` with the local Supabase URL and keys, `AUDIO_ENGINES=fish,chatterbox-turbo`, `CHATTERBOX_TURBO_WORKER_URL=https://127.0.0.1:8443`, a 48-character secret, `NODE_EXTRA_CA_CERTS` for the local certificate, a dummy Fish key whose API host points nowhere (Fish was never called) |
| Worker | `workers/tts` HTTP app with the fake engine (deterministic tones, ASR reads back what was said), slowed to 2–6 s per part, a switch that makes parts fail, HTTPS with a self-signed certificate, `TTS_CALLBACK_HOSTS=localhost`, `TTS_UPLOAD_HOSTS=127.0.0.1` |
| Browser | Playwright Chromium, the editor in Uzbek (owner locale) |

What this cannot show: a real GPU worker (voice quality, real ASR, speed), a
real Supabase project's network, Vercel's runtime, and the production
Realtime quota. Those stay on the staging checklist.

## Results (2026-11-22)

| # | Check | Result |
|---|---|---|
| 1 | 0029 + 0030 apply on Supabase Postgres 17 after 0028 (`psql -1`) | PASS: `expire-audio-jobs` cron added, `audio_jobs` in `supabase_realtime`, `audio-segments` private |
| 2 | Rollback SQL (docs/AUDIO-ENGINES.md) on the same stack | PASS: 0 job tables, 0 job functions, cron and publication entries gone, `payment-reminders` cron and other data intact; 0030 then re-applied cleanly |
| 3 | Engine selector (platform admin) | PASS: Fish Audio / Chatterbox Turbo; voices from the worker's `/health` |
| 4 | Generate → progress | PASS: 1% → 25% → 50% → 75% → 99%, "4 qismdan n tasi", over the Realtime websocket |
| 5 | Signed upload URL | PASS: worker PUT 200; reusing the URL 400; tampered token 400; private test audio not public |
| 6 | HMAC callback | PASS: no engine header / unknown engine / wrong secret / body changed / 10-minute-old timestamp / no signature → 401; malformed → 400; wrong job token → 404; over 64 KB → 413; job row unchanged |
| 7 | Realtime isolation | PASS: platform admin got the update, a centre owner subscribed to the same table got nothing; payload has no answer text |
| 8 | Recovery: flagged job after reopening | PASS: "avval boshlangan yozuv topildi", review box with the problem |
| 9 | Reject → Try again | PASS: failed, then attempt 2 completed, all answers heard, attached |
| 10 | Recovery: completed but draft not saved | PASS: "Shu yozuvni ishlatish" offered; after use and save, reopening offers nothing |
| 11 | Recovery: tab closed while running (14%) | PASS: reopened, progress continued, finished recording offered (not attached by itself), "earlier version of the script" warning shown |
| 12 | Dismiss | PASS: not offered again after reopening |
| 13 | Approve | PASS: flagged as question 3 only, approved, attached, reviewer recorded |
| 14 | Worker failure → Try again | PASS: error shown, retry ran attempt 2 |
| 15 | Second platform admin | PASS: the first admin's job is not offered to them |
| 16 | Centre owner (not platform admin) | PASS: `/admin/tests/...` shows the not-found page (streamed, HTTP 200); homework has no engine selector |
| 17 | New podcast (unsaved) recovery | PASS: found again under `podcast:new`, offered when finished |
| 18 | Answers and script never stored or logged | PASS: no answer or script words in any `audio_jobs` row, the app log or the worker log |
| 19 | Flags off (`AUDIO_ENGINES` unset) | PASS: no engine selector, no job requests on load, no worker contact; Generate is the existing Fish path |
| 20 | Fish recording while a worker engine is on | NOT TESTED (no Fish key in the isolated environment) |
| 21 | Three-running limit in the browser | NOT TESTED in the browser (covered by the SQL suite) |
| 22 | Real GPU worker, real ASR, real voices | NOT TESTED (no paid GPU) |
| 23 | Supabase cloud project, Vercel runtime | NOT TESTED (no staging project) |

## Bugs found and fixed on the branch

1. **Date answers flagged wrongly:** an accepted "23rd March" did not match the
   spoken "the 23rd of March", so a correct recording went to review. Answer
   matching now treats "23 March", "23rd March", "March 23" and "the 23rd of
   March" as the same date (`workers/tts/linguabc_tts/qa.py`, test added).
2. **A removed file could be offered:** a Fish re-record deletes the previous
   file; a job whose file was replaced could have been offered again on
   reopening. Recovery now checks that the file exists and dismisses the job if not.
3. **Recovery bound to the section index:** it now uses the stored section
   id (`s1`…`s4`, the same id the test's transcripts use); `draft_key` is
   `test:<test id>:s<n>` and a retry cannot move a recording into another test
   (SQL test, mutation-checked).
4. **Retry kept the old reviewer:** `retry_audio_job` now clears `reviewed_by` / `reviewed_at`.
5. **Rejected recordings stayed in Storage:** Reject now removes the file (it can never have been attached).
6. **English text in the Uzbek review box:** the answer check is shown as
   "Yozuvda eshitilmagan javoblar: 3-savollar" (ru as well).
7. **"Dismiss" and "Close" had the same Uzbek label ("Yopish"):** "Dismiss" is now "Kerak emas".
8. **Job code ran with flags off:** the editor asked for recovery even with Fish only; now nothing about jobs runs unless a worker engine is enabled.

## Production state (checked read-only)

- Supabase `qycffcuuavtlojkxrkiz`: migrations up to `0028_practice`; 0029 and 0030 are **not** applied.
- Code defaults: `AUDIO_ENGINES` unset = Fish only; worker engines need a URL **and** a secret; `AUDIO_SEGMENT_CACHE` unset = cache on, but the code speaks without it when 0029 is missing (tested).
- Vercel environment variables could not be read from this session: the owner should confirm that Production and Preview have no `AUDIO_ENGINES`, `*_WORKER_URL` or `*_WORKER_SECRET`.
