-- =====================================================================
-- In-app notifications for students, parents and staff (V1 step 4).
--
-- Written by triggers, so every path (app, RPC, SQL) notifies:
--   attendance absent/late        -> parents
--   new invoice, payment received -> student and parents
--   new homework                  -> the group's students
--   homework reviewed             -> the student
--   mock scheduled                -> the group's students
--   mock result released          -> student and parents
--   lesson cancelled or moved     -> the group's students and parents
--
-- Each row keeps an English title/body (fallback) and data.kind plus the
-- values the app needs to show it in the reader's language.
-- =====================================================================

-- Insert one notification for each distinct active recipient membership.
create function app.notify(p_center uuid, p_recipients uuid[], p_kind text, p_title text, p_body text, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (center_id, recipient_id, channel, status, title, body, data, sent_at)
  select p_center, m.id, 'in_app'::public.notification_channel, 'sent'::public.notification_status,
         p_title, p_body, coalesce(p_data, '{}') || jsonb_build_object('kind', p_kind), now()
  from public.memberships m
  where m.id = any(p_recipients) and m.center_id = p_center and m.status = 'active';
$$;

-- A student's own login and their parents' logins.
create function app.family_of(p_student uuid, p_with_student boolean default true)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select s.membership_id as x from public.students s where s.id = p_student and p_with_student
    union all
    select g.membership_id from public.guardians g where g.student_id = p_student
  ) t where x is not null;
$$;

-- Logins of a group's active students (and their parents, if asked).
create function app.group_audience(p_group uuid, p_with_parents boolean)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select s.membership_id as x
    from public.enrollments e join public.students s on s.id = e.student_id
    where e.group_id = p_group and e.status = 'active'
    union all
    select g.membership_id
    from public.enrollments e join public.guardians g on g.student_id = e.student_id
    where e.group_id = p_group and e.status = 'active' and p_with_parents
  ) t where x is not null;
$$;

