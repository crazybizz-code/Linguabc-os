-- =====================================================================
-- Online mocks: reading and listening taken in the app on LinguABC
-- library tests, marked in the database, released by the mentor.
--
--   * A session gets a published reading and/or listening test (staff or
--     the session's examiner choose, before anyone starts).
--   * A student starts a module: the server sets the deadline (reading 60
--     minutes; listening 40, covering the recording and 2 minutes to
--     check). Answers autosave; after the deadline nothing new is
--     accepted and the last saved answers are marked.
--   * Marking: per-question marks against the key (never sent to the
--     student), raw score out of 40, IELTS Academic band.
--   * Results go to the mentor first. Students and parents see a mock
--     result only after release_mock_results (also for hand-entered
--     results), and the timeline entry is written on release.
--
-- Also fixes answer normalisation: "1.5" stays one word and "50,000"
-- equals "50000".
-- =====================================================================

-- ---------------------------------------------------------------------
-- Answer normalisation: keep decimal points, drop thousands separators.
-- ---------------------------------------------------------------------
create or replace function app.norm_answer(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(lower(coalesce(p, '')), '([0-9]),([0-9])', '\1\2', 'g'),
                 '[^a-z0-9/''’\-\s.]', ' ', 'g'),
               '\.(?![0-9])', ' ', 'g'),
             '(^|[^0-9])\.', '\1 ', 'g'),
           '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------
-- IELTS Academic raw score (out of 40) -> band.
-- ---------------------------------------------------------------------
create function app.academic_band(p_skill text, p_raw int, p_total int)
returns numeric language sql immutable set search_path = '' as $$
  with v as (select case when coalesce(p_total, 0) <= 0 then 0
                         when p_total = 40 then greatest(p_raw, 0)
                         else round(greatest(p_raw, 0) * 40.0 / p_total)::int end as raw),
  t(skill, min_raw, band) as (values
    ('listening',39,9.0),('listening',37,8.5),('listening',35,8.0),('listening',32,7.5),('listening',30,7.0),
    ('listening',26,6.5),('listening',23,6.0),('listening',18,5.5),('listening',16,5.0),('listening',13,4.5),
    ('listening',10,4.0),('listening',8,3.5),('listening',6,3.0),('listening',4,2.5),('listening',2,2.0),('listening',1,1.0),
    ('reading',39,9.0),('reading',37,8.5),('reading',35,8.0),('reading',33,7.5),('reading',30,7.0),
    ('reading',27,6.5),('reading',23,6.0),('reading',19,5.5),('reading',15,5.0),('reading',13,4.5),
    ('reading',10,4.0),('reading',8,3.5),('reading',6,3.0),('reading',4,2.5),('reading',2,2.0),('reading',1,1.0))
  select coalesce((select t.band from t, v where t.skill = p_skill and v.raw >= t.min_raw order by t.min_raw desc limit 1), 0.0);
$$;

-- ---------------------------------------------------------------------
-- Sessions, results, attempts
-- ---------------------------------------------------------------------
alter table public.mock_sessions
  add column reading_test_id   uuid references public.library_tests(id),
  add column listening_test_id uuid references public.library_tests(id);

alter table public.mock_results
  add column released_at   timestamptz,
  add column reading_raw   int check (reading_raw between 0 and 40),
  add column listening_raw int check (listening_raw between 0 and 40);

-- The view lists r.*, which was expanded when it was created: rebuild it
-- so it carries the new columns.
drop view public.mock_result_scores;
create view public.mock_result_scores with (security_invoker = true) as
select r.*, app.overall_band(r.reading_band, r.listening_band, r.writing_band, r.speaking_band) as overall_band
from public.mock_results r;
revoke all on public.mock_result_scores from anon;
grant select on public.mock_result_scores to authenticated;

-- Results entered before this change were visible as soon as they were complete.
update public.mock_results set released_at = updated_at where status in ('completed','absent');

