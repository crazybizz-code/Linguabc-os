-- =====================================================================
-- Mock lockdown: leaving the exam screen ends that part with 0.
--
-- The exam screen runs in full screen. If the student leaves it (Esc,
-- another tab or app, closing or reloading the page), the client calls
-- leave_mock_module: the attempt is closed at once with raw score 0 and
-- band 0 for that skill, the student cannot come back to it, and the
-- session's examiner, the group's mentor and the centre's managers get
-- an in-app notification straight away.
-- =====================================================================

alter table public.mock_attempts
  add column disqualified_at   timestamptz,
  add column disqualify_reason text check (disqualify_reason in ('left_fullscreen', 'left_page'));

-- In-app notification to the people responsible for a mock session:
-- owner, admins and academic managers, the examiner, and the group mentor.
create function app.notify_mock_staff(p_session uuid, p_title text, p_body text, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (center_id, recipient_id, channel, status, title, body, data, sent_at)
  select distinct ms.center_id, m.id, 'in_app'::public.notification_channel, 'sent'::public.notification_status,
         p_title, p_body, p_data, now()
  from public.mock_sessions ms
  join public.memberships m on m.center_id = ms.center_id and m.status = 'active'
  left join public.groups g on g.id = ms.group_id
  where ms.id = p_session
    and (m.role in ('owner','admin','academic_manager') or m.id = ms.examiner_id or m.id = g.mentor_id);
$$;
revoke execute on function app.notify_mock_staff(uuid, text, text, jsonb) from public, anon, authenticated;

-- Called by the exam screen the moment the student leaves it.
create function public.leave_mock_module(p_attempt uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.mock_attempts; v_total int; v_name text; v_session text;
begin
  select * into a from public.mock_attempts where id = p_attempt for update;
  if a.id is null or a.student_id is distinct from app.my_mock_student(a.mock_session_id) then perform app.forbid(); end if;
  if a.submitted_at is not null then return; end if;
  if p_reason not in ('left_fullscreen', 'left_page') then p_reason := 'left_page'; end if;

  select count(*) into v_total
  from public.library_tests lt, jsonb_array_elements(lt.sections) s, jsonb_array_elements(coalesce(s->'questions', '[]')) q
  where lt.id = a.test_id;

  update public.mock_attempts
     set submitted_at = now(), disqualified_at = now(), disqualify_reason = p_reason,
         raw_score = 0, total = v_total, band = 0, marks = null
   where id = a.id;
  if a.skill = 'reading' then
    update public.mock_results set reading_band = 0, reading_raw = 0
     where mock_session_id = a.mock_session_id and student_id = a.student_id;
  else
    update public.mock_results set listening_band = 0, listening_raw = 0
     where mock_session_id = a.mock_session_id and student_id = a.student_id;
  end if;
  perform app.refresh_mock_status(a.mock_session_id);

  select st.full_name, ms.name into v_name, v_session
  from public.students st, public.mock_sessions ms
  where st.id = a.student_id and ms.id = a.mock_session_id;
  perform app.notify_mock_staff(a.mock_session_id,
    'A student left a mock test',
    format('%s left the %s test of "%s" (%s). That part was ended with a score of 0.',
           v_name, initcap(a.skill::text), v_session,
           case p_reason when 'left_fullscreen' then 'left full screen' else 'left the page' end),
    jsonb_build_object('kind', 'mock_left', 'session_id', a.mock_session_id, 'student_id', a.student_id,
                       'skill', a.skill, 'reason', p_reason));
end $$;
revoke execute on function public.leave_mock_module(uuid, text) from public, anon;
grant execute on function public.leave_mock_module(uuid, text) to authenticated;

-- A removed student cannot start that part again.
create or replace function public.start_mock_module(p_session uuid, p_skill public.skill)
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
  if a.disqualified_at is not null then
    raise exception 'You were removed from this part of the mock because you left the test screen.';
  end if;
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

-- The portal shows a removed part as such.
create or replace function public.my_online_mocks()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'session_id', ms.id, 'name', ms.name, 'scheduled_at', ms.scheduled_at, 'status', ms.status,
           'released', r.released_at is not null,
           'modules', (select jsonb_agg(jsonb_build_object(
                          'skill', k.skill,
                          'ready', k.test is not null,
                          'state', case when a.disqualified_at is not null then 'removed'
                                        when a.submitted_at is not null or (a.id is not null and now() > a.deadline_at) then 'done'
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
