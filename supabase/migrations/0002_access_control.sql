-- =====================================================================
-- LinguABC OS — access control (Row Level Security)
--
-- Who sees what
--   owner / admin        everything in their center, including money
--   academic_manager     everything academic in their center, no money
--   mentor               only the groups they teach and those students
--   student              only themselves
--   parent               only their linked children (incl. invoices)
--
-- Sensitive writes (payments, submissions, attendance, enrolment,
-- invitations) happen only through the functions in 0003, which check
-- the role again server-side. Tables without a write policy cannot be
-- written directly by any API user.
-- =====================================================================

-- ------------------------------------------------------------- helpers
-- All helpers are SECURITY DEFINER so policies can read memberships
-- without recursing into memberships' own policy.

create function app.has_role(p_center uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.center_id = p_center
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (p_roles));
$$;

create function app.is_member(p_center uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.center_id = p_center and m.user_id = auth.uid() and m.status = 'active');
$$;

-- owner, admin, academic_manager
create function app.is_staff(p_center uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_center, '{owner,admin,academic_manager}');
$$;

-- owner, admin — the only roles that see or touch money and personal data
create function app.is_admin(p_center uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_role(p_center, '{owner,admin}');
$$;

-- My active membership id in a center for a role (null if none).
create function app.my_membership(p_center uuid, p_role public.member_role)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.memberships m
  where m.center_id = p_center and m.user_id = auth.uid()
    and m.status = 'active' and m.role = p_role
  limit 1;
$$;

create function app.is_mentor_of_group(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.groups g
    join public.memberships m on m.id = g.mentor_id
    where g.id = p_group and m.user_id = auth.uid() and m.status = 'active');
$$;

-- Students I am (student login) or am a parent of.
create function app.my_student_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.students s
  join public.memberships m on m.id = s.membership_id
  where m.user_id = auth.uid() and m.status = 'active'
  union
  select g.student_id from public.guardians g
  join public.memberships m on m.id = g.membership_id
  where m.user_id = auth.uid() and m.status = 'active' and m.role = 'parent';
$$;

create function app.is_mentor_of_student(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.enrollments e
    join public.groups g      on g.id = e.group_id
    join public.memberships m on m.id = g.mentor_id
    where e.student_id = p_student and e.status = 'active'
      and m.user_id = auth.uid() and m.status = 'active');
$$;

-- Academic visibility of a student.
create function app.can_see_student(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.students s
                 where s.id = p_student and app.is_staff(s.center_id))
      or p_student in (select app.my_student_ids())
      or app.is_mentor_of_student(p_student);
$$;

-- Financial visibility of a student: owner/admin, the student, their parents.
create function app.can_see_finance(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.students s
                 where s.id = p_student and app.is_admin(s.center_id))
      or p_student in (select app.my_student_ids());
$$;

create function app.can_see_group(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups g where g.id = p_group and app.is_staff(g.center_id))
      or app.is_mentor_of_group(p_group)
      or exists (select 1 from public.enrollments e
                 where e.group_id = p_group and e.status = 'active'
                   and e.student_id in (select app.my_student_ids()));
$$;

grant usage on schema app to authenticated;
revoke execute on all functions in schema app from public;
grant execute on all functions in schema app to authenticated;

-- ------------------------------------------------------------ enable RLS
do $$
declare t text;
begin
  foreach t in array array[
    'centers','profiles','branches','memberships','rooms','courses','groups',
    'group_schedule_slots','lessons','students','guardians','enrollments',
    'attendance_records','invoices','payments','assignments','homework',
    'submissions','mock_sessions','mock_results','activities','notifications','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ------------------------------------------------------------- policies
-- centers
create policy centers_select on public.centers for select to authenticated
  using (app.is_member(id));
create policy centers_update on public.centers for update to authenticated
  using (app.has_role(id, '{owner}')) with check (app.has_role(id, '{owner}'));

-- profiles: only my own
create policy profiles_self on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- branches / rooms / courses: readable by every member, managed by admins
create policy branches_select on public.branches for select to authenticated using (app.is_member(center_id));
create policy branches_write  on public.branches for all    to authenticated
  using (app.is_admin(center_id)) with check (app.is_admin(center_id));

create policy rooms_select on public.rooms for select to authenticated using (app.is_member(center_id));
create policy rooms_write  on public.rooms for all    to authenticated
  using (app.is_admin(center_id)) with check (app.is_admin(center_id));

create policy courses_select on public.courses for select to authenticated using (app.is_member(center_id));
create policy courses_write  on public.courses for all    to authenticated
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));