create function app.tz_text(p timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(p at time zone 'Asia/Tashkent', 'DD Mon HH24:MI');
$$;

revoke execute on function app.notify(uuid, uuid[], text, text, text, jsonb), app.family_of(uuid, boolean),
                           app.group_audience(uuid, boolean), app.tz_text(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- attendance
create function app.notify_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_at timestamptz; v_group text;
begin
  if new.status not in ('absent', 'late') or (tg_op = 'UPDATE' and old.status = new.status) then return new; end if;
  select s.full_name into v_name from public.students s where s.id = new.student_id;
  select l.starts_at, g.name into v_at, v_group from public.lessons l join public.groups g on g.id = l.group_id where l.id = new.lesson_id;
  perform app.notify(new.center_id, app.family_of(new.student_id, false), 'attendance', 'Attendance',
    format('%s was marked %s for the %s lesson on %s.', v_name, new.status, v_group, app.tz_text(v_at)),
    jsonb_build_object('student', v_name, 'student_id', new.student_id, 'status', new.status, 'at', v_at, 'group', v_group));
  return new;
end $$;
create trigger attendance_notify after insert or update of status on public.attendance_records
  for each row execute function app.notify_attendance();

-- ------------------------------------------------------------------ invoices
create function app.notify_invoice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select s.full_name into v_name from public.students s where s.id = new.student_id;
  perform app.notify(new.center_id, app.family_of(new.student_id), 'invoice', 'New invoice',
    format('%s: %s UZS for %s, due %s.', v_name, new.amount, to_char(new.period, 'Mon YYYY'), to_char(new.due_date, 'DD Mon')),
    jsonb_build_object('student', v_name, 'student_id', new.student_id, 'invoice_id', new.id, 'amount', new.amount,
                       'period', new.period, 'due', new.due_date));
  return new;
end $$;
create trigger invoices_notify after insert on public.invoices
  for each row execute function app.notify_invoice();

-- ------------------------------------------------------------------ payments
create function app.notify_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if new.kind <> 'payment' then return new; end if;
  select s.full_name into v_name from public.students s where s.id = new.student_id;
  perform app.notify(new.center_id, app.family_of(new.student_id), 'payment', 'Payment received',
    format('%s UZS received for %s.', new.amount, v_name),
    jsonb_build_object('student', v_name, 'student_id', new.student_id, 'payment_id', new.id, 'amount', new.amount, 'receipt', new.receipt_no));
  return new;
end $$;
create trigger payments_notify after insert on public.payments
  for each row execute function app.notify_payment();

-- ------------------------------------------------------------------ homework
create function app.notify_homework() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_title text;
begin
  select a.title into v_title from public.assignments a where a.id = new.assignment_id;
  perform app.notify(new.center_id, app.group_audience(new.group_id, false), 'homework_new', 'New homework',
    format('%s, due %s.', v_title, app.tz_text(new.due_at)),
    jsonb_build_object('title', v_title, 'homework_id', new.id, 'due', new.due_at));
  return new;
end $$;
create trigger homework_notify after insert on public.homework
  for each row execute function app.notify_homework();

create function app.notify_review() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_title text; v_me uuid;
begin
  if new.status <> 'reviewed' or old.status = 'reviewed' then return new; end if;
  select a.title into v_title from public.homework h join public.assignments a on a.id = h.assignment_id where h.id = new.homework_id;
  select membership_id into v_me from public.students where id = new.student_id;
  perform app.notify(new.center_id, array[v_me], 'homework_reviewed', 'Homework reviewed',
    format('%s: %s%%.', v_title, coalesce(round(new.score)::text, '—')),
    jsonb_build_object('title', v_title, 'homework_id', new.homework_id, 'score', round(new.score)));
  return new;
end $$;
create trigger submissions_notify after update of status on public.submissions
  for each row execute function app.notify_review();

-- --------------------------------------------------------------------- mocks
create function app.notify_mock_scheduled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.group_id is null then return new; end if;
  perform app.notify(new.center_id, app.group_audience(new.group_id, false), 'mock_scheduled', 'Mock scheduled',
    format('%s on %s.', new.name, app.tz_text(new.scheduled_at)),
    jsonb_build_object('name', new.name, 'session_id', new.id, 'at', new.scheduled_at));
  return new;
end $$;
create trigger mock_sessions_notify after insert on public.mock_sessions
  for each row execute function app.notify_mock_scheduled();

create function app.notify_mock_released() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_overall numeric;
begin
  if new.released_at is null or old.released_at is not null or new.status <> 'completed' then return new; end if;
  select name into v_name from public.mock_sessions where id = new.mock_session_id;
  v_overall := app.overall_band(new.reading_band, new.listening_band, new.writing_band, new.speaking_band);
  perform app.notify(new.center_id, app.family_of(new.student_id), 'mock_released', 'Mock results',
    format('%s: overall band %s.', v_name, coalesce(v_overall::text, '—')),
    jsonb_build_object('name', v_name, 'session_id', new.mock_session_id, 'student_id', new.student_id, 'overall', v_overall));
  return new;
end $$;
create trigger mock_results_notify after update of released_at on public.mock_results
  for each row execute function app.notify_mock_released();

-- ------------------------------------------------------------------- lessons
create function app.notify_lesson_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_group text;
begin
  select name into v_group from public.groups where id = new.group_id;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform app.notify(new.center_id, app.group_audience(new.group_id, true), 'lesson_cancelled', 'Lesson cancelled',
      format('The %s lesson on %s is cancelled.', v_group, app.tz_text(new.starts_at)),
      jsonb_build_object('group', v_group, 'at', new.starts_at));
  elsif new.status = 'scheduled' and new.starts_at is distinct from old.starts_at then
    perform app.notify(new.center_id, app.group_audience(new.group_id, true), 'lesson_moved', 'Lesson moved',
      format('The %s lesson on %s moved to %s.', v_group, app.tz_text(old.starts_at), app.tz_text(new.starts_at)),
      jsonb_build_object('group', v_group, 'from', old.starts_at, 'at', new.starts_at));
  end if;
  return new;
end $$;
create trigger lessons_notify after update of status, starts_at on public.lessons
  for each row execute function app.notify_lesson_change();

-- Readers may mark their own notifications read (all at once from the bell).
create function public.mark_my_notifications_read(p_center uuid)
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where center_id = p_center and read_at is null
    and recipient_id in (select m.id from public.memberships m where m.user_id = auth.uid());
$$;
revoke execute on function public.mark_my_notifications_read(uuid) from public, anon;
grant execute on function public.mark_my_notifications_read(uuid) to authenticated;
