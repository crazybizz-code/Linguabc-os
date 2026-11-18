-- =====================================================================
-- Mock exams: scheduling a session and entering results.
--
-- A session belongs to one group. Creating it snapshots the group's active
-- students as participants (one pending result row each). Results are
-- entered per module in half bands; a result is completed once every
-- module of the session has a band, and the session follows its results
-- (scheduled -> in_progress -> completed). Completed results reach the
-- student's timeline and the family portal through existing triggers.
--
-- Examiner must be staff (owner/admin/academic manager) or the group's own
-- mentor, so whoever enters results can already see the group's students.
-- =====================================================================

create function public.create_mock_session(
  p_center       uuid,
  p_name         text,
  p_group        uuid,
  p_scheduled_at timestamptz,
  p_examiner     uuid default null,
  p_room         uuid default null,
  p_modules      public.skill[] default '{reading,listening,writing,speaking}',
  p_version      text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_group public.groups; v_id uuid;
begin
  if not app.is_staff(p_center) then perform app.forbid(); end if;
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'Enter a session name.'; end if;
  if p_scheduled_at is null then raise exception 'Choose a date and time.'; end if;
  if coalesce(cardinality(p_modules), 0) = 0
     or not (p_modules <@ '{reading,listening,writing,speaking}'::public.skill[]) then
    raise exception 'Choose at least one of Reading, Listening, Writing, Speaking.';
  end if;

  select * into v_group from public.groups where id = p_group and center_id = p_center;
  if v_group.id is null then raise exception 'Group not found.'; end if;

  if p_examiner is not null and not exists (
       select 1 from public.memberships m
       where m.id = p_examiner and m.center_id = p_center and m.status = 'active'
         and (m.role in ('owner','admin','academic_manager')
              or (m.role = 'mentor' and m.id = v_group.mentor_id))) then
    raise exception 'The examiner must be a manager or this group''s mentor.';
  end if;

  if p_room is not null and not exists (select 1 from public.rooms where id = p_room and center_id = p_center) then
    raise exception 'Room not found.';
  end if;

  insert into public.mock_sessions (center_id, group_id, name, version, modules, scheduled_at, room_id, examiner_id)
  values (p_center, p_group, trim(p_name), nullif(trim(p_version), ''),
          (select array_agg(distinct m order by m) from unnest(p_modules) m),
          p_scheduled_at, p_room, p_examiner)
  returning id into v_id;

  insert into public.mock_results (center_id, mock_session_id, student_id)
  select p_center, v_id, e.student_id
  from public.enrollments e
  where e.group_id = p_group and e.status = 'active';

  return v_id;
end $$;

-- p_records: [{"student_id": "...", "reading": 6.5, "listening": 7, "writing": null,
--              "speaking": null, "absent": false}, ...]
create function public.save_mock_results(p_session uuid, p_records jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  s public.mock_sessions; r jsonb; v_n int := 0; v_st uuid;
  v_r numeric; v_l numeric; v_w numeric; v_s numeric; v_filled int; v_absent boolean;
  v_status public.mock_result_status;
begin
  select * into s from public.mock_sessions where id = p_session;
  if s.id is null then perform app.forbid(); end if;
  if not (app.is_staff(s.center_id) or coalesce(s.examiner_id = app.my_membership(s.center_id, 'mentor'), false)) then
    perform app.forbid();
  end if;
  if s.status = 'cancelled' then raise exception 'This session was cancelled.'; end if;
  if jsonb_typeof(p_records) <> 'array' then raise exception 'records must be an array'; end if;

  for r in select * from jsonb_array_elements(p_records) loop
    v_st := (r->>'student_id')::uuid;
    v_absent := coalesce((r->>'absent')::boolean, false);
    -- bands for modules outside the session are ignored
    v_r := case when 'reading'   = any(s.modules) and not v_absent then (r->>'reading')::numeric end;
    v_l := case when 'listening' = any(s.modules) and not v_absent then (r->>'listening')::numeric end;
    v_w := case when 'writing'   = any(s.modules) and not v_absent then (r->>'writing')::numeric end;
    v_s := case when 'speaking'  = any(s.modules) and not v_absent then (r->>'speaking')::numeric end;
    v_filled := (v_r is not null)::int + (v_l is not null)::int + (v_w is not null)::int + (v_s is not null)::int;
    v_status := case when v_absent then 'absent'
                     when v_filled = cardinality(s.modules) then 'completed'
                     when v_filled > 0 then 'in_progress'
                     else 'pending' end;

    update public.mock_results
       set reading_band = v_r, listening_band = v_l, writing_band = v_w, speaking_band = v_s, status = v_status
     where mock_session_id = s.id and student_id = v_st;
    if not found then raise exception 'student % is not in this session', v_st; end if;
    v_n := v_n + 1;
  end loop;

  update public.mock_sessions set status =
    case when not exists (select 1 from public.mock_results where mock_session_id = s.id and status in ('pending','in_progress'))
              and exists (select 1 from public.mock_results where mock_session_id = s.id) then 'completed'::public.mock_status
         when exists (select 1 from public.mock_results where mock_session_id = s.id and status <> 'pending') then 'in_progress'::public.mock_status
         else 'scheduled'::public.mock_status end
  where id = s.id;

  return v_n;
end $$;

revoke execute on function public.create_mock_session(uuid, text, uuid, timestamptz, uuid, uuid, public.skill[], text) from public, anon;
revoke execute on function public.save_mock_results(uuid, jsonb) from public, anon;
grant execute on function public.create_mock_session(uuid, text, uuid, timestamptz, uuid, uuid, public.skill[], text) to authenticated;
grant execute on function public.save_mock_results(uuid, jsonb) to authenticated;
