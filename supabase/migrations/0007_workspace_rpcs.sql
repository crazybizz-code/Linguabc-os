-- =====================================================================
-- LinguABC OS — one-transaction RPCs behind the staff workspace forms
--
--   create_student  "Add student" wizard: student + parent + enrolment
--                   + first invoice, all or nothing.
--   create_group    "Create group" dialog: room (found or created),
--                   group, weekly slots and the first 12 weeks of
--                   lessons. A room or mentor clash rolls everything back.
-- =====================================================================

create function public.create_student(
  p_center uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_date_of_birth date default null,
  p_branch uuid default null,
  p_group uuid default null,
  p_monthly_fee bigint default null,
  p_discount_percent numeric default 0,
  p_due_day smallint default 5,
  p_parent_name text default null,
  p_parent_phone text default null,
  p_parent_relationship text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_student uuid; v_branch uuid := p_branch;
begin
  if not app.is_admin(p_center) then perform app.forbid(); end if;
  if coalesce(length(trim(p_full_name)), 0) < 2 then raise exception 'Enter the student''s full name.'; end if;

  if p_group is not null and v_branch is null then
    select branch_id into v_branch from public.groups where id = p_group and center_id = p_center;
  end if;

  insert into public.students (center_id, branch_id, full_name, phone, email, date_of_birth, status)
  values (p_center, v_branch, trim(p_full_name), nullif(trim(p_phone), ''), nullif(lower(trim(p_email)), ''),
          p_date_of_birth, (case when p_group is null then 'lead' else 'active' end)::public.student_status)
  returning id into v_student;

  if coalesce(trim(p_parent_name), '') <> '' then
    insert into public.guardians (center_id, student_id, full_name, phone, relationship, is_primary)
    values (p_center, v_student, trim(p_parent_name), nullif(trim(p_parent_phone), ''),
            nullif(trim(p_parent_relationship), ''), true);
  end if;

  if p_group is not null then
    perform public.enroll_student(v_student, p_group, p_monthly_fee,
                                  coalesce(p_discount_percent, 0), coalesce(p_due_day, 5::smallint));
  end if;
  return v_student;
end $$;

create function public.create_group(
  p_center uuid,
  p_name text,
  p_course uuid,
  p_branch uuid,
  p_mentor uuid default null,
  p_room_name text default null,
  p_capacity int default null,
  p_start_date date default current_date,
  p_weekdays smallint[] default '{}',
  p_start_time time default null,
  p_end_time time default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room uuid; v_group uuid; v_day smallint;
begin
  if not app.is_staff(p_center) then perform app.forbid(); end if;
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'Enter a group name.'; end if;
  if p_mentor is not null and not exists (
       select 1 from public.memberships
       where id = p_mentor and center_id = p_center and role = 'mentor' and status in ('active','invited')) then
    raise exception 'Choose a mentor from this centre.';
  end if;
  if cardinality(p_weekdays) > 0 and (p_start_time is null or p_end_time is null or p_end_time <= p_start_time) then
    raise exception 'Set a start and end time for the lessons.';
  end if;

  if coalesce(trim(p_room_name), '') <> '' then
    select id into v_room from public.rooms where branch_id = p_branch and lower(name) = lower(trim(p_room_name));
    if v_room is null then
      insert into public.rooms (center_id, branch_id, name) values (p_center, p_branch, trim(p_room_name))
      returning id into v_room;
    end if;
  end if;

  insert into public.groups (center_id, branch_id, course_id, mentor_id, room_id, name, capacity, start_date)
  values (p_center, p_branch, p_course, p_mentor, v_room, trim(p_name), p_capacity, p_start_date)
  returning id into v_group;

  foreach v_day in array p_weekdays loop
    insert into public.group_schedule_slots (center_id, group_id, weekday, start_time, end_time)
    values (p_center, v_group, v_day, p_start_time, p_end_time);
  end loop;

  if cardinality(p_weekdays) > 0 then
    perform public.generate_lessons(v_group, coalesce(p_start_date, current_date),
                                    coalesce(p_start_date, current_date) + 83);
  end if;
  return v_group;
end $$;

revoke execute on function public.create_student(uuid, text, text, text, date, uuid, uuid, bigint, numeric, smallint, text, text, text) from public, anon;
revoke execute on function public.create_group(uuid, text, uuid, uuid, uuid, text, int, date, smallint[], time, time) from public, anon;
grant execute on function public.create_student(uuid, text, text, text, date, uuid, uuid, bigint, numeric, smallint, text, text, text) to authenticated;
grant execute on function public.create_group(uuid, text, uuid, uuid, uuid, text, int, date, smallint[], time, time) to authenticated;