create table public.mock_attempts (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null,
  mock_session_id uuid not null,
  student_id      uuid not null,
  skill           public.skill not null check (skill in ('reading','listening')),
  test_id         uuid not null references public.library_tests(id),
  started_at      timestamptz not null default now(),
  deadline_at     timestamptz not null,
  answers         jsonb not null default '{}',
  submitted_at    timestamptz,
  raw_score       int,
  total           int,
  band            numeric(2,1),
  marks           jsonb,
  focus_lost      int not null default 0,
  unique (mock_session_id, student_id, skill),
  foreign key (mock_session_id, center_id) references public.mock_sessions(id, center_id) on delete cascade,
  foreign key (student_id, center_id)      references public.students(id, center_id)
);
create index mock_attempts_open_idx on public.mock_attempts (test_id) where submitted_at is null;
alter table public.mock_attempts enable row level security;
-- Students never read attempts directly (raw scores stay hidden until release).
create policy mock_attempts_select on public.mock_attempts for select to authenticated
  using (app.is_staff(center_id) or app.is_mentor_of_student(student_id)
         or exists (select 1 from public.mock_sessions ms where ms.id = mock_session_id
                    and ms.examiner_id = app.my_membership(ms.center_id, 'mentor')));
revoke all on public.mock_attempts from anon;
grant select on public.mock_attempts to authenticated;

-- Families see a mock result only once it is released.
drop policy mock_results_select on public.mock_results;
create policy mock_results_select on public.mock_results for select to authenticated
  using (app.is_staff(center_id) or app.is_mentor_of_student(student_id)
         or exists (select 1 from public.mock_sessions ms where ms.id = mock_session_id
                    and ms.examiner_id = app.my_membership(ms.center_id, 'mentor'))
         or (released_at is not null and student_id in (select app.my_student_ids())));

-- Timeline entry on release, not on completion.
create or replace function app.mock_result_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.released_at is not null and (tg_op = 'INSERT' or old.released_at is null) and new.status = 'completed' then
    perform app.add_activity(new.center_id, new.student_id, 'mock', 'Mock result',
      'Overall ' || coalesce(app.overall_band(new.reading_band, new.listening_band,
                                              new.writing_band, new.speaking_band)::text, '—'),
      null, new.mock_session_id);
  end if;
  return new;
end $$;

