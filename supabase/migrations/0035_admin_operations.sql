-- 0035: everyday admin changes that had no workflow.
--   * edit a student's details; add or edit a parent/guardian;
--   * take a student out of a group, or move them to another group;
--   * change a group (name, mentor, room, capacity) and its weekly timetable;
--   * cancel or move one lesson.
-- All are security definer RPCs that re-check the role, as before:
-- personal data and enrolments: owner/admin (app.is_admin); groups and
-- lessons: owner/admin/academic manager (app.is_staff). Mentor and room
-- clashes are still refused by the lessons exclusion constraints, with a
-- readable "schedule conflict" message. Lessons that already have
-- attendance are never moved, cancelled or deleted.
--
-- Transfers and billing: a transferred enrolment records where it came from
-- (enrollments.transferred_from). app.issue_invoice (0008) now skips a
-- month that is already billed (open invoice, paid or not) anywhere along
-- that chain, so neither the transfer nor a later monthly billing run can
-- bill the same student twice for one month. Void invoices do not count.
--
-- Rollback: supabase/rollback/0035_admin_operations.down.sql (drops the
-- functions and the column, restores app.issue_invoice from 0008; data
-- written with the functions stays).

create function app.centre_local_date(p_center uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.centers where id = p_center), 'Asia/Tashkent'))::date;
$$;
revoke execute on function app.centre_local_date(uuid) from public, anon, authenticated;

create function app.clash_message(p_when timestamptz, p_tz text) returns text
language sql stable set search_path = '' as $$
  select format('schedule conflict on %s: room or mentor already booked',
                to_char(p_when at time zone coalesce(p_tz, 'Asia/Tashkent'), 'Dy DD Mon HH24:MI'));
$$;

alter table public.enrollments add column transferred_from uuid;
alter table public.enrollments add constraint enrollments_transferred_from_fkey
  foreign key (transferred_from, center_id) references public.enrollments(id, center_id);

-- Is this month already billed for this place in a group, counting the
-- enrolments it was transferred from (any number of hops)?
create function app.period_billed_via_transfer(p_enrollment uuid, p_period date)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive chain(id, hops) as (
    select transferred_from, 1 from public.enrollments where id = p_enrollment and transferred_from is not null
    union all
    select e.transferred_from, c.hops + 1 from chain c join public.enrollments e on e.id = c.id
    where e.transferred_from is not null and c.hops < 50
  )
  select exists (select 1 from public.invoices i join chain c on c.id = i.enrollment_id
                 where i.period = date_trunc('month', p_period)::date and i.status = 'open');
$$;
revoke execute on function app.period_billed_via_transfer(uuid, date) from public, anon, authenticated;

-- 0008's app.issue_invoice, plus: no invoice for a month already billed
-- before a transfer.
create or replace function app.issue_invoice(p_enrollment uuid, p_period date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_e public.enrollments; v_id uuid; v_period date := date_trunc('month', p_period)::date;
begin
  select * into v_e from public.enrollments where id = p_enrollment;
  if app.period_billed_via_transfer(p_enrollment, v_period) then return null; end if;
  insert into public.invoices (center_id, student_id, enrollment_id, period, amount, due_date)
  values (v_e.center_id, v_e.student_id, v_e.id, v_period,
          round(v_e.monthly_fee * (100 - v_e.discount_percent) / 100)::bigint,
          greatest(v_period + (v_e.due_day - 1), v_e.start_date))
  on conflict (enrollment_id, period) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------- students
create function public.update_student(p_student uuid, p_full_name text, p_phone text, p_email text,
                                      p_date_of_birth date, p_branch uuid, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_center uuid;
begin
  select center_id into v_center from public.students where id = p_student for update;
  if v_center is null or not app.is_admin(v_center) then perform app.forbid(); end if;
  if coalesce(length(trim(p_full_name)), 0) < 2 then raise exception 'Enter the student''s full name.'; end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch and center_id = v_center) then
    perform app.forbid();
  end if;
  if p_email is not null and trim(p_email) <> '' and trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email or leave it empty.';
  end if;
  if p_date_of_birth is not null and (p_date_of_birth > current_date or p_date_of_birth < date '1920-01-01') then
    raise exception 'Check the date of birth.';
  end if;
  update public.students
  set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''), email = nullif(lower(trim(p_email)), ''),
      date_of_birth = p_date_of_birth, branch_id = p_branch, notes = nullif(trim(p_notes), '')
  where id = p_student;
