-- Undo 0037: create_mock_session as in 0011 (staff only).
begin;
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
commit;
