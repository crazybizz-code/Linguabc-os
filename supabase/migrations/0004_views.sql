-- =====================================================================
-- LinguABC OS — read models for the screens
-- security_invoker = true: every view runs with the caller's RLS, so a
-- mentor querying student_overview still sees only their own students.
-- =====================================================================

-- Payments screen: Paid / Partial / Pending / Overdue / Void per invoice.
create view public.invoice_balances with (security_invoker = true) as
select i.id, i.center_id, i.student_id, i.enrollment_id, i.period, i.due_date, i.amount,
       coalesce(p.net_paid, 0)            as paid,
       i.amount - coalesce(p.net_paid, 0) as balance,
       case
         when i.status = 'void'                         then 'void'
         when coalesce(p.net_paid, 0) >= i.amount        then 'paid'
         when i.due_date < current_date                  then 'overdue'
         when coalesce(p.net_paid, 0) > 0                then 'partial'
         else 'pending'
       end as payment_status
from public.invoices i
left join lateral (
  select sum(case when kind = 'payment' then amount else -amount end) as net_paid
  from public.payments where invoice_id = i.id
) p on true;

-- Student 360 header and the Students table. Finance columns come back
-- null for roles that cannot see invoices (RLS on invoices does that).
create view public.student_overview with (security_invoker = true) as
select s.id, s.center_id, s.branch_id, s.full_name, s.phone, s.status, s.joined_on,
       att.attended, att.total_marked,
       case when att.total_marked > 0
            then round(100.0 * att.attended / att.total_marked) end as attendance_pct,
       hw.assigned as hw_assigned, hw.completed as hw_completed,
       fin.open_balance, fin.overdue_count,
       mk.last_overall_band,
       act.last_activity_at
from public.students s
left join lateral (
  select count(*) filter (where a.status in ('present','late')) as attended,
         count(*) filter (where a.status <> 'excused')         as total_marked
  from public.attendance_records a where a.student_id = s.id
) att on true
left join lateral (
  select count(*) as assigned,
         count(*) filter (where sb.status in ('submitted','reviewed')) as completed
  from public.submissions sb where sb.student_id = s.id
) hw on true
left join lateral (
  select sum(b.balance) filter (where b.payment_status in ('pending','partial','overdue')) as open_balance,
         count(*)       filter (where b.payment_status = 'overdue')                        as overdue_count
  from public.invoice_balances b where b.student_id = s.id
) fin on true
left join lateral (
  select app.overall_band(r.reading_band, r.listening_band, r.writing_band, r.speaking_band) as last_overall_band
  from public.mock_results r join public.mock_sessions ms on ms.id = r.mock_session_id
  where r.student_id = s.id and r.status = 'completed'
  order by ms.scheduled_at desc limit 1
) mk on true
left join lateral (
  select max(occurred_at) as last_activity_at from public.activities x where x.student_id = s.id
) act on true;

-- Groups table: live counts instead of stored counters.
create view public.group_overview with (security_invoker = true) as
select g.id, g.center_id, g.branch_id, g.course_id, g.mentor_id, g.room_id, g.name, g.short_name,
       g.capacity, g.start_date, g.status,
       (select count(*) from public.enrollments e where e.group_id = g.id and e.status = 'active') as student_count,
       (select min(l.starts_at) from public.lessons l
         where l.group_id = g.id and l.status = 'scheduled' and l.starts_at > now())             as next_lesson_at
from public.groups g;

-- Mock results with the computed overall band.
create view public.mock_result_scores with (security_invoker = true) as
select r.*, app.overall_band(r.reading_band, r.listening_band, r.writing_band, r.speaking_band) as overall_band
from public.mock_results r;

revoke all on public.invoice_balances, public.student_overview, public.group_overview,
              public.mock_result_scores from anon;
grant select on public.invoice_balances, public.student_overview, public.group_overview,
                public.mock_result_scores to authenticated;
