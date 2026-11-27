-- 0032: what the parent Telegram bot may show, one function per menu.
--
-- Every function takes the Telegram user id (from the verified webhook
-- update, never from button data alone) and a student id, and starts with
-- app.tg_can_see_student (0031): live link -> parent membership not
-- suspended -> guardians row -> student, all in one centre. Anything else
-- is refused with "forbidden".
--
-- Only what the web parent portal already shows: no answer keys, no
-- transcripts, no unreleased mock results, no staff phone numbers. Callable
-- by the service role only (the bot's server).
--
-- Also adds the centre's contact phone and address (the Settings page
-- writes them; until then the student's branch phone and address are used).
--
-- Rollback: drop the functions below; drop columns centers.phone and
-- centers.address.

alter table public.centers
  add column phone   text check (phone is null or length(phone) between 5 and 32),
  add column address text check (address is null or length(address) <= 300);

create function app.tg_guard(p_tg_user bigint, p_student uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.tg_can_see_student(p_tg_user, p_student) then perform app.forbid(); end if;
end $$;

-- Child, centre, groups, mentor and the weekly timetable.
create function public.tg_child_profile(p_tg_user bigint, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform app.tg_guard(p_tg_user, p_student);
  select jsonb_build_object(
    'student', s.full_name, 'status', s.status, 'joined_on', s.joined_on,
    'center', c.name, 'timezone', c.timezone,
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'group', g.name, 'course', co.name, 'level', co.level, 'since', e.start_date,
        'mentor', mt.full_name,
        'slots', coalesce((select jsonb_agg(jsonb_build_object('weekday', sl.weekday, 'start', to_char(sl.start_time, 'HH24:MI'),
                                                               'end', to_char(sl.end_time, 'HH24:MI'), 'room', r.name)
                                            order by sl.weekday, sl.start_time)
                           from public.group_schedule_slots sl left join public.rooms r on r.id = sl.room_id
                           where sl.group_id = g.id), '[]'))
        order by g.name)
      from public.enrollments e
      join public.groups g on g.id = e.group_id
      join public.courses co on co.id = g.course_id
      left join public.memberships mt on mt.id = g.mentor_id
      where e.student_id = s.id and e.status = 'active'), '[]'))
  into v
  from public.students s join public.centers c on c.id = s.center_id
  where s.id = p_student;
  return v;
end $$;

-- Lessons in the next 14 days (cancelled ones flagged, so parents see it).
create function public.tg_child_schedule(p_tg_user bigint, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tg_guard(p_tg_user, p_student);
  return jsonb_build_object(
    'timezone', (select c.timezone from public.students s join public.centers c on c.id = s.center_id where s.id = p_student),
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object('starts_at', l.starts_at, 'ends_at', l.ends_at, 'group', g.name,
                                          'mentor', mt.full_name, 'room', r.name, 'cancelled', l.status = 'cancelled')
                       order by l.starts_at)
      from public.lessons l
      join public.groups g on g.id = l.group_id
      left join public.memberships mt on mt.id = coalesce(l.mentor_id, g.mentor_id)
      left join public.rooms r on r.id = l.room_id
      where l.group_id in (select e.group_id from public.enrollments e where e.student_id = p_student and e.status = 'active')
        and l.starts_at >= now() - interval '1 hour' and l.starts_at < now() + interval '14 days'), '[]'));
end $$;

-- The last 10 marks and the rate over 90 days (excused lessons left out).
create function public.tg_child_attendance(p_tg_user bigint, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tg_guard(p_tg_user, p_student);
  return jsonb_build_object(
    'timezone', (select c.timezone from public.students s join public.centers c on c.id = s.center_id where s.id = p_student),
    'recent', coalesce((
      select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', l.starts_at, 'group', g.name, 'status', a.status) as x
        from public.attendance_records a
        join public.lessons l on l.id = a.lesson_id
        join public.groups g on g.id = l.group_id
        where a.student_id = p_student
        order by l.starts_at desc limit 10) t), '[]'),
    'rate_90d', (
      select case when count(*) filter (where a.status <> 'excused') > 0
        then round(100.0 * count(*) filter (where a.status in ('present','late')) / count(*) filter (where a.status <> 'excused')) end
      from public.attendance_records a join public.lessons l on l.id = a.lesson_id
      where a.student_id = p_student and l.starts_at >= now() - interval '90 days'),
    'counts_90d', (
      select jsonb_build_object('present', count(*) filter (where a.status = 'present'), 'late', count(*) filter (where a.status = 'late'),
                                'absent', count(*) filter (where a.status = 'absent'), 'excused', count(*) filter (where a.status = 'excused'))
      from public.attendance_records a join public.lessons l on l.id = a.lesson_id
      where a.student_id = p_student and l.starts_at >= now() - interval '90 days'));
end $$;

