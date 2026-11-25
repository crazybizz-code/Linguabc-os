-- Undo 0035. Edits, transfers and timetable changes made with it stay;
-- the transferred_from links are dropped (billing falls back to 0008 rules).
begin;
drop function public.update_student(uuid, text, text, text, date, uuid, text),
  public.save_guardian(uuid, uuid, text, text, text, boolean),
  public.end_enrollment(uuid, text, date, text), public.transfer_student(uuid, uuid, date, boolean),
  public.update_group(uuid, text, uuid, text, int), public.update_group_schedule(uuid, smallint[], time, time, date),
  public.cancel_lesson(uuid, text), public.move_lesson(uuid, timestamptz, timestamptz), app.clash_message(timestamptz, text),
  app.centre_local_date(uuid);
create or replace function app.issue_invoice(p_enrollment uuid, p_period date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_e public.enrollments; v_id uuid; v_period date := date_trunc('month', p_period)::date;
begin
  select * into v_e from public.enrollments where id = p_enrollment;
  insert into public.invoices (center_id, student_id, enrollment_id, period, amount, due_date)
  values (v_e.center_id, v_e.student_id, v_e.id, v_period,
          round(v_e.monthly_fee * (100 - v_e.discount_percent) / 100)::bigint,
          greatest(v_period + (v_e.due_day - 1), v_e.start_date))
  on conflict (enrollment_id, period) do nothing
  returning id into v_id;
  return v_id;
end $$;
drop function app.period_billed_via_transfer(uuid, date);
alter table public.enrollments drop constraint enrollments_transferred_from_fkey;
alter table public.enrollments drop column transferred_from;
commit;
