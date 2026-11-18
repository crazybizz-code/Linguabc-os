-- =====================================================================
-- LinguABC OS — server functions (called from the app via supabase.rpc)
--
-- Every function re-checks the caller's role. Multi-row changes run in a
-- single transaction, so a payment, its receipt number and its timeline
-- entry are written together or not at all.
-- =====================================================================

-- ------------------------------------------------------------- helpers
create function app.forbid(p_msg text default 'forbidden') returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_msg using errcode = '42501';
end $$;

create function app.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

-- The caller's working membership in a center (staff first, then mentor).
create function app.my_staff_membership(p_center uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.memberships m
  where m.center_id = p_center and m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner','admin','academic_manager','mentor')
  order by array_position(array['owner','admin','academic_manager','mentor']::public.member_role[], m.role)
  limit 1;
$$;

create function app.add_activity(p_center uuid, p_student uuid, p_type public.activity_type,
                                 p_title text, p_detail text, p_actor uuid, p_ref uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.activities (center_id, student_id, type, title, detail, actor_id, ref_id)
  values (p_center, p_student, p_type, p_title, p_detail, p_actor, p_ref);
$$;

-- IELTS-style overall: mean of the four bands rounded to the nearest half
-- band, with .25 and .75 rounding up.
create function app.overall_band(r numeric, l numeric, w numeric, s numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when r is null or l is null or w is null or s is null then null
              else floor(((r + l + w + s) / 4) * 2 + 0.5) / 2 end;
$$;

-- ------------------------------------------------- new auth user → profile
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ======================================================= centers & people
-- /register: a signed-in user creates a center and becomes its owner.
create function public.create_center(p_name text, p_slug text, p_owner_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_center uuid;
begin
  if auth.uid() is null then perform app.forbid('sign in first'); end if;
  insert into public.centers (name, slug) values (trim(p_name), lower(trim(p_slug)))
  returning id into v_center;
  insert into public.memberships (center_id, user_id, role, status, full_name)
  values (v_center, auth.uid(), 'owner', 'active', trim(p_owner_name));
  return v_center;
end $$;

-- Staff invite a person. For a student or parent, pass the student /
-- guardian row so the login is linked to the right child.
create function public.invite_member(
  p_center uuid, p_role public.member_role, p_full_name text,
  p_email text default null, p_phone text default null, p_branch uuid default null,
  p_student uuid default null, p_guardian uuid default null)
returns table (membership_id uuid, invite_code text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_id uuid; v_code text;
begin
  if not app.is_admin(p_center) then perform app.forbid(); end if;
  if p_role in ('owner','admin') and not app.has_role(p_center, '{owner}') then
    perform app.forbid('only the owner can invite owners or admins');
  end if;
  if p_role = 'student' and p_student is null then
    raise exception 'student invite needs p_student';
  end if;
  if p_role = 'parent' and p_guardian is null then
    raise exception 'parent invite needs p_guardian';
  end if;

  v_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  insert into public.memberships (center_id, role, status, full_name, email, phone, branch_id, invite_code, invited_by)
  values (p_center, p_role, 'invited', trim(p_full_name), lower(p_email), p_phone, p_branch, v_code,
          app.my_staff_membership(p_center))
  returning id into v_id;

  if p_role = 'student' then
    update public.students set membership_id = v_id
    where id = p_student and center_id = p_center and membership_id is null;
    if not found then raise exception 'student not found or already has a login'; end if;
  elsif p_role = 'parent' then
    update public.guardians set membership_id = v_id
    where id = p_guardian and center_id = p_center and membership_id is null;
    if not found then raise exception 'guardian not found or already has a login'; end if;
  end if;

  return query select v_id, v_code;
end $$;

-- /join: the invited person signs in and redeems the code.
create function public.accept_invite(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then perform app.forbid('sign in first'); end if;
  update public.memberships
     set user_id = auth.uid(), status = 'active', invite_code = null
   where invite_code = upper(trim(p_code)) and status = 'invited'
  returning id into v_id;
  if v_id is null then raise exception 'invalid or used invite code'; end if;
  return v_id;
end $$;

create function public.set_member_status(p_membership uuid, p_status public.member_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not app.is_admin(v_m.center_id) then perform app.forbid(); end if;
  if v_m.role in ('owner','admin') and not app.has_role(v_m.center_id, '{owner}') then
    perform app.forbid('only the owner can change owners or admins');
  end if;
  if v_m.user_id = auth.uid() then perform app.forbid('you cannot change your own status'); end if;
  if p_status = 'active' and v_m.user_id is null then raise exception 'invite not accepted yet'; end if;
  update public.memberships set status = p_status where id = p_membership;
end $$;

-- ============================================================ finance core
create function app.issue_invoice(p_enrollment uuid, p_period date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_e public.enrollments; v_id uuid; v_period date := date_trunc('month', p_period)::date;
begin
  select * into v_e from public.enrollments where id = p_enrollment;
  insert into public.invoices (center_id, student_id, enrollment_id, period, amount, due_date)
  values (v_e.center_id, v_e.student_id, v_e.id, v_period,
          round(v_e.monthly_fee * (100 - v_e.discount_percent) / 100)::bigint,
          v_period + (v_e.due_day - 1))
  on conflict (enrollment_id, period) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Enrol an existing student into a group and issue the first invoice.
create function public.enroll_student(
  p_student uuid, p_group uuid, p_monthly_fee bigint default null,
  p_discount_percent numeric default 0, p_due_day smallint default 5,
  p_start_date date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_g public.groups; v_fee bigint; v_id uuid; v_taken int;
begin
  select * into v_g from public.groups where id = p_group for update;
  if v_g.id is null or not app.is_admin(v_g.center_id) then perform app.forbid(); end if;
  if v_g.status <> 'active' then raise exception 'group is archived'; end if;

  if exists (select 1 from public.enrollments
             where group_id = p_group and student_id = p_student and status = 'active') then
    raise exception 'student is already enrolled in this group';
  end if;
  select count(*) into v_taken from public.enrollments where group_id = p_group and status = 'active';
  if v_g.capacity is not null and v_taken >= v_g.capacity then
    raise exception 'group is full (% / %)', v_taken, v_g.capacity;
  end if;

  select coalesce(p_monthly_fee, c.default_monthly_fee) into v_fee
  from public.courses c where c.id = v_g.course_id;

  insert into public.enrollments (center_id, student_id, group_id, monthly_fee, discount_percent, due_day, start_date)
  values (v_g.center_id, p_student, p_group, v_fee, p_discount_percent, p_due_day, p_start_date)
  returning id into v_id;

  update public.students set status = 'active' where id = p_student and status = 'lead';
  perform app.issue_invoice(v_id, p_start_date);
  perform app.add_activity(v_g.center_id, p_student, 'enrollment', 'Enrolled', v_g.name,
                           app.my_staff_membership(v_g.center_id), v_id);
  return v_id;
end $$;

-- Monthly billing run (call from a scheduled job or the Payments screen).
create function public.generate_invoices(p_center uuid, p_period date)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int := 0; v_e record; v_period date := date_trunc('month', p_period)::date;
begin
  if not (app.is_admin(p_center) or app.is_service()) then perform app.forbid(); end if;
  for v_e in
    select id from public.enrollments
    where center_id = p_center and status = 'active'
      and start_date < (v_period + interval '1 month')
      and (end_date is null or end_date >= v_period)
  loop
    if app.issue_invoice(v_e.id, v_period) is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

-- Record money received. Owner/admin at the desk, or the service role for
-- Click / Payme / Uzum webhooks (provider_txn_id makes retries idempotent).
create function public.record_payment(
  p_invoice uuid, p_amount bigint, p_method public.payment_method,
  p_note text default null, p_provider_txn_id text default null,
  p_paid_at timestamptz default now())
returns table (payment_id uuid, receipt_no text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_inv public.invoices; v_paid bigint; v_seq bigint; v_receipt text; v_id uuid;
begin
  select * into v_inv from public.invoices where id = p_invoice for update;
  if v_inv.id is null then perform app.forbid(); end if;
  if not (app.is_admin(v_inv.center_id) or app.is_service()) then perform app.forbid(); end if;
  if v_inv.status <> 'open' then raise exception 'invoice is void'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;

  -- Webhook retry: same provider transaction already recorded → return it.
  if p_provider_txn_id is not null then
    return query select p.id, p.receipt_no from public.payments p
                 where p.method = p_method and p.provider_txn_id = p_provider_txn_id;
    if found then return; end if;
  end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
    into v_paid from public.payments where invoice_id = p_invoice;
  if p_amount > v_inv.amount - v_paid then
    raise exception 'amount % exceeds the remaining balance %', p_amount, v_inv.amount - v_paid;
  end if;

  update public.centers set receipt_seq = receipt_seq + 1 where id = v_inv.center_id
  returning receipt_seq into v_seq;
  v_receipt := 'R-' || lpad(v_seq::text, 6, '0');

  insert into public.payments (center_id, student_id, invoice_id, kind, amount, method,
                               provider_txn_id, receipt_no, received_by, note, paid_at)
  values (v_inv.center_id, v_inv.student_id, p_invoice, 'payment', p_amount, p_method,
          p_provider_txn_id, v_receipt, app.my_staff_membership(v_inv.center_id), p_note, p_paid_at)
  returning id into v_id;

  perform app.add_activity(v_inv.center_id, v_inv.student_id, 'payment', 'Payment received',
                           p_amount || ' UZS · ' || p_method || ' · ' || v_receipt,
                           app.my_staff_membership(v_inv.center_id), v_id);
  return query select v_id, v_receipt;
end $$;

-- Refunds are new ledger rows; only the owner may issue them.
create function public.refund_payment(p_payment uuid, p_amount bigint, p_reason text)
returns table (payment_id uuid, receipt_no text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_p public.payments; v_refunded bigint; v_seq bigint; v_receipt text; v_id uuid;
begin
  select * into v_p from public.payments where id = p_payment and kind = 'payment' for update;
  if v_p.id is null or not app.has_role(v_p.center_id, '{owner}') then perform app.forbid(); end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a refund needs a reason'; end if;
  select coalesce(sum(amount), 0) into v_refunded from public.payments where refund_of = p_payment;
  if p_amount <= 0 or p_amount > v_p.amount - v_refunded then
    raise exception 'refund % exceeds refundable %', p_amount, v_p.amount - v_refunded;
  end if;

  update public.centers set receipt_seq = receipt_seq + 1 where id = v_p.center_id
  returning receipt_seq into v_seq;
  v_receipt := 'RF-' || lpad(v_seq::text, 6, '0');

  insert into public.payments (center_id, student_id, invoice_id, kind, amount, method,
                               receipt_no, received_by, refund_of, note)
  values (v_p.center_id, v_p.student_id, v_p.invoice_id, 'refund', p_amount, v_p.method,
          v_receipt, app.my_staff_membership(v_p.center_id), p_payment, p_reason)
  returning id into v_id;

  perform app.add_activity(v_p.center_id, v_p.student_id, 'payment', 'Refund issued',
                           p_amount || ' UZS · ' || v_receipt, app.my_staff_membership(v_p.center_id), v_id);
  return query select v_id, v_receipt;
end $$;

create function public.void_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices; v_net bigint;
begin
  select * into v_inv from public.invoices where id = p_invoice for update;
  if v_inv.id is null or not app.is_admin(v_inv.center_id) then perform app.forbid(); end if;
  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
    into v_net from public.payments where invoice_id = p_invoice;
  if v_net <> 0 then raise exception 'refund the payments before voiding'; end if;
  update public.invoices set status = 'void' where id = p_invoice;
end $$;

-- The ledger cannot be edited or deleted, by anyone.
create function app.block_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% rows are append-only', tg_table_name using errcode = '42501';
end $$;

create trigger payments_append_only before update or delete on public.payments
  for each row execute function app.block_mutation();
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.block_mutation();

-- ============================================================ schedule
-- Turn a group's weekly slots into lessons between two dates. Room and
-- mentor clashes are rejected by the exclusion constraints on lessons.
create function public.generate_lessons(p_group uuid, p_from date, p_to date)
returns int language plpgsql security definer set search_path = '' as $$
declare v_g public.groups; v_tz text; v_count int := 0; v_day date; v_slot record; v_start timestamptz;
begin
  select * into v_g from public.groups where id = p_group;
  if v_g.id is null or not app.is_staff(v_g.center_id) then perform app.forbid(); end if;
  if p_to < p_from or p_to - p_from > 366 then raise exception 'invalid date range'; end if;
  select timezone into v_tz from public.centers where id = v_g.center_id;

  for v_day in select d::date from generate_series(p_from, p_to, interval '1 day') d loop
    for v_slot in select * from public.group_schedule_slots
                  where group_id = p_group and weekday = extract(isodow from v_day) loop
      v_start := (v_day + v_slot.start_time) at time zone v_tz;
      begin
        insert into public.lessons (center_id, group_id, mentor_id, room_id, starts_at, ends_at)
        values (v_g.center_id, p_group, v_g.mentor_id, coalesce(v_slot.room_id, v_g.room_id),
                v_start, (v_day + v_slot.end_time) at time zone v_tz)
        on conflict (group_id, starts_at) do nothing;
        if found then v_count := v_count + 1; end if;
      exception when exclusion_violation then
        raise exception 'schedule conflict on % at %: room or mentor already booked',
          v_day, v_slot.start_time using errcode = '23P01';
      end;
    end loop;
  end loop;
  return v_count;
end $$;

-- ============================================================ attendance
-- p_records: [{"student_id": "...", "status": "present", "note": null}, ...]
create function public.mark_attendance(p_lesson uuid, p_records jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_l public.lessons; v_marker uuid; v_r jsonb; v_student uuid; v_count int := 0;
begin
  select * into v_l from public.lessons where id = p_lesson;
  if v_l.id is null or not (app.is_staff(v_l.center_id) or app.is_mentor_of_group(v_l.group_id)) then
    perform app.forbid();
  end if;
  if v_l.status = 'cancelled' then raise exception 'lesson is cancelled'; end if;
  if v_l.starts_at > now() + interval '1 hour' then raise exception 'lesson has not started yet'; end if;
  v_marker := app.my_staff_membership(v_l.center_id);

  for v_r in select * from jsonb_array_elements(p_records) loop
    v_student := (v_r ->> 'student_id')::uuid;
    if not exists (select 1 from public.enrollments
                   where student_id = v_student and group_id = v_l.group_id
                     and start_date <= v_l.starts_at::date) then
      raise exception 'student % is not in this group', v_student;
    end if;
    insert into public.attendance_records (center_id, lesson_id, student_id, status, note, marked_by)
    values (v_l.center_id, p_lesson, v_student, (v_r ->> 'status')::public.attendance_status,
            v_r ->> 'note', v_marker)
    on conflict (lesson_id, student_id)
      do update set status = excluded.status, note = excluded.note,
                    marked_by = excluded.marked_by, marked_at = now();
    perform app.add_activity(v_l.center_id, v_student, 'attendance',
                             'Attendance: ' || (v_r ->> 'status'), null, v_marker, p_lesson);
    v_count := v_count + 1;
  end loop;

  update public.lessons set status = 'held' where id = p_lesson and status = 'scheduled';
  return v_count;
end $$;

-- ============================================================ homework
create function public.approve_assignment(p_assignment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_a public.assignments;
begin
  select * into v_a from public.assignments where id = p_assignment for update;
  if v_a.id is null or not app.is_staff(v_a.center_id) then perform app.forbid(); end if;
  update public.assignments
     set status = 'approved', approved_by = app.my_staff_membership(v_a.center_id), approved_at = now()
   where id = p_assignment;
end $$;

-- Give an approved assignment to a group; every active student gets a
-- "not started" submission row.
create function public.assign_homework(p_assignment uuid, p_group uuid, p_due_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_a public.assignments; v_g public.groups; v_id uuid; v_by uuid;
begin
  select * into v_a from public.assignments where id = p_assignment;
  select * into v_g from public.groups where id = p_group;
  if v_a.id is null or v_g.id is null or v_a.center_id <> v_g.center_id then perform app.forbid(); end if;
  if not (app.is_staff(v_g.center_id) or app.is_mentor_of_group(p_group)) then perform app.forbid(); end if;
  if v_a.status <> 'approved' then raise exception 'assignment must be approved first'; end if;
  if p_due_at <= now() then raise exception 'due date must be in the future'; end if;

  v_by := app.my_staff_membership(v_g.center_id);
  insert into public.homework (center_id, assignment_id, group_id, assigned_by, due_at)
  values (v_g.center_id, p_assignment, p_group, v_by, p_due_at)
  returning id into v_id;

  insert into public.submissions (center_id, homework_id, student_id)
  select v_g.center_id, v_id, e.student_id from public.enrollments e
  where e.group_id = p_group and e.status = 'active';

  insert into public.activities (center_id, student_id, type, title, detail, actor_id, ref_id)
  select v_g.center_id, e.student_id, 'homework', 'Homework assigned', v_a.title, v_by, v_id
  from public.enrollments e where e.group_id = p_group and e.status = 'active';
  return v_id;
end $$;

-- The student saves progress or submits. Score/feedback are untouchable here.
create function public.save_submission(p_homework uuid, p_answers jsonb, p_submit boolean default false)
returns public.submission_status language plpgsql security definer set search_path = '' as $$
declare v_h public.homework; v_student uuid; v_s public.submissions; v_title text;
begin
  select * into v_h from public.homework where id = p_homework;
  if v_h.id is null then perform app.forbid(); end if;
  select s.id into v_student from public.students s
  join public.memberships m on m.id = s.membership_id
  where s.center_id = v_h.center_id and m.user_id = auth.uid() and m.status = 'active';
  if v_student is null or not exists (select 1 from public.enrollments
      where student_id = v_student and group_id = v_h.group_id and status = 'active') then
    perform app.forbid();
  end if;

  insert into public.submissions (center_id, homework_id, student_id)
  values (v_h.center_id, p_homework, v_student)
  on conflict (homework_id, student_id) do nothing;

  select * into v_s from public.submissions
  where homework_id = p_homework and student_id = v_student for update;
  if v_s.status in ('submitted','reviewed') then raise exception 'already submitted'; end if;

  update public.submissions
     set answers = coalesce(p_answers, '{}'::jsonb),
         status = case when p_submit then 'submitted' else 'in_progress' end::public.submission_status,
         started_at = coalesce(started_at, now()),
         submitted_at = case when p_submit then now() end
   where id = v_s.id
  returning * into v_s;

  if p_submit then
    select a.title into v_title from public.assignments a where a.id = v_h.assignment_id;
    perform app.add_activity(v_h.center_id, v_student, 'homework', 'Homework submitted', v_title, null, p_homework);
  end if;
  return v_s.status;
end $$;

create function public.review_submission(p_submission uuid, p_score numeric, p_feedback text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_s public.submissions; v_h public.homework;
begin
  select * into v_s from public.submissions where id = p_submission for update;
  select * into v_h from public.homework where id = v_s.homework_id;
  if v_s.id is null or not (app.is_staff(v_h.center_id) or app.is_mentor_of_group(v_h.group_id)) then
    perform app.forbid();
  end if;
  if v_s.status not in ('submitted','reviewed') then raise exception 'nothing to review yet'; end if;
  update public.submissions
     set status = 'reviewed', score = p_score, feedback = p_feedback,
         reviewed_by = app.my_staff_membership(v_h.center_id), reviewed_at = now()
   where id = p_submission;
  perform app.add_activity(v_h.center_id, v_s.student_id, 'homework', 'Homework reviewed',
                           'Score ' || p_score, app.my_staff_membership(v_h.center_id), v_h.id);
end $$;

-- ============================================================ mocks
create function app.mock_result_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    perform app.add_activity(new.center_id, new.student_id, 'mock', 'Mock result',
      'Overall ' || coalesce(app.overall_band(new.reading_band, new.listening_band,
                                              new.writing_band, new.speaking_band)::text, '—'),
      null, new.mock_session_id);
  end if;
  return new;
end $$;
create trigger mock_results_activity after insert or update on public.mock_results
  for each row execute function app.mock_result_activity();

-- ============================================================ notifications
-- Recipients may only flip read_at; the server (service role) sends.
create function app.guard_notification_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not app.is_service() and
     (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'only read_at can be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger notifications_guard before update on public.notifications
  for each row execute function app.guard_notification_update();

-- ============================================================ audit trail
create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (center_id, actor_user_id, table_name, row_id, action, old_data, new_data)
  values ((v_row ->> 'center_id')::uuid, auth.uid(), tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['memberships','students','guardians','enrollments','invoices','payments','attendance_records','mock_results']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function app.audit()', t || '_audit', t);
  end loop;
end $$;

-- ============================================================ grants
-- Callable by signed-in users only; anon can call nothing.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