-- What is owed and what was paid. Read only: nothing here changes money.
create function public.tg_child_payments(p_tg_user bigint, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tg_guard(p_tg_user, p_student);
  return jsonb_build_object(
    'open', coalesce((
      select jsonb_agg(jsonb_build_object('period', b.period, 'amount', b.amount, 'paid', b.paid, 'balance', b.balance,
                                          'due', b.due_date, 'status', b.payment_status) order by b.due_date)
      from public.invoice_balances b
      where b.student_id = p_student and b.payment_status in ('pending','partial','overdue')), '[]'),
    'due_total', (select coalesce(sum(b.balance), 0) from public.invoice_balances b
                  where b.student_id = p_student and b.payment_status in ('pending','partial','overdue')),
    'overdue_total', (select coalesce(sum(b.balance), 0) from public.invoice_balances b
                      where b.student_id = p_student and b.payment_status = 'overdue'),
    'next_due', (select min(b.due_date) from public.invoice_balances b
                 where b.student_id = p_student and b.payment_status in ('pending','partial')),
    'recent', coalesce((
      select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', p.paid_at, 'amount', p.amount, 'kind', p.kind, 'method', p.method, 'receipt', p.receipt_no) as x
        from public.payments p where p.student_id = p_student
        order by p.paid_at desc limit 5) t), '[]'));
end $$;

-- Homework of the last 30 days and what is coming: status and score only.
create function public.tg_child_homework(p_tg_user bigint, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tg_guard(p_tg_user, p_student);
  return jsonb_build_object(
    'timezone', (select c.timezone from public.students s join public.centers c on c.id = s.center_id where s.id = p_student),
    'items', coalesce((
      select jsonb_agg(x order by x->>'due' desc) from (
        select jsonb_build_object('title', a.title, 'skill', a.skill, 'due', h.due_at,
                 'status', coalesce(sb.status::text, 'not_started'),
                 'late', sb.submitted_at is null and h.due_at < now(),
                 'score', case when sb.status in ('submitted','reviewed') then round(sb.score) end) as x
        from public.homework h
        join public.assignments a on a.id = h.assignment_id
        left join public.submissions sb on sb.homework_id = h.id and sb.student_id = p_student
        where h.group_id in (select e.group_id from public.enrollments e where e.student_id = p_student and e.status = 'active')
          and h.due_at >= now() - interval '30 days'
        order by h.due_at desc limit 12) t), '[]'));
end $$;

-- Released mock results only, and the homework average of 30 days.
create function public.tg_child_results(p_tg_user bigint, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tg_guard(p_tg_user, p_student);
  return jsonb_build_object(
    'mocks', coalesce((
      select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('name', ms.name, 'at', ms.scheduled_at, 'status', r.status,
                 'reading', r.reading_band, 'listening', r.listening_band, 'writing', r.writing_band,
                 'speaking', r.speaking_band, 'overall', r.overall_band) as x
        from public.mock_result_scores r join public.mock_sessions ms on ms.id = r.mock_session_id
        where r.student_id = p_student and r.released_at is not null
        order by ms.scheduled_at desc limit 5) t), '[]'),
    'homework_avg_30d', (select round(avg(sb.score)) from public.submissions sb
                         where sb.student_id = p_student and sb.status in ('submitted','reviewed')
                           and sb.score is not null and sb.submitted_at >= now() - interval '30 days'),
    'homework_done_30d', (select jsonb_build_object('set', count(*), 'done', count(sb.id) filter (where sb.status in ('submitted','reviewed')))
                          from public.homework h
                          left join public.submissions sb on sb.homework_id = h.id and sb.student_id = p_student
                          where h.group_id in (select e.group_id from public.enrollments e where e.student_id = p_student and e.status = 'active')
                            and h.due_at >= now() - interval '30 days' and h.due_at < now()));
end $$;

-- How to reach the centre: centre phone and address, else the branch's.
-- Mentor names only; staff personal numbers are never sent.
create function public.tg_center_contact(p_tg_user bigint, p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.tg_guard(p_tg_user, p_student);
  return (
    select jsonb_build_object('center', c.name,
      'phone', coalesce(c.phone, b.phone), 'address', coalesce(c.address, b.address), 'branch', b.name,
      'mentors', coalesce((select jsonb_agg(distinct mt.full_name)
                           from public.enrollments e join public.groups g on g.id = e.group_id
                           join public.memberships mt on mt.id = g.mentor_id
                           where e.student_id = s.id and e.status = 'active'), '[]'))
    from public.students s join public.centers c on c.id = s.center_id
    left join public.branches b on b.id = s.branch_id
    where s.id = p_student);
end $$;

revoke execute on function app.tg_guard(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.tg_child_profile(bigint, uuid), public.tg_child_schedule(bigint, uuid),
  public.tg_child_attendance(bigint, uuid), public.tg_child_payments(bigint, uuid),
  public.tg_child_homework(bigint, uuid), public.tg_child_results(bigint, uuid),
  public.tg_center_contact(bigint, uuid) from public, anon, authenticated;
grant execute on function public.tg_child_profile(bigint, uuid), public.tg_child_schedule(bigint, uuid),
  public.tg_child_attendance(bigint, uuid), public.tg_child_payments(bigint, uuid),
  public.tg_child_homework(bigint, uuid), public.tg_child_results(bigint, uuid),
  public.tg_center_contact(bigint, uuid) to service_role;
