-- =====================================================================
-- 0030: audio jobs (AI Audio Engine V2).
--
-- A recording by an open-source voice worker (Chatterbox Turbo, Chatterbox
-- 0.5B, Qwen) runs as a job, so a 7-8 minute section is not bound to the
-- web request's 300 s limit:
--
--   1. the app calls enqueue_audio_job (as the signed-in user), creates a
--      signed upload URL for the target file and sends the job to the worker;
--   2. the worker speaks it, uploads the MP3 straight to Storage with that
--      URL, and reports progress and the result to the app's webhook;
--   3. the webhook (service role only) calls audio_job_update, which checks
--      the job's secret token and that the file really is in Storage;
--   4. the editor follows the job through Realtime and uses the file.
--
-- Rules:
--   * Who may record: staff and mentors of the centre (homework), platform
--     admins (library tests and podcasts) - same as the existing buckets.
--   * Files go to the existing buckets and paths (listening-audio,
--     library-audio, library-podcasts); players and policies are unchanged.
--   * Each job has a random callback token; only its SHA-256 is stored, in
--     a table nobody can read through the API.
--   * Status only moves forward: queued -> processing -> completed |
--     needs_review | failed; needs_review -> completed | failed by a person.
--     A finished job never changes again; callbacks from an older attempt
--     are ignored; progress never goes back.
--   * The same request twice (same user, same idempotency key) returns the
--     same job, so a double click never pays or records twice.
--   * Fish recordings do not use jobs: they keep the existing direct path.
--   * Recovery: each job names the draft slot it was made for (draft_key,
--     e.g. test:<id>:s2, the stored section id) and a hash of its script, so an editor that
--     was closed finds its running or finished job again. attach_audio_job
--     marks a finished recording as put into the draft (idempotent);
--     dismiss_audio_job hides one the editor does not want.
--   * Answer-bearing QA: the app sends the answer key to the worker with the
--     job (never stored here); the worker reports only question ids that it
--     could not hear. If answers were expected and not all were checked and
--     heard, a "completed" report is stored as needs_review: a person must
--     listen before the recording is used.
-- =====================================================================

create table public.audio_jobs (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid references public.centers(id) on delete cascade,   -- null: LinguABC library
  created_by      uuid not null references auth.users(id) on delete cascade,
  purpose         text not null check (purpose in ('homework', 'test', 'podcast')),
  provider        text not null check (provider in ('chatterbox-turbo', 'chatterbox', 'qwen')),
  target_bucket   text not null check (target_bucket in ('listening-audio', 'library-audio', 'library-podcasts')),
  target_path     text not null,
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  draft_key       text not null check (draft_key ~ '^(test:[0-9a-f-]{36}:s[0-9]{1,2}|podcast:[A-Za-z0-9_-]{1,64}|homework:[A-Za-z0-9_-]{1,64})$'),
  script_hash     text not null check (script_hash ~ '^[0-9a-f]{64}$'),
  answers_expected int not null default 0 check (answers_expected between 0 and 200),
  attached_at     timestamptz,
  dismissed_at    timestamptz,
  status          text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'needs_review')),
  progress        int  not null default 0 check (progress between 0 and 100),
  segments_done   int  not null default 0 check (segments_done >= 0),
  segments_total  int  check (segments_total >= 0),
  attempts        int  not null default 1 check (attempts >= 1),
  max_attempts    int  not null default 3 check (max_attempts between 1 and 10),
  lease_until     timestamptz,
  seconds         numeric(8,2),
  qa              jsonb,
  error           text check (length(error) <= 500),
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  updated_at      timestamptz not null default now(),
  unique (created_by, idempotency_key),
  check ((purpose = 'homework') = (center_id is not null))
);
create index audio_jobs_center_idx on public.audio_jobs (center_id, created_at desc);
create index audio_jobs_active_idx on public.audio_jobs (status, lease_until) where status in ('queued', 'processing');
create index audio_jobs_reviewed_by_idx on public.audio_jobs (reviewed_by);
create index audio_jobs_draft_idx on public.audio_jobs (draft_key, created_at desc);

