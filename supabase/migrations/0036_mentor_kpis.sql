-- 0036: mentor KPIs, computed in the database from the records themselves.
--
-- One row per mentor for a period [p_from, p_to] (dates in the centre's
-- time zone). Every figure is a count over real rows; nothing is
-- estimated, and nothing ranks or scores the mentor. Definitions (shown on
-- the Mentors page too):
--   lessons_due            lessons taught by the mentor (lessons.mentor_id)
--                          that started in the period and before now, not cancelled
--   lessons_cancelled      the mentor's lessons in the period that were cancelled
--   attendance_recorded    lessons_due with at least one attendance mark
--   attendance_completion  attendance_recorded / lessons_due
--   homework_set           homework set in the period for groups the mentor leads now
--   homework_expected      for that homework with a due date in the period and
--                          already past: students actively enrolled in the group
--   homework_submitted     of those, submissions handed in (submitted or reviewed)
--   homework_completion    homework_submitted / homework_expected
--   reviews_needed         submissions handed in during the period that the
--                          database could not mark (score empty) or that were
--                          reviewed — i.e. work that needs a person
--   reviews_done           of those, reviewed
--   review_completion      reviews_done / reviews_needed
--   review_hours_avg       mean hours from hand-in to review, for reviews_done
--   mock_band_avg          mean released overall band of the mentor's groups'
--                          students for mocks held in the period, with
--   mock_band_prev         the same for the period of equal length before it.
--                          Context only: student results depend on more than
--                          the mentor.
-- Who sees what: owner, admin and academic manager see every mentor of
-- the centre; a mentor sees only their own row; nobody else anything.
--
-- Rollback: drop function public.mentor_kpis(uuid, date, date).

create function public.mentor_kpis(p_center uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text; v_from timestamptz; v_to timestamptz; v_prev timestamptz;
  v_me uuid := app.my_membership(p_center, 'mentor');
  v_all boolean := app.is_staff(p_center);
begin
  if not v_all and v_me is null then perform app.forbid(); end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a period of up to about a year.';
  end if;
  select timezone into v_tz from public.centers where id = p_center;
  v_from := p_from::timestamp at time zone v_tz;
  v_to   := (p_to + 1)::timestamp at time zone v_tz;
  v_prev := v_from - (v_to - v_from);

  return jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz, 'mentors', coalesce((
    select jsonb_agg(row_to_json(k)::jsonb order by k.name)
    from (
      select m.id as mentor_id, m.full_name as name, m.status,
        (select count(*) from public.groups g where g.mentor_id = m.id and g.status = 'active') as groups,
        (select count(distinct e.student_id) from public.enrollments e join public.groups g on g.id = e.group_id
          where g.mentor_id = m.id and g.status = 'active' and e.status = 'active') as active_students,
        l.lessons_due, l.lessons_cancelled, l.attendance_recorded,
        case when l.lessons_due > 0 then round(100.0 * l.attendance_recorded / l.lessons_due) end as attendance_completion,
        h.homework_set, h.homework_expected, h.homework_submitted,
        case when h.homework_expected > 0 then round(100.0 * h.homework_submitted / h.homework_expected) end as homework_completion,
        r.reviews_needed, r.reviews_done,
        case when r.reviews_needed > 0 then round(100.0 * r.reviews_done / r.reviews_needed) end as review_completion,
        r.review_hours_avg,
        b.mock_band_avg, b.mock_band_prev
      from public.memberships m
      cross join lateral (
        select count(*) filter (where ls.status <> 'cancelled' and ls.starts_at < now()) as lessons_due,
               count(*) filter (where ls.status = 'cancelled') as lessons_cancelled,
               count(*) filter (where ls.status <> 'cancelled' and ls.starts_at < now()
                                  and exists (select 1 from public.attendance_records a where a.lesson_id = ls.id)) as attendance_recorded
        from public.lessons ls
        where ls.center_id = p_center and ls.mentor_id = m.id and ls.starts_at >= v_from and ls.starts_at < v_to) l
      cross join lateral (
        select count(*) filter (where hw.assigned_at >= v_from and hw.assigned_at < v_to) as homework_set,
               coalesce(sum(hw.expected) filter (where hw.due_at >= v_from and hw.due_at < v_to and hw.due_at < now()), 0) as homework_expected,
               coalesce(sum(hw.handed_in) filter (where hw.due_at >= v_from and hw.due_at < v_to and hw.due_at < now()), 0) as homework_submitted
        from (
          select h.assigned_at, h.due_at,
                 (select count(*) from public.enrollments e where e.group_id = h.group_id and e.status = 'active') as expected,
                 (select count(*) from public.submissions s join public.enrollments e2 on e2.student_id = s.student_id
                   and e2.group_id = h.group_id and e2.status = 'active'
                   where s.homework_id = h.id and s.status in ('submitted','reviewed')) as handed_in
          from public.homework h join public.groups g on g.id = h.group_id
          where h.center_id = p_center and g.mentor_id = m.id) hw) h
      cross join lateral (
        select count(*) as reviews_needed,
               count(*) filter (where s.status = 'reviewed') as reviews_done,
               round((avg(extract(epoch from s.reviewed_at - s.submitted_at)) filter (where s.status = 'reviewed' and s.reviewed_at >= s.submitted_at)) / 3600, 1) as review_hours_avg
        from public.submissions s join public.homework h on h.id = s.homework_id join public.groups g on g.id = h.group_id
        where s.center_id = p_center and g.mentor_id = m.id
          and s.submitted_at >= v_from and s.submitted_at < v_to
          and (s.status = 'reviewed' or (s.status = 'submitted' and s.score is null))) r
      cross join lateral (
        select round(avg(x.overall_band) filter (where x.scheduled_at >= v_from and x.scheduled_at < v_to) * 2) / 2 as mock_band_avg,
               round(avg(x.overall_band) filter (where x.scheduled_at >= v_prev and x.scheduled_at < v_from) * 2) / 2 as mock_band_prev
        from (select ms.scheduled_at, rs.overall_band
              from public.mock_result_scores rs join public.mock_sessions ms on ms.id = rs.mock_session_id
              join public.groups g on g.id = ms.group_id
              where ms.center_id = p_center and g.mentor_id = m.id and rs.released_at is not null and rs.overall_band is not null) x) b
      where m.center_id = p_center and m.role = 'mentor' and m.status in ('active','invited')
        and (v_all or m.id = v_me)
    ) k), '[]'::jsonb));
end $$;

revoke execute on function public.mentor_kpis(uuid, date, date) from public, anon;
grant execute on function public.mentor_kpis(uuid, date, date) to authenticated;