end $$;

-- Add (p_guardian null) or edit a parent/guardian. Linking an existing
-- parent login to another child is attach_guardian_to_parent (0031).
create function public.save_guardian(p_student uuid, p_guardian uuid, p_full_name text, p_phone text,
                                     p_relationship text, p_is_primary boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_center uuid; v_id uuid := p_guardian;
begin
  select center_id into v_center from public.students where id = p_student;
  if v_center is null or not app.is_admin(v_center) then perform app.forbid(); end if;
  if coalesce(length(trim(p_full_name)), 0) < 2 then raise exception 'Enter the parent''s name.'; end if;
  if p_relationship is not null and p_relationship not in ('mother','father','guardian','other') then
    raise exception 'Choose a relationship.';
  end if;
  if coalesce(p_is_primary, false) then
    update public.guardians set is_primary = false where student_id = p_student and id is distinct from p_guardian;
  end if;
  if v_id is null then
    insert into public.guardians (center_id, student_id, full_name, phone, relationship, is_primary)
    values (v_center, p_student, trim(p_full_name), nullif(trim(p_phone), ''), p_relationship,
            coalesce(p_is_primary, false) or not exists (select 1 from public.guardians where student_id = p_student))
    returning id into v_id;
  else
    update public.guardians
    set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''), relationship = p_relationship,
        is_primary = coalesce(p_is_primary, is_primary)
    where id = v_id and student_id = p_student;
    if not found then perform app.forbid(); end if;
  end if;
  return v_id;
end $$;

