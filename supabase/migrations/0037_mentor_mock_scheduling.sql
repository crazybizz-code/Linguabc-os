-- 0037: mentors schedule mocks for their own groups (V1 scope 5.2).
--
-- create_mock_session (0011) allowed owner, admin and academic manager
-- only. A mentor may now create a session for a group they currently lead;
-- they become its examiner, so the existing rules (save_mock_results,
-- set_mock_tests, release_mock_results via app.can_run_mock) let them run
-- it, enter Writing/Speaking bands and release results. Nothing else
-- changes: results still reach students and parents only on release.
--
-- Rollback: supabase/rollback/0037_mentor_mock_scheduling.down.sql (the
-- 0011 body). Sessions created by mentors stay.

create or replace function public.create_mock_session(
  p_center       uuid,
  p_name         text,
  p_group        uuid,
  p_scheduled_at timestamptz,
  p_examiner     uuid default null,
  p_room         uuid default null,
  p_modules      public.skill[] default '{reading,listening,writing,speaking}',
  p_version      text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_group public.groups; v_id uuid; v_staff boolean := app.is_staff(p_center); v_me uuid := app.my_membership(p_center, 'mentor');
begin
  -- 0037: a mentor may schedule a mock for a group they lead now; they are
  -- then its examiner (so they enter and release its results).
  if not v_staff and (v_me is null or p_group is null or not exists (
       select 1 from public.groups g where g.id = p_group and g.center_id = p_center and g.mentor_id = v_me and g.status = 'active')) then
    perform app.forbid();
  end if;
  if not v_staff then p_examiner := v_me; end if;
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