-- The callback token's hash, out of reach of every API role.
create table public.audio_job_tokens (
  job_id     uuid primary key references public.audio_jobs(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$')
);
alter table public.audio_job_tokens enable row level security;
revoke all on public.audio_job_tokens from public, anon, authenticated;

-- Who may make, see, review and retry a job in a scope (as for the audio buckets).
create function app.can_make_audio_job(p_center uuid, p_purpose text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_purpose = 'homework' then p_center is not null and (app.is_staff(p_center) or app.has_role(p_center, '{mentor}'))
              when p_purpose in ('test', 'podcast') then p_center is null and app.is_platform_admin()
              else false end;
$$;

-- The target file must be where that purpose's bucket expects it.
create function app.audio_job_target_ok(p_center uuid, p_purpose text, p_bucket text, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_purpose
    when 'homework' then p_bucket = 'listening-audio' and app.audio_center(p_path) = p_center
    when 'test' then p_bucket = 'library-audio'
      and p_path ~ '^tests/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$'
      and exists (select 1 from public.library_tests t where t.id = split_part(p_path, '/', 2)::uuid)
    when 'podcast' then p_bucket = 'library-podcasts' and app.podcast_audio_ok(p_path)
    else false end;
$$;

-- The draft slot must belong to the same recording as the target file.
create function app.audio_job_draft_ok(p_purpose text, p_draft_key text, p_path text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_purpose
    when 'test' then split_part(p_draft_key, ':', 2) = split_part(p_path, '/', 2)
    when 'podcast' then p_draft_key like 'podcast:%'
    when 'homework' then p_draft_key like 'homework:%'
    else false end;
$$;

revoke execute on function app.can_make_audio_job(uuid, text), app.audio_job_target_ok(uuid, text, text, text), app.audio_job_draft_ok(text, text, text) from public, anon;
grant execute on function app.can_make_audio_job(uuid, text), app.audio_job_target_ok(uuid, text, text, text), app.audio_job_draft_ok(text, text, text) to authenticated, service_role;

alter table public.audio_jobs enable row level security;
create policy audio_jobs_select on public.audio_jobs for select to authenticated
  using (app.can_make_audio_job(center_id, purpose));
revoke all on public.audio_jobs from anon, authenticated;
grant select on public.audio_jobs to authenticated;
grant select on public.audio_jobs to service_role;

create function app.touch_audio_job() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger audio_jobs_touch before update on public.audio_jobs for each row execute function app.touch_audio_job();

-- Start (or find) a job. p_token_hash: SHA-256 (hex) of the random callback token the app gives the worker.
create function public.enqueue_audio_job(
  p_center uuid, p_purpose text, p_provider text, p_bucket text, p_path text, p_idempotency_key text, p_token_hash text,
  p_draft_key text, p_script_hash text, p_answers_expected int default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.audio_jobs;
begin
  if auth.uid() is null or not app.can_make_audio_job(p_center, p_purpose) then raise exception 'forbidden'; end if;
  if p_provider not in ('chatterbox-turbo', 'chatterbox', 'qwen') then raise exception 'unknown voice engine'; end if;
  if not app.audio_job_target_ok(p_center, p_purpose, p_bucket, p_path) then raise exception 'bad target for this recording'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad token'; end if;
  if not app.audio_job_draft_ok(p_purpose, p_draft_key, p_path) then raise exception 'bad draft for this recording'; end if;

  select * into v from public.audio_jobs where created_by = auth.uid() and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v.id, 'status', v.status, 'created', false, 'target_path', v.target_path);
  end if;
  if (select count(*) from public.audio_jobs where created_by = auth.uid() and status in ('queued', 'processing')) >= 3 then
    raise exception 'Three recordings are already running. Wait for one to finish.';
  end if;

  insert into public.audio_jobs (center_id, created_by, purpose, provider, target_bucket, target_path, idempotency_key,
                                 draft_key, script_hash, answers_expected)
  values (p_center, auth.uid(), p_purpose, p_provider, p_bucket, p_path, p_idempotency_key,
          p_draft_key, p_script_hash, coalesce(p_answers_expected, 0))
  returning * into v;
  insert into public.audio_job_tokens (job_id, token_hash) values (v.id, p_token_hash);
  return jsonb_build_object('id', v.id, 'status', v.status, 'created', true, 'target_path', v.target_path);
end $$;

-- The worker's report, through the app's webhook (service role only).
create function public.audio_job_update(
  p_job uuid, p_token_hash text, p_attempt int, p_status text, p_progress int,
  p_segments_done int default null, p_segments_total int default null,
  p_seconds numeric default null, p_qa jsonb default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.audio_jobs;
begin
  select j.* into v from public.audio_jobs j
  join public.audio_job_tokens t on t.job_id = j.id
  where j.id = p_job and t.token_hash = p_token_hash
  for update of j;
  if not found then raise exception 'unknown job or token'; end if;
  if p_status not in ('processing', 'completed', 'failed', 'needs_review') then raise exception 'bad status'; end if;

  -- An older attempt's late report, or a repeat of a finished job's report: nothing to do.
  if p_attempt <> v.attempts or v.status in ('completed', 'failed', 'needs_review') then
    return jsonb_build_object('status', v.status, 'applied', false);
  end if;

  if p_status = 'processing' then
    update public.audio_jobs set status = 'processing',
      progress = greatest(progress, least(coalesce(p_progress, 0), 99)),
      segments_done = greatest(segments_done, coalesce(p_segments_done, 0)),
      segments_total = coalesce(p_segments_total, segments_total),
      started_at = coalesce(started_at, now()),
      lease_until = now() + interval '10 minutes'
    where id = v.id;
    return jsonb_build_object('status', 'processing', 'applied', true);
  end if;

  if p_status in ('completed', 'needs_review') then
    if not exists (select 1 from storage.objects where bucket_id = v.target_bucket and name = v.target_path) then
      raise exception 'the recording is not in storage';
    end if;
    -- Answer-bearing QA: expected answers must all have been checked and heard,
    -- otherwise a person reviews it (never completed automatically).
    if p_status = 'completed' and v.answers_expected > 0 and (
         coalesce((p_qa->>'answers_checked')::int, 0) < v.answers_expected
         or jsonb_typeof(p_qa->'answers_missing') is distinct from 'array'
         or jsonb_array_length(p_qa->'answers_missing') > 0) then
      p_status := 'needs_review';
    end if;
    update public.audio_jobs set status = p_status, progress = 100,
      segments_done = coalesce(p_segments_done, segments_total, segments_done),
      seconds = p_seconds, qa = p_qa, error = null, lease_until = null, finished_at = now()
    where id = v.id;
  else
    update public.audio_jobs set status = 'failed', qa = coalesce(p_qa, qa),
      error = left(coalesce(nullif(btrim(p_error), ''), 'The recording failed.'), 500), lease_until = null, finished_at = now()
    where id = v.id;
  end if;
  return jsonb_build_object('status', p_status, 'applied', true);
end $$;

-- A person listened to a recording the automatic QA flagged.
create function public.review_audio_job(p_job uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v public.audio_jobs;
begin
  select * into v from public.audio_jobs where id = p_job for update;
  if not found or auth.uid() is null or not app.can_make_audio_job(v.center_id, v.purpose) then raise exception 'forbidden'; end if;
  if v.status <> 'needs_review' then raise exception 'only a recording waiting for review can be reviewed'; end if;
  update public.audio_jobs set status = case when p_approve then 'completed' else 'failed' end,
    error = case when p_approve then null else 'Rejected after listening.' end,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = v.id;
  return case when p_approve then 'completed' else 'failed' end;
end $$;

-- Try a failed (or stalled) job again, with a new token and a new target file.
create function public.retry_audio_job(p_job uuid, p_token_hash text, p_path text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v public.audio_jobs;
begin
  select * into v from public.audio_jobs where id = p_job for update;
  if not found or auth.uid() is null or not app.can_make_audio_job(v.center_id, v.purpose) then raise exception 'forbidden'; end if;
  if not (v.status = 'failed'
          or (v.status in ('queued', 'processing') and coalesce(v.lease_until, v.created_at + interval '15 minutes') < now())) then
    raise exception 'this recording is not stopped';
  end if;
  if v.attempts >= v.max_attempts then raise exception 'no attempts left for this recording'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad token'; end if;
  if not app.audio_job_target_ok(v.center_id, v.purpose, v.target_bucket, p_path)
     or not app.audio_job_draft_ok(v.purpose, v.draft_key, p_path) then raise exception 'bad target for this recording'; end if;
  update public.audio_jobs set status = 'queued', attempts = attempts + 1, progress = 0, segments_done = 0,
    target_path = p_path, error = null, qa = null, seconds = null, lease_until = null, started_at = null, finished_at = null,
    attached_at = null, dismissed_at = null, reviewed_by = null, reviewed_at = null
  where id = v.id;
  update public.audio_job_tokens set token_hash = p_token_hash where job_id = v.id;
  return v.attempts + 1;
end $$;

-- A finished recording was put into its draft (repeat calls change nothing).
create function public.attach_audio_job(p_job uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v public.audio_jobs;
begin
  select * into v from public.audio_jobs where id = p_job for update;
  if not found or auth.uid() is null or not app.can_make_audio_job(v.center_id, v.purpose) then raise exception 'forbidden'; end if;
  if v.status <> 'completed' then raise exception 'only a completed recording can be used'; end if;
  update public.audio_jobs set attached_at = coalesce(attached_at, now()), dismissed_at = null where id = v.id;
  return v.target_path;
end $$;

-- The editor does not want this finished (or failed) recording offered again.
create function public.dismiss_audio_job(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.audio_jobs;
begin
  select * into v from public.audio_jobs where id = p_job for update;
  if not found or auth.uid() is null or not app.can_make_audio_job(v.center_id, v.purpose) then raise exception 'forbidden'; end if;
  if v.status in ('queued', 'processing') then raise exception 'this recording is still running'; end if;
  update public.audio_jobs set dismissed_at = coalesce(dismissed_at, now()) where id = v.id;
end $$;

-- Jobs whose worker went quiet are failed, so they can be retried.
create function app.expire_audio_jobs() returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.audio_jobs set status = 'failed', error = 'The voice worker stopped responding.', lease_until = null, finished_at = now()
  where status in ('queued', 'processing') and coalesce(lease_until, created_at + interval '15 minutes') < now();
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.enqueue_audio_job(uuid, text, text, text, text, text, text, text, text, int),
  public.review_audio_job(uuid, boolean), public.retry_audio_job(uuid, text, text),
  public.attach_audio_job(uuid), public.dismiss_audio_job(uuid) from public, anon;
grant execute on function public.enqueue_audio_job(uuid, text, text, text, text, text, text, text, text, int),
  public.review_audio_job(uuid, boolean), public.retry_audio_job(uuid, text, text),
  public.attach_audio_job(uuid), public.dismiss_audio_job(uuid) to authenticated;
revoke execute on function public.audio_job_update(uuid, text, int, text, int, int, int, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.audio_job_update(uuid, text, int, text, int, int, int, numeric, jsonb, text) to service_role;
revoke execute on function app.expire_audio_jobs() from public, anon, authenticated;

-- Live progress in the editor (Realtime respects the select policy).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audio_jobs') then
    alter publication supabase_realtime add table public.audio_jobs;
  end if;
end $$;

-- Every 5 minutes, where pg_cron is available (as in 0026).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-audio-jobs', '*/5 * * * *', 'select app.expire_audio_jobs()');
  end if;
end $$;
