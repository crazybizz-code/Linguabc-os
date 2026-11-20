-- 0027: the owner's report (Base44 "Reports": collections, attendance,
-- capacity and academic output over one period).
--
-- Computed in the database so it is exact however many rows a centre has
-- (the API returns at most 1,000 rows per request). Owner and admin only.

create function public.center_report(p_center uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Tashkent');
  v_to   timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Tashkent');
  v jsonb;
begin
  if not app.is_admin(p_center) then perform app.forbid(); end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Choose a period of up to about a year.'; end if;

  select jsonb_build_object(
    'money', (select jsonb_build_object(
        'collected', coalesce(sum(case when kind = 'payment' then amount else -amount end), 0),
        'payments', count(*) filter (where kind = 'payment'),
        'refunds', coalesce(sum(amount) filter (where kind = 'refund'), 0),
        'by_method', coalesce((select jsonb_object_agg(method, total) from (
            select method::text, sum(amount) as total from public.payments
            where center_id = p_center and kind = 'payment' and paid_at >= v_from and paid_at < v_to group by method) m), '{}'))
      from public.payments where center_id = p_center and paid_at >= v_from and paid_at < v_to),
    'invoices', (select jsonb_build_object(
        'invoiced', coalesce(sum(amount) filter (where payment_status <> 'void'), 0),
        'outstanding', coalesce(sum(balance) filter (where payment_status in ('pending','partial','overdue')), 0),
        'overdue', coalesce(sum(balance) filter (where payment_status = 'overdue'), 0),
        'overdue_students', count(distinct student_id) filter (where payment_status = 'overdue'))
      from public.invoice_balances where center_id = p_center and period between date_trunc('month', p_from)::date and p_to),
    'attendance', (select jsonb_build_object(
        'present', count(*) filter (where a.status in ('present','late')),
        'absent', count(*) filter (where a.status = 'absent'),
        'excused', count(*) filter (where a.status = 'excused'),
        'rate', case when count(*) filter (where a.status <> 'excused') > 0
                     then round(100.0 * count(*) filter (where a.status in ('present','late')) / count(*) filter (where a.status <> 'excused')) end)
      from public.attendance_records a join public.lessons l on l.id = a.lesson_id
      where a.center_id = p_center and l.starts_at >= v_from and l.starts_at < v_to),
    'lessons', (select jsonb_build_object(
        'held', count(*) filter (where status <> 'cancelled' and starts_at < now()),
        'cancelled', count(*) filter (where status = 'cancelled'))
      from public.lessons where center_id = p_center and starts_at >= v_from and starts_at < v_to),
    'students', jsonb_build_object(
        'active', (select count(*) from public.students where center_id = p_center and status = 'active'),
        'joined', (select count(*) from public.students where center_id = p_center and joined_on between p_from and p_to),
        'left', (select count(*) from public.students where center_id = p_center and status in ('left','graduated')
                   and updated_at >= v_from and updated_at < v_to)),
    'capacity', (select jsonb_build_object(
        'seats', coalesce(sum(g.capacity), 0),
        'filled', (select count(*) from public.enrollments e join public.groups g2 on g2.id = e.group_id
                    where e.center_id = p_center and e.status = 'active' and g2.status = 'active'),
        'groups', count(*))
      from public.groups g where g.center_id = p_center and g.status = 'active'),
    'academic', jsonb_build_object(
        'homework_set', (select count(*) from public.homework where center_id = p_center and assigned_at >= v_from and assigned_at < v_to),
        'submitted', (select count(*) from public.submissions where center_id = p_center and submitted_at >= v_from and submitted_at < v_to),
        'average_score', (select round(avg(score)) from public.submissions where center_id = p_center and submitted_at >= v_from and submitted_at < v_to and score is not null),
        'mocks', (select count(*) from public.mock_sessions where center_id = p_center and scheduled_at >= v_from and scheduled_at < v_to),
        'average_band', (select round(avg(r.overall_band) * 2) / 2 from public.mock_result_scores r join public.mock_sessions s on s.id = r.mock_session_id
                         where r.center_id = p_center and s.scheduled_at >= v_from and s.scheduled_at < v_to and r.overall_band is not null)),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', m,
        'collected', (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) from public.payments
                      where center_id = p_center and paid_at >= (m::timestamp at time zone 'Asia/Tashkent')
                        and paid_at < ((m + interval '1 month')::timestamp at time zone 'Asia/Tashkent')),
        'invoiced', (select coalesce(sum(amount), 0) from public.invoices where center_id = p_center and period = m and status = 'open'))
        order by m), '[]')
      from generate_series(date_trunc('month', p_to) - interval '5 months', date_trunc('month', p_to), interval '1 month') as m)
  ) into v;
  return v;
end $$;

revoke execute on function public.center_report(uuid, date, date) from public, anon;
grant execute on function public.center_report(uuid, date, date) to authenticated;
