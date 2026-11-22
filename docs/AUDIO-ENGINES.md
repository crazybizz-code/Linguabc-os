# Audio engines: jobs, flags, deployment and rollback

## What runs where

| Engine | How it records | Who can pick it |
|---|---|---|
| Fish Audio | Directly in the server action (`src/lib/ai/fish.ts`), as before | Everyone who records today (default) |
| Chatterbox Turbo | Job on a GPU worker (`workers/tts`, `TTS_ENGINE=chatterbox-turbo`) | LinguABC platform admins, in the Audio Studio |
| Chatterbox 0.5B | Job on a worker (`TTS_ENGINE=chatterbox`) | Platform admins |
| Qwen3-TTS | Job on a worker (`TTS_ENGINE=qwen-clone`/`qwen-custom`) | Platform admins |

Centres' homework is unchanged: it records with `AUDIO_PROVIDER` (Fish by
default) and never shows an engine choice.

## Job flow (migration 0030)

1. The admin presses "Generate audio" with a worker engine. The server action
   (`src/app/(staff)/admin/audio-jobs/actions.ts`, platform admins only)
   plans the script (`planScript`), calls `enqueue_audio_job` as the admin
   (same idempotency key = same job), makes a **signed upload URL** for the
   target file in the existing bucket, and POSTs the job to the worker
   (`/jobs`, HMAC-signed). The worker answers 202.
2. The worker speaks the plan with the usual QA (spoken-form rewrite,
   lexicon, ASR check per segment, retries, loudness), reports progress to
   `/api/audio-jobs/callback`, PUTs the MP3 with the signed URL, then reports
   `completed` (QA passed) or `needs_review` (QA flagged it) or `failed`.
3. The webhook verifies the engine's HMAC signature, the body, and the job's
   own token (only its hash is stored), then calls `audio_job_update` (service
   role only). A result is accepted only if the file is in Storage; repeats
   and older attempts are ignored; finished jobs never change.
4. The editor follows the job with Supabase Realtime (5 s poll fallback). On
   `completed` the file goes into the draft (`attach_audio_job`, at most once
   per job); on `needs_review` the admin
   listens and approves or rejects (`review_audio_job`); on `failed` they can
   retry (`retry_audio_job`, new token and file, at most 3 attempts).
   `app.expire_audio_jobs()` (pg_cron, every 5 minutes) fails jobs whose
   worker went quiet (10-minute lease, renewed by each progress report).

### Recovery (closing the editor does not lose a recording)

