-- =====================================================================
-- Live in-app notifications, and clearer "left a mock" notices.
--
--   * notifications joins the supabase_realtime publication, so a staff
--     member's open page hears a new row at once. Realtime applies the
--     table's RLS, so each person only receives their own.
--   * leave_mock_module names the student and their group in the notice
--     and keeps both in data for the bell to show.
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create or replace function public.leave_mock_module(p_attempt uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.mock_attempts; v_total int; v_name text; v_group text; v_session text;
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

  select st.full_name, ms.name, g.name into v_name, v_session, v_group
  from public.students st
  join public.mock_sessions ms on ms.id = a.mock_session_id
  left join public.groups g on g.id = ms.group_id
  where st.id = a.student_id;
  perform app.notify_mock_staff(a.mock_session_id,
    'A student left a mock test',
    format('%s%s left the %s test of "%s" (%s). That part was ended with a score of 0.',
           v_name, coalesce(' (' || v_group || ')', ''), initcap(a.skill::text), v_session,
           case p_reason when 'left_fullscreen' then 'left full screen' else 'left the page' end),
    jsonb_build_object('kind', 'mock_left', 'session_id', a.mock_session_id, 'student_id', a.student_id,
                       'student_name', v_name, 'group_name', v_group, 'session_name', v_session,
                       'skill', a.skill, 'reason', p_reason));
end $$;
