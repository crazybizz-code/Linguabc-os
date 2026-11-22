# Staging checklist: audio segments (0029) and audio jobs (0030)

Run this before migrations 0029/0030 reach production. Production has no
staging today, so "staging" means a **separate Supabase project** (or a
Supabase branch) plus a Vercel preview deployment pointed at it, and one
worker on a free or local machine (CPU is fine; nothing here needs a paid
GPU). Every step needs the owner's approval; nothing below touches
`qycffcuuavtlojkxrkiz`.

Mark each box with the result and who checked it.

## 0. Set-up

- [ ] Staging Supabase project created; `supabase/migrations/0001…0028` applied; a QA centre (`qa-*` slug, `qa.*@linguabc.test` users) and one platform admin exist.
- [ ] Vercel preview env: staging `NEXT_PUBLIC_SUPABASE_URL` / key, `SUPABASE_SECRET_KEY`, `AUDIO_ENGINES=fish,chatterbox-turbo`, `CHATTERBOX_TURBO_WORKER_URL` (https), `CHATTERBOX_TURBO_WORKER_SECRET` (32+ random characters), `AUDIO_JOBS_CALLBACK_URL=<preview URL>/api/audio-jobs/callback`.
- [ ] Worker: `TTS_ENGINE=chatterbox-turbo`, `LINGUABC_TTS_SECRET` = the same secret, `TTS_CALLBACK_HOSTS=<preview host>`, `TTS_UPLOAD_HOSTS=<staging project>.supabase.co`, approved voices in `TTS_VOICES_DIR`. `GET /health` lists the voices.

## 1. Migration 0029 (segment cache)

- [ ] Applies without error; `audio_segments` and the `audio-segments` bucket exist and are private.
- [ ] As a student and a parent: `select * from audio_segments` returns 0 rows; storage objects in `audio-segments` are not readable.
- [ ] Record the same Fish homework script twice: the second time reuses segments (Fish usage does not grow) and the audio plays.
- [ ] Existing listening homework and library tests still play (signed URLs unchanged).

## 2. Migration 0030 (jobs)

- [ ] Applies without error. `\d audio_jobs` shows `draft_key`, `script_hash`, `answers_expected`, `attached_at`, `dismissed_at`.
- [ ] `select * from cron.job where jobname = 'expire-audio-jobs'` has one row (every 5 minutes).
- [ ] As `authenticated` (any role): `select * from audio_job_tokens` is denied; `audio_job_update(...)` is denied.
- [ ] As a mentor of centre A: no rows for centre B or for library (`center_id is null`) jobs. As owner of centre B: no rows of centre A.
- [ ] `supabase/tests/run.sh` section 30 was green on the same commit.

## 3. Supabase Realtime

- [ ] `select * from pg_publication_tables where tablename = 'audio_jobs'` has one row.
- [ ] In the Audio Studio, start a job: the progress bar moves without reloading (Realtime); in DevTools, block the websocket and check the 5-second poll still updates it.
- [ ] Signed in as a centre mentor in another browser, subscribe to `audio_jobs` (console): no events for library jobs arrive (RLS on Realtime).

## 4. Signed upload URL

- [ ] The worker's PUT goes to `…/storage/v1/object/upload/sign/library-audio/tests/<test id>/<uuid>.mp3?token=…` and returns 200.
- [ ] Reusing the same signed URL a second time fails (no overwrite: `x-upsert: false`).
- [ ] A worker with `TTS_UPLOAD_HOSTS` set to another host refuses the job (400).
- [ ] The file is in the right bucket and path; podcasts in `library-podcasts/podcasts/…` (public), tests in `library-audio` (private).

## 5. HMAC webhook (`/api/audio-jobs/callback`)

- [ ] A correct report → 200, the job row changes.
- [ ] Wrong secret, body changed after signing, timestamp older than 5 minutes, missing headers → 401, no change.
- [ ] Correct signature but wrong job token → 404, no change. Body over 64 KB → 413.
- [ ] `completed` before the file exists → 409, the worker retries, then 200.
- [ ] A repeated `completed`, a late `failed` and a report from an older attempt change nothing (`applied: false`).
- [ ] Vercel function logs show no script text, no answers and no token.