-- ----------------------------------------------------------- enrolments
-- Take a student out of a group. 'dropped' = left, 'completed' = finished
-- the course, 'paused' = a break. Invoices already issued stay (void one on
-- the Payments page if it should not be paid); no new ones are issued.
-- A student with no active group left becomes 'left' / 'graduated' /
-- 'paused' to match, so they drop out of rosters and parent views of the
-- group.
create function public.end_enrollment(p_enrollment uuid, p_status text, p_end_date date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.enrollments%rowtype; v_group text;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if e.id is null or not app.is_admin(e.center_id) then perform app.forbid(); end if;
  if e.status <> 'active' then raise exception 'This enrolment is not active.'; end if;
  if p_status not in ('dropped','completed','paused') then raise exception 'Choose why the student is leaving the group.'; end if;
  if p_end_date is null or p_end_date < e.start_date then raise exception 'The end date is before the start date.'; end if;
  update public.enrollments set status = p_status::public.enrollment_status, end_date = p_end_date where id = e.id;
  select name into v_group from public.groups where id = e.group_id;
  if not exists (select 1 from public.enrollments where student_id = e.student_id and status = 'active') then
    update public.students
    set status = case p_status when 'completed' then 'graduated' when 'paused' then 'paused' else 'left' end::public.student_status
    where id = e.student_id and status in ('active','paused');
  end if;
  perform app.add_activity(e.center_id, e.student_id, 'enrollment',
    case p_status when 'completed' then 'Finished the group' when 'paused' then 'Paused' else 'Left the group' end,
    concat_ws(' — ', v_group, nullif(trim(p_reason), '')), app.my_staff_membership(e.center_id), e.id);
end $$;

-- Move a student to another group in one step: the old enrolment ends,
-- the new one starts on the same date with the same fee terms (or the new
-- course's fee). No second invoice is issued for a month the old
-- enrolment already billed.
create function public.transfer_student(p_enrollment uuid, p_to_group uuid, p_date date, p_keep_fee boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.enrollments%rowtype; g public.groups%rowtype; v_taken int; v_fee bigint; v_id uuid; v_from text;
begin
  select * into e from public.enrollments where id = p_enrollment for update;
  if e.id is null or not app.is_admin(e.center_id) then perform app.forbid(); end if;
  if e.status <> 'active' then raise exception 'This enrolment is not active.'; end if;
  select * into g from public.groups where id = p_to_group for update;
  if g.id is null or g.center_id <> e.center_id then perform app.forbid(); end if;
  if g.status <> 'active' then raise exception 'group is archived'; end if;
  if g.id = e.group_id then raise exception 'The student is already in this group.'; end if;
  if exists (select 1 from public.enrollments where group_id = g.id and student_id = e.student_id and status = 'active') then
    raise exception 'student is already enrolled in this group';
  end if;
  select count(*) into v_taken from public.enrollments where group_id = g.id and status = 'active';
  if g.capacity is not null and v_taken >= g.capacity then raise exception 'group is full (% / %)', v_taken, g.capacity; end if;
  if p_date is null or p_date < e.start_date then raise exception 'The transfer date is before the start date.'; end if;
  -- V1: no scheduled transfers. A future date would take the student out of
  -- the current group today (rosters, attendance) although they still attend.
  if p_date > app.centre_local_date(e.center_id) then raise exception 'A transfer cannot be dated in the future; do it on the day.'; end if;

  update public.enrollments set status = 'completed', end_date = p_date where id = e.id;
  select case when p_keep_fee then e.monthly_fee else c.default_monthly_fee end into v_fee
  from public.courses c where c.id = g.course_id;
  insert into public.enrollments (center_id, student_id, group_id, monthly_fee, discount_percent, due_day, start_date, transferred_from)
  values (e.center_id, e.student_id, g.id, v_fee, e.discount_percent, e.due_day, p_date, e.id)
  returning id into v_id;
  -- bills the transfer month only if no enrolment in the chain already did
  perform app.issue_invoice(v_id, p_date);
  select name into v_from from public.groups where id = e.group_id;
  perform app.add_activity(e.center_id, e.student_id, 'enrollment', 'Moved to another group',
    format('%s → %s', v_from, g.name), app.my_staff_membership(e.center_id), v_id);
  return v_id;
end $$;

-- --------------------------------------------------------------- groups
create function public.update_group(p_group uuid, p_name text, p_mentor uuid, p_room_name text, p_capacity int)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.groups%rowtype; v_room uuid; v_tz text; v_taken int;
begin
  select * into g from public.groups where id = p_group for update;
  if g.id is null or not app.is_staff(g.center_id) then perform app.forbid(); end if;
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'Enter a group name.'; end if;
  if p_mentor is not null and not exists (select 1 from public.memberships where id = p_mentor and center_id = g.center_id
                                          and role = 'mentor' and status in ('active','invited')) then
    raise exception 'Choose a mentor from this centre.';
  end if;
  select count(*) into v_taken from public.enrollments where group_id = g.id and status = 'active';
  if p_capacity is not null and (p_capacity < 1 or p_capacity < v_taken) then
    raise exception 'Capacity cannot be below the % students already in the group.', v_taken;
  end if;
  if coalesce(trim(p_room_name), '') <> '' then
    select id into v_room from public.rooms where branch_id = g.branch_id and lower(name) = lower(trim(p_room_name));
    if v_room is null then
      insert into public.rooms (center_id, branch_id, name) values (g.center_id, g.branch_id, trim(p_room_name)) returning id into v_room;
    end if;
  end if;
  select timezone into v_tz from public.centers where id = g.center_id;
  update public.groups set name = trim(p_name), mentor_id = p_mentor, room_id = v_room, capacity = p_capacity where id = g.id;
  -- future lessons follow the new mentor and room (clashes refused)
  begin
    update public.lessons l set mentor_id = p_mentor, room_id = v_room
    where l.group_id = g.id and l.status = 'scheduled' and l.starts_at > now()
      and not exists (select 1 from public.attendance_records a where a.lesson_id = l.id);
  exception when exclusion_violation then
    raise exception 'schedule conflict: the new mentor or room is already booked at one of this group''s lesson times' using errcode = '23P01';
  end;
end $$;

-- Replace the weekly timetable from a date on. Future lessons without
-- attendance are removed and made again from the new slots (12 weeks, or
-- up to the group's end date). One notice goes to the group's students and
-- parents.
create function public.update_group_schedule(p_group uuid, p_weekdays smallint[], p_start_time time, p_end_time time, p_from date)
returns int language plpgsql security definer set search_path = '' as $$
declare g public.groups%rowtype; v_tz text; v_from timestamptz; v_n int; v_day smallint; v_to date;
begin
  select * into g from public.groups where id = p_group for update;
  if g.id is null or not app.is_staff(g.center_id) then perform app.forbid(); end if;
  if coalesce(cardinality(p_weekdays), 0) = 0 then raise exception 'Choose at least one day.'; end if;
  if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then raise exception 'Set a start and end time for the lessons.'; end if;
  if exists (select 1 from unnest(p_weekdays) d where d not between 1 and 7) then raise exception 'Choose days from Monday to Sunday.'; end if;
  select timezone into v_tz from public.centers where id = g.center_id;
  if p_from is null or p_from < (now() at time zone v_tz)::date then raise exception 'The new timetable cannot start in the past.'; end if;
  v_from := p_from::timestamp at time zone v_tz;

  delete from public.lessons l
  where l.group_id = g.id and l.starts_at >= v_from and l.status <> 'held'
    and not exists (select 1 from public.attendance_records a where a.lesson_id = l.id);
  delete from public.group_schedule_slots where group_id = g.id;
  foreach v_day in array (select array_agg(distinct d order by d) from unnest(p_weekdays) d) loop
    insert into public.group_schedule_slots (center_id, group_id, weekday, start_time, end_time, room_id)
    values (g.center_id, g.id, v_day, p_start_time, p_end_time, g.room_id);
  end loop;
  v_to := least(coalesce(g.end_date, p_from + 83), p_from + 83);
  v_n := public.generate_lessons(g.id, p_from, v_to);   -- raises "schedule conflict" on a clash; nothing is saved
  perform app.notify(g.center_id, app.group_audience(g.id, true), 'schedule_changed', 'Timetable changed',
    format('The %s timetable changes from %s.', g.name, to_char(p_from, 'DD Mon')),
    jsonb_build_object('group', g.name, 'group_id', g.id, 'from', p_from,
                       'weekdays', to_jsonb(p_weekdays), 'start', to_char(p_start_time, 'HH24:MI'), 'end', to_char(p_end_time, 'HH24:MI')));
  return v_n;
end $$;

-- -------------------------------------------------------------- lessons
create function public.cancel_lesson(p_lesson uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.lessons%rowtype;
begin
  select * into l from public.lessons where id = p_lesson for update;
  if l.id is null or not app.is_staff(l.center_id) then perform app.forbid(); end if;
  if l.status = 'cancelled' then raise exception 'This lesson is already cancelled.'; end if;
  if exists (select 1 from public.attendance_records where lesson_id = l.id) then
    raise exception 'Attendance was already taken for this lesson.';
  end if;
  update public.lessons set status = 'cancelled' where id = l.id;   -- 0022 tells the group and parents
end $$;

create function public.move_lesson(p_lesson uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.lessons%rowtype; v_tz text;
begin
  select * into l from public.lessons where id = p_lesson for update;
  if l.id is null or not app.is_staff(l.center_id) then perform app.forbid(); end if;
  if l.status <> 'scheduled' then raise exception 'Only a scheduled lesson can be moved.'; end if;
  if exists (select 1 from public.attendance_records where lesson_id = l.id) then
    raise exception 'Attendance was already taken for this lesson.';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '6 hours' then
    raise exception 'Set a start and end time for the lesson.';
  end if;
  if p_starts_at < now() then raise exception 'A lesson cannot be moved into the past.'; end if;
  select timezone into v_tz from public.centers where id = l.center_id;
  begin
    update public.lessons set starts_at = p_starts_at, ends_at = p_ends_at where id = l.id;
  exception
    when exclusion_violation then raise exception '%', app.clash_message(p_starts_at, v_tz) using errcode = '23P01';
    when unique_violation then raise exception 'This group already has a lesson at that time.';
  end;
end $$;

revoke execute on function public.update_student(uuid, text, text, text, date, uuid, text),
  public.save_guardian(uuid, uuid, text, text, text, boolean),
  public.end_enrollment(uuid, text, date, text), public.transfer_student(uuid, uuid, date, boolean),
  public.update_group(uuid, text, uuid, text, int), public.update_group_schedule(uuid, smallint[], time, time, date),
  public.cancel_lesson(uuid, text), public.move_lesson(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.update_student(uuid, text, text, text, date, uuid, text),
  public.save_guardian(uuid, uuid, text, text, text, boolean),
  public.end_enrollment(uuid, text, date, text), public.transfer_student(uuid, uuid, date, boolean),
  public.update_group(uuid, text, uuid, text, int), public.update_group_schedule(uuid, smallint[], time, time, date),
  public.cancel_lesson(uuid, text), public.move_lesson(uuid, timestamptz, timestamptz) to authenticated;
revoke execute on function app.clash_message(timestamptz, text) from public, anon, authenticated;