-- Recompute a result's status from its bands, and the session's from its results.
create function app.refresh_mock_status(p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.mock_sessions;
begin
  select * into s from public.mock_sessions where id = p_session;
  update public.mock_results r
     set status = case
           when r.status = 'absent' then 'absent'
           when ((r.reading_band is not null)::int + (r.listening_band is not null)::int
               + (r.writing_band is not null)::int + (r.speaking_band is not null)::int) = cardinality(s.modules) then 'completed'
           when coalesce(r.reading_band, r.listening_band, r.writing_band, r.speaking_band) is not null then 'in_progress'
           else 'pending' end::public.mock_result_status
   where r.mock_session_id = p_session
     and r.status is distinct from 'absent';
  update public.mock_sessions set status =
    case when not exists (select 1 from public.mock_results where mock_session_id = p_session and status in ('pending','in_progress'))
              and exists (select 1 from public.mock_results where mock_session_id = p_session) then 'completed'::public.mock_status
         when exists (select 1 from public.mock_results where mock_session_id = p_session and status <> 'pending')
              or exists (select 1 from public.mock_attempts where mock_session_id = p_session) then 'in_progress'::public.mock_status
         else 'scheduled'::public.mock_status end
  where id = p_session and status <> 'cancelled';
end $$;

-- Marks one attempt (once) and writes the band into the student's result.
create function app.finalize_attempt(p_attempt uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.mock_attempts; v_q jsonb; v_k jsonb; v_m jsonb; v_raw int; v_total int; v_band numeric;
begin
  select * into a from public.mock_attempts where id = p_attempt for update;
  if a.id is null or a.submitted_at is not null then return; end if;
  select coalesce(jsonb_agg(q order by s.o, t.o), '[]') into v_q
  from public.library_tests lt,
       jsonb_array_elements(lt.sections) with ordinality s(sec, o),
       jsonb_array_elements(coalesce(s.sec->'questions', '[]')) with ordinality t(q, o)
  where lt.id = a.test_id;
  select answers into v_k from public.library_test_keys where test_id = a.test_id;
  v_m := app.mark_map(v_q, coalesce(v_k, '{}'), a.answers);
  select coalesce(sum((x.value->>'earned')::int), 0), coalesce(sum((x.value->>'total')::int), 0)
    into v_raw, v_total from jsonb_each(v_m) x;
  v_band := app.academic_band(a.skill::text, v_raw, v_total);
  update public.mock_attempts
     set submitted_at = now(), raw_score = v_raw, total = v_total, band = v_band, marks = v_m
   where id = a.id;
  if a.skill = 'reading' then
    update public.mock_results set reading_band = v_band, reading_raw = least(v_raw, 40)
     where mock_session_id = a.mock_session_id and student_id = a.student_id;
  else
    update public.mock_results set listening_band = v_band, listening_raw = least(v_raw, 40)
     where mock_session_id = a.mock_session_id and student_id = a.student_id;
  end if;
  perform app.refresh_mock_status(a.mock_session_id);
end $$;

-- Marks every attempt of a session whose time is up.
create function app.close_expired(p_session uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.mock_attempts
           where mock_session_id = p_session and submitted_at is null and now() > deadline_at + interval '1 minute' loop
    perform app.finalize_attempt(r.id); n := n + 1;
  end loop;
  return n;
end $$;

-- The signed-in student's id in a session's centre, if they take part.
create function app.my_mock_student(p_session uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.mock_results r
  join public.students s on s.id = r.student_id
  join public.memberships m on m.id = s.membership_id
  where r.mock_session_id = p_session and m.user_id = auth.uid() and m.status = 'active'
  limit 1;
$$;

-- Test as the student sees it: no keys, no transcripts.
create function app.test_for_student(p_test uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('title', t.title, 'skill', t.skill, 'sections',
           (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'id', s->>'id', 'title', s->>'title', 'passage', s->'passage', 'audio_path', s->'audio_path',
                     'groups', coalesce(s->'groups', '[]'), 'questions', coalesce(s->'questions', '[]'))) order by o)
            from jsonb_array_elements(t.sections) with ordinality x(s, o)))
  from public.library_tests t where t.id = p_test;
$$;

revoke execute on function app.academic_band(text, int, int), app.refresh_mock_status(uuid), app.finalize_attempt(uuid),
                           app.close_expired(uuid), app.my_mock_student(uuid), app.test_for_student(uuid) from public, anon, authenticated;

-- Students may hear a library recording while their attempt on it is open.
create or replace function app.can_hear_library_audio(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin()
      or (app.is_any_staff() and app.library_audio_used(p_name)
          and exists (select 1 from public.library_tests where id = app.library_audio_test(p_name) and status = 'published'))
      or (app.library_audio_used(p_name) and exists (
            select 1 from public.mock_attempts a
            join public.students s on s.id = a.student_id
            join public.memberships m on m.id = s.membership_id
            where a.test_id = app.library_audio_test(p_name) and a.submitted_at is null
              and now() <= a.deadline_at and m.user_id = auth.uid() and m.status = 'active'));
$$;

-- ---------------------------------------------------------------------
-- Staff and examiner RPCs
-- ---------------------------------------------------------------------
create function app.can_run_mock(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mock_sessions s where s.id = p_session
                 and (app.is_staff(s.center_id) or s.examiner_id = app.my_membership(s.center_id, 'mentor')));
$$;
revoke execute on function app.can_run_mock(uuid) from public, anon;
grant execute on function app.can_run_mock(uuid) to authenticated;

create function public.set_mock_tests(p_session uuid, p_reading uuid default null, p_listening uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.mock_sessions;
begin
  select * into s from public.mock_sessions where id = p_session for update;
  if s.id is null or not app.can_run_mock(p_session) then perform app.forbid(); end if;
  if s.status in ('cancelled','completed') then raise exception 'This session is closed.'; end if;
  if p_reading is not null and (not 'reading' = any(s.modules) or not exists (
       select 1 from public.library_tests where id = p_reading and skill = 'reading' and status = 'published')) then
    raise exception 'Choose a published reading test for a session with Reading.';
  end if;
  if p_listening is not null and (not 'listening' = any(s.modules) or not exists (
       select 1 from public.library_tests where id = p_listening and skill = 'listening' and status = 'published')) then
    raise exception 'Choose a published listening test for a session with Listening.';
  end if;
  if (p_reading is distinct from s.reading_test_id and exists (select 1 from public.mock_attempts where mock_session_id = p_session and skill = 'reading'))
     or (p_listening is distinct from s.listening_test_id and exists (select 1 from public.mock_attempts where mock_session_id = p_session and skill = 'listening')) then
    raise exception 'Students have already started this test, so it can no longer be changed.';
  end if;
  update public.mock_sessions set reading_test_id = p_reading, listening_test_id = p_listening where id = p_session;
end $$;

-- Marks attempts whose time is up; called when staff open the session.
create function public.close_expired_attempts(p_session uuid)
returns int language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_run_mock(p_session) then perform app.forbid(); end if;
  return app.close_expired(p_session);
end $$;

-- Send results to students and parents (all ready ones when p_students is null).
create function public.release_mock_results(p_session uuid, p_students uuid[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not app.can_run_mock(p_session) then perform app.forbid(); end if;
  perform app.close_expired(p_session);
  update public.mock_results set released_at = now()
   where mock_session_id = p_session and released_at is null and status in ('completed','absent')
     and (p_students is null or student_id = any(p_students));
  get diagnostics n = row_count;
  return n;
end $$;

-- Hand-entered bands keep online reading/listening bands unless changed,
-- and status is recomputed the same way as for online results.
create or replace function public.save_mock_results(p_session uuid, p_records jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  s public.mock_sessions; r jsonb; v_n int := 0; v_st uuid; v_absent boolean;
begin
  select * into s from public.mock_sessions where id = p_session;
  if s.id is null or not app.can_run_mock(p_session) then perform app.forbid(); end if;
  if s.status = 'cancelled' then raise exception 'This session was cancelled.'; end if;
  if jsonb_typeof(p_records) <> 'array' then raise exception 'records must be an array'; end if;

  for r in select * from jsonb_array_elements(p_records) loop
    v_st := (r->>'student_id')::uuid;
    v_absent := coalesce((r->>'absent')::boolean, false);
    if exists (select 1 from public.mock_results where mock_session_id = s.id and student_id = v_st and released_at is not null) then
      continue;  -- released results are final
    end if;
    update public.mock_results
       set reading_band   = case when v_absent or not 'reading'   = any(s.modules) then null else (r->>'reading')::numeric end,
           listening_band = case when v_absent or not 'listening' = any(s.modules) then null else (r->>'listening')::numeric end,
           writing_band   = case when v_absent or not 'writing'   = any(s.modules) then null else (r->>'writing')::numeric end,
           speaking_band  = case when v_absent or not 'speaking'  = any(s.modules) then null else (r->>'speaking')::numeric end,
           status = case when v_absent then 'absent'::public.mock_result_status
                         when status = 'absent' then 'pending'::public.mock_result_status else status end
     where mock_session_id = s.id and student_id = v_st;
    if not found then raise exception 'student % is not in this session', v_st; end if;
    v_n := v_n + 1;
  end loop;
  perform app.refresh_mock_status(s.id);
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Student RPCs
-- ---------------------------------------------------------------------

-- The signed-in student's online mocks and the state of each module.
create function public.my_online_mocks()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'session_id', ms.id, 'name', ms.name, 'scheduled_at', ms.scheduled_at, 'status', ms.status,
           'released', r.released_at is not null,
           'modules', (select jsonb_agg(jsonb_build_object(
                          'skill', k.skill,
                          'ready', k.test is not null,
                          'state', case when a.submitted_at is not null or (a.id is not null and now() > a.deadline_at) then 'done'
                                        when a.id is not null then 'started' else 'new' end) order by k.skill desc)
                       from (values ('listening'::public.skill, ms.listening_test_id), ('reading'::public.skill, ms.reading_test_id)) k(skill, test)
                       left join public.mock_attempts a on a.mock_session_id = ms.id and a.student_id = r.student_id and a.skill = k.skill
                       where k.skill = any(ms.modules)))
         order by ms.scheduled_at desc), '[]')
  from public.mock_results r
  join public.mock_sessions ms on ms.id = r.mock_session_id
  join public.students s on s.id = r.student_id
  join public.memberships m on m.id = s.membership_id
  where m.user_id = auth.uid() and m.status = 'active' and r.status <> 'absent'
    and ms.status <> 'cancelled' and (ms.reading_test_id is not null or ms.listening_test_id is not null)
    and ms.scheduled_at > now() - interval '30 days';
$$;

-- Start (or resume) a module. Opens 15 minutes before the scheduled time
-- and stays open for 12 hours.
create function public.start_mock_module(p_session uuid, p_skill public.skill)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.mock_sessions; v_st uuid; a public.mock_attempts; v_test uuid;
begin
  select * into s from public.mock_sessions where id = p_session;
  v_st := app.my_mock_student(p_session);
  if s.id is null or v_st is null then perform app.forbid(); end if;
  if p_skill not in ('reading','listening') or not p_skill = any(s.modules) then raise exception 'This module is not part of the mock.'; end if;
  if s.status = 'cancelled' then raise exception 'This mock was cancelled.'; end if;
  if exists (select 1 from public.mock_results where mock_session_id = p_session and student_id = v_st and status = 'absent') then
    raise exception 'You are marked absent for this mock.';
  end if;
  v_test := case when p_skill = 'reading' then s.reading_test_id else s.listening_test_id end;
  if v_test is null then raise exception 'Your mentor has not chosen the test yet.'; end if;

  select * into a from public.mock_attempts where mock_session_id = p_session and student_id = v_st and skill = p_skill;
  if a.id is null then
    if now() < s.scheduled_at - interval '15 minutes' then raise exception 'This mock has not started yet.'; end if;
    if now() > s.scheduled_at + interval '12 hours' then raise exception 'This mock has closed.'; end if;
    insert into public.mock_attempts (center_id, mock_session_id, student_id, skill, test_id, deadline_at)
    values (s.center_id, p_session, v_st, p_skill, v_test,
            now() + case when p_skill = 'reading' then interval '60 minutes' else interval '40 minutes' end)
    returning * into a;
    perform app.refresh_mock_status(p_session);
  elsif a.submitted_at is not null or now() > a.deadline_at + interval '1 minute' then
    perform app.finalize_attempt(a.id);
    raise exception 'You have already finished this part of the mock.';
  end if;

  return jsonb_build_object('attempt_id', a.id, 'skill', a.skill, 'started_at', a.started_at,
                            'deadline_at', a.deadline_at, 'server_now', now(), 'answers', a.answers,
                            'test', app.test_for_student(a.test_id));
end $$;

-- Autosave. Refused once time is up.
create function public.save_mock_answers(p_attempt uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.mock_attempts;
begin
  select * into a from public.mock_attempts where id = p_attempt for update;
  if a.id is null or a.student_id is distinct from app.my_mock_student(a.mock_session_id) then perform app.forbid(); end if;
  if a.submitted_at is not null then raise exception 'This part is already submitted.'; end if;
  if now() > a.deadline_at + interval '30 seconds' then raise exception 'Time is up.'; end if;
  if jsonb_typeof(coalesce(p_answers, '{}')) <> 'object' or length(p_answers::text) > 50000 then raise exception 'Invalid answers.'; end if;
  update public.mock_attempts set answers = p_answers where id = a.id;
end $$;

-- Submit. Answers sent after the deadline (plus a short grace) are ignored;
-- the last autosaved answers are marked instead.
create function public.submit_mock_module(p_attempt uuid, p_answers jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.mock_attempts;
begin
  select * into a from public.mock_attempts where id = p_attempt for update;
  if a.id is null or a.student_id is distinct from app.my_mock_student(a.mock_session_id) then perform app.forbid(); end if;
  if a.submitted_at is not null then return; end if;
  if p_answers is not null and now() <= a.deadline_at + interval '30 seconds'
     and jsonb_typeof(p_answers) = 'object' and length(p_answers::text) <= 50000 then
    update public.mock_attempts set answers = p_answers where id = a.id;
  end if;
  perform app.finalize_attempt(a.id);
end $$;

-- The exam screen reports leaving full screen or switching tabs.
create function public.report_mock_focus(p_attempt uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.mock_attempts set focus_lost = focus_lost + 1
   where id = p_attempt and submitted_at is null
     and student_id = app.my_mock_student(mock_session_id);
end $$;

revoke execute on function public.set_mock_tests(uuid, uuid, uuid), public.close_expired_attempts(uuid),
                           public.release_mock_results(uuid, uuid[]), public.my_online_mocks(),
                           public.start_mock_module(uuid, public.skill), public.save_mock_answers(uuid, jsonb),
                           public.submit_mock_module(uuid, jsonb), public.report_mock_focus(uuid) from public, anon;
grant execute on function public.set_mock_tests(uuid, uuid, uuid), public.close_expired_attempts(uuid),
                          public.release_mock_results(uuid, uuid[]), public.my_online_mocks(),
                          public.start_mock_module(uuid, public.skill), public.save_mock_answers(uuid, jsonb),
                          public.submit_mock_module(uuid, jsonb), public.report_mock_focus(uuid) to authenticated;