-- memberships: staff see the roster, everyone sees their own rows.
-- Writes only through invite_member() / accept_invite() / set_member_status().
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.is_staff(center_id));

-- groups & timetable
create policy groups_select on public.groups for select to authenticated using (app.can_see_group(id));
create policy groups_write  on public.groups for all    to authenticated
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy slots_select on public.group_schedule_slots for select to authenticated using (app.can_see_group(group_id));
create policy slots_write  on public.group_schedule_slots for all    to authenticated
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy lessons_select on public.lessons for select to authenticated using (app.can_see_group(group_id));
create policy lessons_write  on public.lessons for all    to authenticated
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));

-- students & guardians: personal data managed by owner/admin only
create policy students_select on public.students for select to authenticated
  using (app.is_staff(center_id)
      or id in (select app.my_student_ids())
      or app.is_mentor_of_student(id));
create policy students_insert on public.students for insert to authenticated with check (app.is_admin(center_id));
create policy students_update on public.students for update to authenticated
  using (app.is_admin(center_id)) with check (app.is_admin(center_id));

create policy guardians_select on public.guardians for select to authenticated
  using (app.is_staff(center_id) or student_id in (select app.my_student_ids()));
create policy guardians_write on public.guardians for all to authenticated
  using (app.is_admin(center_id)) with check (app.is_admin(center_id));

-- enrollments (fee terms are financial)
create policy enrollments_select on public.enrollments for select to authenticated
  using (app.is_staff(center_id) or app.can_see_finance(student_id) or app.is_mentor_of_group(group_id));
create policy enrollments_update on public.enrollments for update to authenticated
  using (app.is_admin(center_id)) with check (app.is_admin(center_id));

-- attendance: read with the student, write via mark_attendance()
create policy attendance_select on public.attendance_records for select to authenticated
  using (app.can_see_student(student_id));

-- money: owner/admin, the student, their parents. No direct writes at all.
create policy invoices_select on public.invoices for select to authenticated
  using (app.can_see_finance(student_id));
create policy payments_select on public.payments for select to authenticated
  using (app.can_see_finance(student_id));

-- assignments: staff and mentors of the center work with them; students
-- see an assignment only once it has been given to one of their groups.
create policy assignments_select on public.assignments for select to authenticated
  using (app.is_staff(center_id)
      or app.has_role(center_id, '{mentor}')
      or exists (select 1 from public.homework h
                 where h.assignment_id = assignments.id and app.can_see_group(h.group_id)));
create policy assignments_insert on public.assignments for insert to authenticated
  with check (status in ('draft','pending_approval')
          and (app.is_staff(center_id) or app.has_role(center_id, '{mentor}'))
          and created_by in (select m.id from public.memberships m where m.user_id = auth.uid()));
create policy assignments_update on public.assignments for update to authenticated
  using (app.is_staff(center_id)
      or (status in ('draft','pending_approval')
          and created_by in (select m.id from public.memberships m where m.user_id = auth.uid())))
  with check (status <> 'approved' or app.is_staff(center_id));

create policy homework_select on public.homework for select to authenticated using (app.can_see_group(group_id));

create policy submissions_select on public.submissions for select to authenticated
  using (app.can_see_student(student_id));

-- mocks
create policy mock_sessions_select on public.mock_sessions for select to authenticated
  using (app.is_staff(center_id) or (group_id is not null and app.can_see_group(group_id)));
create policy mock_sessions_write on public.mock_sessions for all to authenticated
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy mock_results_select on public.mock_results for select to authenticated
  using (app.can_see_student(student_id));
create policy mock_results_write on public.mock_results for all to authenticated
  using (app.is_staff(center_id) or exists (
          select 1 from public.mock_sessions ms
          where ms.id = mock_session_id
            and ms.examiner_id = app.my_membership(ms.center_id, 'mentor')))
  with check (app.is_staff(center_id) or exists (
          select 1 from public.mock_sessions ms
          where ms.id = mock_session_id
            and ms.examiner_id = app.my_membership(ms.center_id, 'mentor')));

-- timeline: payment entries follow finance visibility
create policy activities_select on public.activities for select to authenticated
  using (app.can_see_student(student_id)
         and (type <> 'payment' or app.can_see_finance(student_id)));

-- notifications: my own inbox; I may only mark as read (see trigger in 0003)
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id in (select m.id from public.memberships m where m.user_id = auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id in (select m.id from public.memberships m where m.user_id = auth.uid()))
  with check (recipient_id in (select m.id from public.memberships m where m.user_id = auth.uid()));

-- audit log: owner only
create policy audit_select on public.audit_log for select to authenticated
  using (center_id is not null and app.has_role(center_id, '{owner}'));