Every job stores its draft slot (`draft_key`: `test:<test id>:<section index>`
or `podcast:<id | new>`, checked against the target file) and `script_hash`.
When the editor opens, `recoverStudioJob` asks for the person's newest job
for that slot that is not dismissed and is not the draft's current file. A
running job is followed again; a completed one is offered ("Use this
recording", then `attach_audio_job`, which only returns the existing path);
a flagged one shows the review step; a failed one shows "Try again". If the
script changed since, the panel says so. Nothing is re-sent to the worker,
so there is no second recording and no second charge (the idempotency key
also covers draft, plan and answers). Recording anything else for the slot
dismisses the old job (`dismiss_audio_job`).

### Answer-bearing QA (IELTS tests)

The test editor sends each gap question's accepted answers with the job, as
`checks.answers: [{id: "<question number>", accepted: [...]}]` (at most 60,
5 forms, 100 characters; validated in `cleanAnswers`). They go only into the
signed request to the worker, are never stored in `audio_jobs` (only
`answers_expected`, a count) and the idempotency key uses their hash. The
worker checks the ASR transcript of the whole recording (numbers, dates,
spelled names through its normal forms) and reports `answers_checked` and
`answers_missing` **as question numbers only**; segment reasons are redacted
of script words before they leave the worker, and nothing is logged.
`audio_job_update` turns a `completed` report into `needs_review` unless
`answers_checked >= answers_expected` and `answers_missing` is an empty
list, so a recording with an unheard or unchecked answer is never used
without a person listening first. Answer keys stay where they were
(`library_test_keys`, admin-only); students' marking is unchanged.

Players are not involved: the result is an ordinary MP3 at the usual path in
`library-audio` / `library-podcasts` / `listening-audio`, saved with the
existing save actions.

## Settings

Vercel (server only):

| Variable | Meaning |
|---|---|
| `AUDIO_ENGINES` | Engines shown in the Audio Studio, e.g. `fish,chatterbox-turbo,chatterbox`. Unset = `fish` only |
| `CHATTERBOX_TURBO_WORKER_URL` / `_SECRET` | Worker base URL (https) and shared secret (32+ characters) |
| `CHATTERBOX_WORKER_URL` / `_SECRET` | Same for Chatterbox 0.5B |
| `QWEN_WORKER_URL` / `_SECRET` | Same for Qwen |
| `AUDIO_JOBS_CALLBACK_URL` | Optional; default `<site URL>/api/audio-jobs/callback` |
| `SUPABASE_SECRET_KEY` | Already set; the webhook uses it to call `audio_job_update` |

Worker: `TTS_ENGINE`, `LINGUABC_TTS_SECRET` (= the app's `*_WORKER_SECRET`),
`TTS_VOICES_DIR`, `TTS_CALLBACK_HOSTS` (the app's host), `TTS_UPLOAD_HOSTS`
(the Supabase host), `TTS_CACHE_DIR`.

## Deployment order (each step needs the owner's approval)

1. Apply migration `0029_audio_segments` and `0030_audio_jobs` (check as roles in a rolled-back transaction, as before). Go through `docs/STAGING-CHECKLIST-AUDIO.md` first.
2. Register approved reference voices (`workers/tts/VOICES.md`).
3. Build and run one worker per engine on a GPU (`workers/tts/docker/*.Dockerfile` or `modal_chatterbox.py`).
4. Set the Vercel variables above; keep `AUDIO_ENGINES=fish` until a test recording in a QA flow works, then add the worker engines.

## Rollback

| Level | Action | Effect |
|---|---|---|
| 1. Hide engines | `AUDIO_ENGINES=fish` (or unset) and redeploy | The studio shows Fish only; running jobs finish or expire; nothing else changes |
| 2. Stop a worker | Stop it, or remove its `*_WORKER_URL` | Its jobs fail after the lease; admins switch to Fish |
| 3. Close the webhook | Remove the `*_WORKER_SECRET` | Callbacks get 401; jobs expire; no data changes |
| 4. Revert the code | Revert the PR (squash merge) | `AudioPanel` is back to Fish only. `audio_jobs` stays, unused and harmless (no existing table references it) |
| 5. Remove the schema (only if wanted) | Run the SQL below | Drops the job tables and functions |

Recordings made by any engine are ordinary MP3s in the existing buckets,
referenced by tests and podcasts as before: they keep working after every
rollback level, and nothing needs to be migrated back.

```sql
-- Optional schema rollback for 0030 (owner's approval; production has no staging).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire-audio-jobs';
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'audio_jobs') then
    alter publication supabase_realtime drop table public.audio_jobs;
  end if;
end $$;
-- Tables first: their policy and trigger use the functions below.
drop table public.audio_job_tokens, public.audio_jobs;
drop function public.enqueue_audio_job(uuid, text, text, text, text, text, text, text, text, int),
  public.audio_job_update(uuid, text, int, text, int, int, int, numeric, jsonb, text),
  public.review_audio_job(uuid, boolean), public.retry_audio_job(uuid, text, text),
  public.attach_audio_job(uuid), public.dismiss_audio_job(uuid), app.expire_audio_jobs(),
  app.can_make_audio_job(uuid, text), app.audio_job_target_ok(uuid, text, text, text), app.audio_job_draft_ok(text, text, text),
  app.touch_audio_job();
```