## 6. Browser Audio Studio

- [ ] As a platform admin, test editor (listening): the engine list shows Fish and Chatterbox Turbo; voices come from the worker.
- [ ] Fish still records directly as before (no job row).
- [ ] Chatterbox Turbo: progress, then the file goes into the section; Save draft; the student-side player plays it.
- [ ] A centre owner, mentor or student never sees the engine choice; homework still records with Fish.
- [ ] Three jobs running: a fourth is refused with the friendly message.
- [ ] Podcast editor: the same, with seconds filled in from the recording.

## 7. Job recovery

- [ ] Start a job and close the tab at ~30%. Reopen the test: "Found a recording started earlier" and the progress continues.
- [ ] Close the tab again and wait until it finishes. Reopen: "This recording finished while the page was closed" with the player; "Use this recording" puts it in the section; Save draft.
- [ ] Reopen once more: nothing is offered (the draft holds that file).
- [ ] The worker received the job **once** (worker log / `jobs-seen.json`) and admin AI usage shows **one** `chatterbox-turbo/job` entry; Storage has one file.
- [ ] Press "Use this recording" twice (two tabs): the same path both times, `attached_at` unchanged.
- [ ] Change the script after the job started, then reopen: the panel says it was made from an earlier version; after using it, the "script changed" warning shows.
- [ ] Dismiss a finished recording: it is not offered again. Record with Fish instead: the old job is not offered again.
- [ ] A job that failed while the page was closed shows "Try again" (new attempt, same job) and "Dismiss".
- [ ] A new podcast (not saved): the job is found again under "new"; after saving, the podcast's own slot is used.
- [ ] As another platform admin: the first admin's jobs are not offered (recovery is per person).

## 8. IELTS answer-bearing QA

- [ ] Listening part with gap questions whose answers are said in the script (a price "£185", a date "23rd March", a spelled name "S-M-Y-T-H-E", a time "7:45", a postcode). Record: `completed`, and `qa.answers_checked` equals the number of gap questions, `answers_missing = []`.
- [ ] Change one answer in the key to a word that is not in the script and record again: `needs_review`, the panel lists "1 answer(s) not heard: questions N" (a number, never the answer); it is not put into the section until approved.
- [ ] A worker that does not report `answers_checked` (old version) → `needs_review`, never `completed`.
- [ ] `select qa from audio_jobs` and the browser network tab (server action responses, Realtime payloads) contain no answer text and no script text.
- [ ] The worker's output (container / uvicorn log) contains no answers: search it for one answer and one script sentence.
- [ ] As a student: the test still marks in Postgres as before; `library_test_keys` / `assignment_keys` stay unreadable; the listening script is shown only after submitting.

## 9. Rollback (rehearse on staging)

- [ ] Level 1: `AUDIO_ENGINES=fish`, redeploy: the studio shows Fish only; existing recordings play.
- [ ] Level 2/3: stop the worker / remove its secret: running jobs fail after the 10-minute lease (cron); callbacks get 401.
- [ ] Level 4: revert the PR on a preview: Audio Studio is Fish-only; `audio_jobs` stays unused.
- [ ] Level 5: run the rollback SQL in `docs/AUDIO-ENGINES.md`: tables, functions, cron job and publication entry are gone; tests, podcasts and their MP3s are unchanged.
- [ ] 0029 rollback (if needed): Fish records without the cache (`AUDIO_SEGMENT_CACHE` off), then, only if wanted, drop `audio_segments` and the `audio-segments` bucket (write and review that SQL first; no other table references them).

## Sign-off

| Area | Result | Checked by | Date |
|---|---|---|---|
| 0029 | | | |
| 0030 | | | |
| Realtime | | | |
| Signed upload | | | |
| Webhook | | | |
| Audio Studio | | | |
| Recovery | | | |
| Answer QA | | | |
| Rollback | | | |

Only after every row is green: the owner approves applying 0029 and 0030 to production.
