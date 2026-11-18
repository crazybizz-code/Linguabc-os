-- =====================================================================
-- First invoice must not be due before the student starts.
-- Enrolling on the 18th with due day 5 used to create an invoice due on
-- the 5th of the same month — overdue the moment it was issued.
-- =====================================================================

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

revoke execute on function app.issue_invoice(uuid, date) from public, anon;
grant execute on function app.issue_invoice(uuid, date) to authenticated;
