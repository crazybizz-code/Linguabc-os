-- End-to-end test: two centers, every role, the main V1 flows, and the
-- things that must be refused. Run with psql -v ON_ERROR_STOP=1.
\set QUIET on
\set ON_ERROR_STOP 1
\o /dev/null

-- ---------------------------------------------------------------- harness
create schema tests;
grant usage on schema tests to authenticated, anon;

create function tests.expect_fail(p_sql text, p_pattern text default '') returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm !~* p_pattern then
      raise exception 'expected error ~ "%" but got "%" for: %', p_pattern, sqlerrm, p_sql;
    end if;
    return;
  end;
  raise exception 'expected failure, but it succeeded: %', p_sql;
end $$;

create function tests.expect_count(p_sql text, p_n bigint) returns void
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  if v <> p_n then raise exception 'expected % rows, got % for: %', p_n, v, p_sql; end if;
end $$;
create function tests.login(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_user = '' then '' else
      json_build_object('sub', '00000000-0000-0000-0000-0000000000' || p_user, 'role', 'authenticated')::text end, false);
$$;
create function tests.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'assertion failed: %', p_msg; end if;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@a.uz',   '{"full_name":"Owner A"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin@a.uz',   '{}'),
  ('00000000-0000-0000-0000-0000000000a3', 'acad@a.uz',    '{}'),
  ('00000000-0000-0000-0000-0000000000a4', 'mentor@a.uz',  '{}'),
  ('00000000-0000-0000-0000-0000000000a5', 'student@a.uz', '{}'),
  ('00000000-0000-0000-0000-0000000000a6', 'parent@a.uz',  '{}'),
  ('00000000-0000-0000-0000-0000000000a7', 'student2@a.uz','{}'),
  ('00000000-0000-0000-0000-0000000000a8', 'mentor2@a.uz', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner@b.uz',   '{}');


\set as_ownerA   'reset role; select tests.login(''a1''); set role authenticated;'
\set as_admin    'reset role; select tests.login(''a2''); set role authenticated;'
\set as_acad     'reset role; select tests.login(''a3''); set role authenticated;'
\set as_mentor   'reset role; select tests.login(''a4''); set role authenticated;'
\set as_student  'reset role; select tests.login(''a5''); set role authenticated;'
\set as_parent   'reset role; select tests.login(''a6''); set role authenticated;'
\set as_student2 'reset role; select tests.login(''a7''); set role authenticated;'
\set as_mentor2  'reset role; select tests.login(''a8''); set role authenticated;'
\set as_ownerB   'reset role; select tests.login(''b1''); set role authenticated;'
\set as_anon     'reset role; select tests.login(''''); set role anon;'
\set as_service  'reset role; select set_config(''request.jwt.claims'', ''{"role":"service_role"}'', false); set role authenticated;'
\set as_superuser 'reset role;'

\echo '1. registration, centers, invites'
:as_ownerA
select public.create_center('Alpha English', 'alpha', 'Owner A') as center_a \gset
:as_ownerB
select public.create_center('Beta Academy', 'beta', 'Owner B') as center_b \gset
select tests.expect_fail($$select public.create_center('Xyz', 'alpha', 'Y')$$, 'duplicate');

:as_ownerA
insert into branches (center_id, name) values (:'center_a', 'Chilonzor') returning id as branch_a \gset
insert into rooms (center_id, branch_id, name, capacity) values (:'center_a', :'branch_a', 'Room 1', 12) returning id as room1 \gset
insert into courses (center_id, name, code, level, default_monthly_fee)
  values (:'center_a', 'Exam Prep B2', 'EXAM-B2', 'B2', 800000) returning id as course_a \gset
select membership_id as m_admin,   invite_code as code_admin   from invite_member(:'center_a', 'admin', 'Admin A', 'admin@a.uz') \gset
select membership_id as m_acad,    invite_code as code_acad    from invite_member(:'center_a', 'academic_manager', 'Acad A') \gset
select membership_id as m_mentor,  invite_code as code_mentor  from invite_member(:'center_a', 'mentor', 'Mentor A') \gset
select membership_id as m_mentor2, invite_code as code_mentor2 from invite_member(:'center_a', 'mentor', 'Mentor Two') \gset

:as_admin
select accept_invite(:'code_admin');
select tests.expect_fail(format($$select * from invite_member(%L, 'admin', 'X')$$, :'center_a'), 'only the owner');
:as_acad    select accept_invite(:'code_acad');
:as_mentor  select accept_invite(:'code_mentor');
:as_mentor2 select accept_invite(:'code_mentor2');
select tests.expect_fail(format($$select accept_invite(%L)$$, :'code_mentor'), 'invalid or used');
:as_mentor
select tests.expect_fail(format($$select * from invite_member(%L, 'mentor', 'Sneaky')$$, :'center_a'), 'forbidden');
select tests.expect_count('select * from memberships', 1);

\echo '2. groups, timetable, conflict checks'
:as_admin
insert into groups (center_id, branch_id, course_id, mentor_id, room_id, name, capacity)
  values (:'center_a', :'branch_a', :'course_a', :'m_mentor', :'room1', 'B2 Morning', 2) returning id as group1 \gset
insert into groups (center_id, branch_id, course_id, mentor_id, room_id, name, capacity)
  values (:'center_a', :'branch_a', :'course_a', :'m_mentor2', :'room1', 'B2 Clash', 10) returning id as group2 \gset
insert into group_schedule_slots (center_id, group_id, weekday, start_time, end_time) values
  (:'center_a', :'group1', 1, '09:00', '10:30'), (:'center_a', :'group1', 3, '09:00', '10:30');
insert into group_schedule_slots (center_id, group_id, weekday, start_time, end_time) values
  (:'center_a', :'group2', 1, '10:00', '11:00');
select tests.assert(generate_lessons(:'group1', current_date - 14, current_date + 14) between 7 and 10, 'lessons generated');
select tests.assert(generate_lessons(:'group1', current_date - 14, current_date + 14) = 0, 'generation is idempotent');
select tests.expect_fail(format($$select generate_lessons(%L, current_date - 14, current_date + 14)$$, :'group2'), 'schedule conflict');
select tests.expect_count(format('select * from lessons where group_id = %L', :'group2'), 0);

:as_ownerB
insert into branches (center_id, name) values (:'center_b', 'Main') returning id as branch_b \gset
select tests.expect_fail(format($$insert into groups (center_id, branch_id, course_id, name) values (%L, %L, %L, 'Hack')$$,
                                :'center_b', :'branch_b', :'course_a'), 'foreign key');
select tests.expect_fail(format($$insert into students (center_id, full_name) values (%L, 'Injected')$$, :'center_a'), 'row-level security');

\echo '3. students, guardians, enrolment, invoices'
:as_admin
insert into students (center_id, branch_id, full_name, phone) values (:'center_a', :'branch_a', 'Aziz Karimov', '+998901112233') returning id as st1 \gset
insert into students (center_id, branch_id, full_name) values (:'center_a', :'branch_a', 'Dilnoza Rahimova') returning id as st2 \gset
insert into students (center_id, branch_id, full_name) values (:'center_a', :'branch_a', 'Third Student') returning id as st3 \gset
insert into guardians (center_id, student_id, full_name, phone, relationship, is_primary)
  values (:'center_a', :'st1', 'Karim Karimov', '+998901234567', 'father', true) returning id as g1 \gset
select enroll_student(:'st1', :'group1', null, 10, 5::smallint, current_date - 20) as e1 \gset
select enroll_student(:'st2', :'group1') as e2 \gset
select tests.expect_fail(format($$select enroll_student(%L, %L)$$, :'st3', :'group1'), 'group is full');
select tests.expect_fail(format($$select enroll_student(%L, %L)$$, :'st1', :'group1'), 'already enrolled');
select tests.assert((select amount from invoices where enrollment_id = :'e1') = 720000, '10% discount applied');
select membership_id as m_st1, invite_code as code_st1 from invite_member(:'center_a', 'student', 'Aziz Karimov', p_student => :'st1') \gset
select membership_id as m_st2, invite_code as code_st2 from invite_member(:'center_a', 'student', 'Dilnoza Rahimova', p_student => :'st2') \gset
select membership_id as m_par, invite_code as code_par from invite_member(:'center_a', 'parent', 'Karim Karimov', p_guardian => :'g1') \gset
:as_student  select accept_invite(:'code_st1');
:as_student2 select accept_invite(:'code_st2');
:as_parent   select accept_invite(:'code_par');
:as_acad
select tests.expect_fail(format($$select enroll_student(%L, %L)$$, :'st3', :'group2'), 'forbidden');

\echo '4. attendance'
:as_mentor
select id as lesson_past from lessons where group_id = :'group1' and starts_at < now() - interval '1 day' order by starts_at desc limit 1 \gset
select id as lesson_future from lessons where group_id = :'group1' and starts_at > now() + interval '2 hours' order by starts_at limit 1 \gset
select tests.assert(mark_attendance(:'lesson_past', format('[{"student_id":"%s","status":"present"}]', :'st1')::jsonb) = 1, 'attendance marked');
select tests.expect_fail(format($$select mark_attendance(%L, '[{"student_id":"%s","status":"present"}]')$$, :'lesson_past', :'st2'), 'not in this group');
select tests.expect_fail(format($$select mark_attendance(%L, '[{"student_id":"%s","status":"present"}]')$$, :'lesson_future', :'st1'), 'not started');
select tests.assert((select status from lessons where id = :'lesson_past') = 'held', 'lesson marked held');
:as_mentor2
select tests.expect_fail(format($$select mark_attendance(%L, '[{"student_id":"%s","status":"absent"}]')$$, :'lesson_past', :'st1'), 'forbidden');

\echo '5. who sees what'
:as_mentor
select tests.expect_count('select * from students', 2);
select tests.expect_count('select * from invoices', 0);
select tests.expect_count('select * from payments', 0);
select tests.expect_count('select * from guardians', 0);
select tests.expect_count('select * from groups', 1);
:as_mentor2
select tests.expect_count('select * from students', 0);
:as_acad
select tests.expect_count('select * from students', 3);
select tests.expect_count('select * from invoices', 0);
:as_student
select tests.expect_count('select * from students', 1);
select tests.expect_count('select * from invoices', 1);
select tests.expect_count('select * from attendance_records', 1);
select tests.expect_count('select * from memberships', 1);
select tests.expect_count('select * from guardians', 1);
:as_student2
select tests.expect_count(format('select * from invoices where student_id = %L', :'st1'), 0);
select tests.expect_count(format('select * from students where id = %L', :'st1'), 0);
:as_parent
select tests.expect_count('select * from students', 1);
select tests.expect_count('select * from attendance_records', 1);
select tests.expect_count('select * from invoices', 1);
:as_ownerB
select tests.expect_count('select * from students', 0);
select tests.expect_count('select * from groups', 0);
select tests.expect_count('select * from courses', 0);
select tests.expect_count('select * from activities', 0);
select tests.expect_count('select * from memberships', 1);
select tests.expect_fail(format($$select * from record_payment((select id from invoices limit 1), 1, 'cash')$$), 'forbidden');
:as_anon
select tests.expect_fail('select * from students', 'permission denied');
select tests.expect_fail('select * from invoice_balances', 'permission denied');
select tests.expect_fail($$select public.create_center('x', 'xx', 'y')$$, 'permission denied');

\echo '6. payments ledger'
:as_admin
select id as inv1 from invoices where enrollment_id = :'e1' \gset
select id as inv2 from invoices where enrollment_id = :'e2' \gset
select payment_id as p1, receipt_no as r1 from record_payment(:'inv1', 500000, 'cash') \gset
select tests.assert(:'r1' = 'R-000001', 'receipt numbering');
select tests.assert((select payment_status from invoice_balances where id = :'inv1') = 'overdue', 'past-due partial is overdue');
select tests.expect_fail(format($$select * from record_payment(%L, 300000, 'cash')$$, :'inv1'), 'exceeds');
select tests.expect_fail(format($$select * from record_payment(%L, -5, 'cash')$$, :'inv1'), 'positive');
select payment_id as p2, receipt_no as r2 from record_payment(:'inv1', 220000, 'card') \gset
select tests.assert((select payment_status from invoice_balances where id = :'inv1') = 'paid', 'fully paid');
update payments set amount = 1 where id = :'p1';
select tests.assert((select amount from payments where id = :'p1') = 500000, 'admin cannot edit ledger');
select tests.expect_fail(format($$insert into payments (center_id, student_id, kind, amount, method, receipt_no) values (%L, %L, 'payment', 999, 'cash', 'FAKE-1')$$,
                                :'center_a', :'st1'), 'row-level security');
select tests.expect_fail(format($$select * from refund_payment(%L, 100000, 'overcharge')$$, :'p1'), 'forbidden');
:as_ownerA
select tests.expect_fail(format($$select * from refund_payment(%L, 100000, '')$$, :'p1'), 'needs a reason');
select receipt_no as rf1 from refund_payment(:'p1', 100000, 'overcharge') \gset
select tests.assert(:'rf1' = 'RF-000003', 'refund receipt');
select tests.expect_fail(format($$select * from refund_payment(%L, 400001, 'again')$$, :'p1'), 'exceeds');
select tests.assert((select balance from invoice_balances where id = :'inv1') = 100000, 'balance after refund');
select tests.expect_fail(format($$select void_invoice(%L)$$, :'inv1'), 'refund the payments');
:as_superuser
select tests.expect_fail(format($$update payments set amount = 1 where id = %L$$, :'p1'), 'append-only');
select tests.expect_fail(format($$delete from payments where id = %L$$, :'p1'), 'append-only');
:as_service
select receipt_no as w1 from record_payment(:'inv2', 100000, 'payme', null, 'PAYME-123') \gset
select receipt_no as w2 from record_payment(:'inv2', 100000, 'payme', null, 'PAYME-123') \gset
select tests.assert(:'w1' = :'w2', 'webhook retry is idempotent');
:as_superuser
select tests.assert((select count(*) from payments where provider_txn_id = 'PAYME-123') = 1, 'one row per provider txn');

\echo '7. homework workflow'
:as_mentor
insert into assignments (center_id, title, skill, level, source, content, status, created_by)
  values (:'center_a', 'Inference practice', 'reading', 'B2', 'ai', '{"questions":[1,2,3]}', 'draft', :'m_mentor') returning id as a1 \gset
select tests.expect_fail(format($$update assignments set status = 'approved', approved_by = %L where id = %L$$, :'m_mentor', :'a1'), 'row-level security');
select tests.expect_fail(format($$select approve_assignment(%L)$$, :'a1'), 'forbidden');
select tests.expect_fail(format($$select assign_homework(%L, %L, now() + interval '3 days')$$, :'a1', :'group1'), 'approved first');
:as_student
select tests.expect_count('select * from assignments', 0);
:as_acad
select approve_assignment(:'a1');
:as_mentor
select assign_homework(:'a1', :'group1', now() + interval '3 days') as hw1 \gset
select tests.expect_fail(format($$select assign_homework(%L, %L, now() + interval '3 days')$$, :'a1', :'group2'), 'forbidden');
:as_student
select tests.expect_count('select * from submissions', 1);
select tests.expect_count('select * from assignments', 1);
select tests.assert(save_submission(:'hw1', '{"1":"A"}', false) = 'in_progress', 'draft saved');
update submissions set score = 100 where student_id = :'st1';
select tests.assert(save_submission(:'hw1', '{"1":"A","2":"B"}', true) = 'submitted', 'submitted');
select tests.assert((select score from submissions where homework_id = :'hw1') is null, 'student cannot self-score');
select tests.expect_fail(format($$select save_submission(%L, '{}', false)$$, :'hw1'), 'already submitted');
:as_student2
select tests.expect_count(format('select * from submissions where student_id = %L', :'st1'), 0);
:as_mentor
select id as sub1 from submissions where student_id = :'st1' and homework_id = :'hw1' \gset
select review_submission(:'sub1', 85, 'Good inference work');
:as_mentor2
select tests.expect_fail(format($$select review_submission(%L, 10, 'x')$$, :'sub1'), 'forbidden');
:as_parent
select tests.assert((select score from submissions where id = :'sub1') = 85, 'parent sees the score');

\echo '8. mocks'
:as_acad
insert into mock_sessions (center_id, group_id, name, scheduled_at, examiner_id)
  values (:'center_a', :'group1', 'Mock #1', now() - interval '1 day', :'m_mentor') returning id as ms1 \gset
:as_mentor
insert into mock_results (center_id, mock_session_id, student_id, status, reading_band, listening_band, writing_band, speaking_band)
  values (:'center_a', :'ms1', :'st1', 'completed', 6.5, 7.0, 6.0, 6.5);
select tests.assert((select overall_band from mock_result_scores where student_id = :'st1') = 6.5, 'overall band');
select tests.expect_fail(format($$insert into mock_results (center_id, mock_session_id, student_id, reading_band) values (%L, %L, %L, 6.3)$$,
                                :'center_a', :'ms1', :'st2'), 'check');
:as_mentor2
select tests.expect_fail(format($$insert into mock_results (center_id, mock_session_id, student_id) values (%L, %L, %L)$$,
                                :'center_a', :'ms1', :'st2'), 'row-level security');
:as_superuser
select tests.assert(app.overall_band(6, 6, 6, 6.5) = 6.0, 'band rounding 6.125');
select tests.assert(app.overall_band(6.5, 6.5, 6, 6) = 6.5, 'band rounding 6.25');
select tests.assert(app.overall_band(7, 7, 7, 6) = 7.0, 'band rounding 6.75');

\echo '9. Student 360 read model'
:as_admin
select tests.assert((select attendance_pct = 100 and hw_assigned = 1 and hw_completed = 1
                            and open_balance = 100000 and last_overall_band = 6.5
                     from student_overview where id = :'st1'), 'admin overview');
select tests.assert((select student_count from group_overview where id = :'group1') = 2, 'group count');
:as_mentor
select tests.assert((select open_balance is null and attendance_pct = 100 from student_overview where id = :'st1'), 'mentor sees no money');
select tests.expect_count($$select * from activities where type = 'payment'$$, 0);
:as_parent
select tests.assert((select open_balance from student_overview where id = :'st1') = 100000, 'parent sees balance');

\echo '10. audit trail & notifications'
:as_ownerA
select tests.assert((select count(*) from audit_log where table_name = 'payments') = 4, 'payments audited');
:as_admin
select tests.expect_count('select * from audit_log', 0);
:as_superuser
insert into notifications (center_id, recipient_id, title) values (:'center_a', :'m_st1', 'Homework reviewed') returning id as n1 \gset
:as_student
update notifications set read_at = now() where id = :'n1';
select tests.assert((select read_at is not null from notifications where id = :'n1'), 'mark as read');
select tests.expect_fail(format($$update notifications set title = 'x' where id = %L$$, :'n1'), 'only read_at');
:as_student2
select tests.expect_count(format('select * from notifications where id = %L', :'n1'), 0);

\echo '11. workspace RPCs'
:as_admin
select create_student(:'center_a', 'Wizard Kid', '+998 90 555 44 33', null, null, null, null) as wz_lead \gset
select tests.assert((select status from students where id = :'wz_lead') = 'lead', 'student without group is a lead');
select create_group(:'center_a', 'B1 Evening', :'course_a', :'branch_a', :'m_mentor2', 'Room 7', 12, current_date,
                    '{2,4}'::smallint[], '18:00', '19:30') as g3 \gset
select tests.assert((select count(*) from lessons where group_id = :'g3') between 20 and 26, 'lessons for 12 weeks');
select tests.assert((select count(*) from rooms where name = 'Room 7') = 1, 'room created');
select create_student(:'center_a', 'Wizard Two', null, null, null, null, :'g3', 500000, 0, 10::smallint,
                      'Mum Two', '+998 91 000 00 00', 'mother') as wz2 \gset
select tests.assert((select count(*) from enrollments where student_id = :'wz2') = 1, 'wizard enrolled');
select tests.assert((select amount from invoices where student_id = :'wz2') = 500000, 'wizard invoiced');
select tests.assert((select due_date from invoices where student_id = :'wz2') >= current_date, 'first invoice not due before start');
select tests.assert((select count(*) from guardians where student_id = :'wz2') = 1, 'wizard guardian');
select tests.expect_fail(format($$select create_group(%L, 'Clash', %L, %L, %L, 'Room 7', 10, current_date, '{2}'::smallint[], '19:00', '20:00')$$,
                                :'center_a', :'course_a', :'branch_a', :'m_mentor'), 'schedule conflict');
select tests.expect_count($$select * from groups where name = 'Clash'$$, 0);
:as_mentor
select tests.expect_fail(format($$select create_student(%L, 'Sneaky')$$, :'center_a'), 'forbidden');
:as_ownerB
select tests.expect_fail(format($$select create_group(%L, 'X group', %L, %L)$$, :'center_a', :'course_a', :'branch_a'), 'forbidden');

\echo '12. portal helpers'
:as_parent
select tests.assert(group_mentor_name(:'group1') = 'Mentor A', 'parent sees child''s mentor');
select tests.assert(group_mentor_name(:'group2') is null, 'parent cannot see other group mentor');
:as_student2
select tests.assert(group_mentor_name(:'group1') = 'Mentor A', 'student sees own mentor');
:as_ownerB
select tests.assert(group_mentor_name(:'group1') is null, 'other centre sees nothing');

\echo '13. mock sessions'
:as_acad
select create_mock_session(:'center_a', 'Full Mock', :'group1', now() + interval '2 days', :'m_mentor', :'room1') as ms2 \gset
select tests.assert((select count(*) from mock_results where mock_session_id = :'ms2') = 2, 'active students become participants');
select tests.expect_fail(format($$select create_mock_session(%L, 'Bad examiner', %L, now(), %L)$$, :'center_a', :'group1', :'m_mentor2'), 'examiner must be');
select tests.expect_fail(format($$select create_mock_session(%L, 'No modules', %L, now(), null, null, '{}')$$, :'center_a', :'group1'), 'at least one');
select tests.expect_fail(format($$select create_mock_session(%L, 'Vocab', %L, now(), null, null, '{vocabulary}')$$, :'center_a', :'group1'), 'at least one');
:as_mentor
select tests.expect_fail(format($$select create_mock_session(%L, 'Mentor mock', %L, now())$$, :'center_a', :'group1'), 'forbidden');
select save_mock_results(:'ms2', jsonb_build_array(jsonb_build_object('student_id', :'st1', 'reading', 6.5, 'listening', 7)));
select tests.assert((select status from mock_results where mock_session_id = :'ms2' and student_id = :'st1') = 'in_progress', 'partial result');
select tests.assert((select status from mock_sessions where id = :'ms2') = 'in_progress', 'session in progress');
select save_mock_results(:'ms2', jsonb_build_array(
  jsonb_build_object('student_id', :'st1', 'reading', 6.5, 'listening', 7, 'writing', 6, 'speaking', 6.5),
  jsonb_build_object('student_id', :'st2', 'reading', 5, 'absent', true)));
select tests.assert((select status from mock_sessions where id = :'ms2') = 'completed', 'session completed');
select tests.assert((select reading_band from mock_results where mock_session_id = :'ms2' and student_id = :'st2') is null, 'absent clears bands');
select tests.assert((select count(*) from activities where ref_id = :'ms2' and student_id = :'st1') = 0, 'not on timeline before release');
:as_student
select tests.expect_count(format('select * from mock_results where mock_session_id = %L', :'ms2'), 0);
:as_mentor
select tests.assert(release_mock_results(:'ms2') = 2, 'completed and absent results released');
select tests.assert((select count(*) from activities where ref_id = :'ms2' and student_id = :'st1') = 1, 'result on timeline after release');
:as_student
select tests.expect_count(format('select * from mock_results where mock_session_id = %L', :'ms2'), 1);
:as_mentor
select save_mock_results(:'ms2', jsonb_build_array(jsonb_build_object('student_id', :'st1', 'reading', 5, 'listening', 5, 'writing', 5, 'speaking', 5)));
select tests.assert((select reading_band from mock_results where mock_session_id = :'ms2' and student_id = :'st1') = 6.5, 'released results are final');
select tests.expect_fail(format($$select save_mock_results(%L, '[{"student_id":"%s","reading":6}]')$$, :'ms2', :'st3'), 'not in this session');
:as_mentor2
select tests.expect_fail(format($$select save_mock_results(%L, '[]')$$, :'ms2'), 'forbidden');
:as_ownerB
select tests.expect_fail(format($$select save_mock_results(%L, '[]')$$, :'ms2'), 'forbidden');
select tests.expect_fail(format($$select create_mock_session(%L, 'X', %L, now())$$, :'center_a', :'group1'), 'forbidden');
:as_acad
select create_mock_session(:'center_a', 'Listening check', :'group1', now(), null, null, '{listening}') as ms3 \gset
select save_mock_results(:'ms3', jsonb_build_array(jsonb_build_object('student_id', :'st1', 'listening', 7.5, 'reading', 9)));
select tests.assert((select status from mock_results where mock_session_id = :'ms3' and student_id = :'st1') = 'completed', 'single-module result completes');
select tests.assert((select reading_band from mock_results where mock_session_id = :'ms3' and student_id = :'st1') is null, 'off-session module ignored');
select tests.expect_fail(format($$select save_mock_results(%L, '[{"student_id":"%s","listening":6.3}]')$$, :'ms3', :'st1'), 'check');

\echo '14. library and answer keys'
:as_superuser
insert into library_items (id, kind, title, skill, level_min, level_max, body_html, questions)
  values ('lib-1', 'article', 'Ocean currents', 'reading', 'B1', 'B2', 'Text', '[{"id":"q1","type":"mc","prompt":"Why?","options":["a","b"]}]'),
         ('lib-empty', 'article', 'No questions', 'reading', 'B1', 'B2', 'Text', '[]'),
         ('lib-hidden', 'article', 'Hidden', 'reading', 'B1', 'B2', 'Text', '[]');
update library_items set status = 'hidden' where id = 'lib-hidden';
insert into library_answer_keys (item_id, answers) values ('lib-1', '{"q1":{"answer":1,"explanation":"Because"}}');
:as_student
select tests.expect_count($$select * from library_items$$, 2);
select tests.expect_count($$select * from library_answer_keys$$, 0);
:as_mentor
select tests.expect_count($$select * from library_answer_keys$$, 1);
select assign_library_item(:'center_a', 'lib-1', :'group1', now() + interval '2 days', 'Read twice') as hw_lib \gset
select tests.assert((select note from homework where id = :'hw_lib') = 'Read twice', 'note stored on homework');
select tests.assert((select status from assignments a join homework h on h.assignment_id = a.id where h.id = :'hw_lib') = 'approved', 'library work needs no approval');
select tests.expect_fail(format($$select assign_library_item(%L, 'lib-1', %L, now() + interval '2 days')$$, :'center_a', :'group2'), 'forbidden');
select tests.expect_fail(format($$select assign_library_item(%L, 'lib-empty', %L, now() + interval '2 days')$$, :'center_a', :'group1'), 'no questions');
select tests.expect_fail(format($$select assign_library_item(%L, 'lib-hidden', %L, now() + interval '2 days')$$, :'center_a', :'group1'), 'not found');
:as_acad
select assign_library_item(:'center_a', 'lib-1', :'group1', now() + interval '9 days') as hw_lib2 \gset
select tests.assert((select count(*) from assignments where library_item_id = 'lib-1') = 1, 'one centre copy per item');
select tests.assert((select answers->'q1'->>'answer' from assignment_keys k join assignments a on a.id = k.assignment_id where a.library_item_id = 'lib-1') = '1', 'key copied');
:as_student
select tests.expect_count($$select * from assignments where library_item_id = 'lib-1'$$, 1);
select tests.expect_count($$select * from assignment_keys$$, 0);
select tests.assert((select content::text from assignments where library_item_id = 'lib-1') not like '%explanation%', 'no answers in student-visible content');
:as_parent
select tests.expect_count($$select * from assignment_keys$$, 0);
:as_ownerB
select tests.expect_count($$select * from assignment_keys$$, 0);
select tests.expect_fail(format($$select assign_library_item(%L, 'lib-1', %L, now() + interval '2 days')$$, :'center_a', :'group1'), 'forbidden');

\echo '15. homework grading'
:as_student
select tests.assert(my_homework_result(:'hw_lib') is null, 'no key before submitting');
select tests.assert(save_submission(:'hw_lib', '{"q1":0}', false) = 'in_progress', 'progress saved');
select tests.assert((select score from submissions s join students st on st.id = s.student_id where s.homework_id = :'hw_lib' and st.id = :'st1') is null, 'no score while in progress');
select tests.assert(save_submission(:'hw_lib', '{"q1":1}', true) = 'submitted', 'submitted');
select tests.assert((select score from submissions where homework_id = :'hw_lib' and student_id = :'st1') = 100, 'auto-graded 100');
select tests.assert((my_homework_result(:'hw_lib')->'key'->'q1'->>'answer') = '1', 'key visible after submitting');
select tests.assert((select count(*) from activities where ref_id = :'hw_lib' and detail like '%100%%') = 1, 'score on timeline');
select tests.expect_fail(format($$select save_submission(%L, '"x"', true)$$, :'hw_lib2'), 'must be an object');
select save_submission(:'hw_lib2', '{"q1":3}', true);
select tests.assert((select score from submissions where homework_id = :'hw_lib2' and student_id = :'st1') = 0, 'wrong answer scores 0');
:as_student2
select tests.assert(my_homework_result(:'hw_lib') is null, 'classmate cannot see another result');
:as_parent
select tests.assert(my_homework_result(:'hw_lib') is null, 'parent gets no key');
select tests.assert((select score from submissions where homework_id = :'hw_lib' and student_id = :'st1') = 100, 'parent sees the score');
:as_mentor
select id as sub_lib from submissions where homework_id = :'hw_lib2' and student_id = :'st1' \gset
select review_submission(:'sub_lib', 50, 'Re-read paragraph 2');
select tests.assert((select status from submissions where id = :'sub_lib') = 'reviewed', 'mentor reviewed');
:as_student
select tests.assert((my_homework_result(:'hw_lib2')->>'feedback') = 'Re-read paragraph 2', 'student sees feedback');

\echo '16. custom assignments and AI limits'
:as_mentor
select create_custom_assignment(:'center_a', 'Essay practice', 'writing', 'B2', 'ai', 'Read this.',
  '[{"id":"q1","type":"mc","prompt":"Pick one","options":["a","b","c"]},{"id":"q2","type":"open","prompt":"Write 150 words"}]',
  '{"q1":{"answer":2}}') as ca1 \gset
select tests.assert((select status from assignments where id = :'ca1') = 'pending_approval', 'mentor draft needs approval');
select tests.expect_fail(format($$select assign_assignment(%L, %L, now() + interval '2 days')$$, :'ca1', :'group1'), 'approved first');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Bad', 'reading', 'B2', 'ai', null, '[{"id":"q1","type":"mc","prompt":"Pick","options":["a","b"]}]', '{"q1":{"answer":5}}')$$, :'center_a'), 'correct option');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Bad', 'reading', 'B2', 'ai', null, '[]', '{}')$$, :'center_a'), 'at least one');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Bad', 'reading', 'B2', 'ai', null, '[{"id":"q1","type":"mc","prompt":"Pick","options":["a",""]}]', '{"q1":{"answer":0}}')$$, :'center_a'), 'empty option');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Bad', 'reading', 'B2', 'library', null, '[{"id":"q1","type":"open","prompt":"Write"}]', '{}')$$, :'center_a'), 'unsupported');
:as_acad
select approve_assignment(:'ca1');
select assign_assignment(:'ca1', :'group1', now() + interval '2 days', 'Plan first') as hw_c \gset
select tests.assert((select note from homework where id = :'hw_c') = 'Plan first', 'note saved');
select create_custom_assignment(:'center_a', 'Staff quiz', 'grammar', 'B1', 'upload', null, '[{"id":"q1","type":"mc","prompt":"Pick one","options":["x","y"]}]', '{"q1":{"answer":0}}') as ca2 \gset
select tests.assert((select status from assignments where id = :'ca2') = 'approved', 'staff work is approved');
:as_student
select tests.assert((select content::text from assignments where id = :'ca1') not like '%"answer"%', 'no key in student view');
select save_submission(:'hw_c', '{"q1":2,"q2":"My essay text"}', true);
select tests.assert((select score from submissions where homework_id = :'hw_c' and student_id = :'st1') = 100, 'only mc auto-graded');
select tests.expect_fail(format($$select save_submission(%L, %L, false)$$, :'hw_c', jsonb_build_object('q2', repeat('x', 100001))), 'too long');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Sneaky', 'reading', 'B2', 'ai', null, '[{"id":"q1","type":"open","prompt":"Write"}]', '{}')$$, :'center_a'), 'forbidden');
select tests.expect_fail(format($$select claim_ai_request(%L, 'generate')$$, :'center_a'), 'forbidden');
:as_mentor
select claim_ai_request(:'center_a', 'generate') as ai1 \gset
select finish_ai_request(:'ai1', 'google/gemini-3.7-flash', 900, 1500, 0.003150, true);
select finish_ai_request(:'ai1', 'x', 1, 1, 9, true);
select tests.expect_count('select * from ai_requests', 0);
:as_superuser
select tests.assert((select cost_usd from ai_requests where id = :'ai1') = 0.003150, 'usage recorded once');
:as_ownerA
select tests.expect_count(format('select * from ai_requests where center_id = %L', :'center_a'), 1);
:as_mentor
select claim_ai_request(:'center_a', 'generate') from generate_series(1, 19);
select tests.expect_fail(format($$select claim_ai_request(%L, 'generate')$$, :'center_a'), '20 requests per hour');
:as_ownerB
select tests.expect_fail(format($$select claim_ai_request(%L, 'extract')$$, :'center_a'), 'forbidden');
select finish_ai_request(:'ai1', 'x', 1, 1, 9, false);
:as_superuser
select tests.assert((select ok from ai_requests where id = :'ai1'), 'other users cannot overwrite usage');

\echo '17. IELTS question types'
:as_acad
select create_custom_assignment(:'center_a', 'IELTS mixed set', 'reading', 'B2', 'ai',
  'Paragraph A ... Paragraph B ...',
  $q$[
    {"id":"q1","type":"mc","prompt":"Pick one","options":["alpha","beta","gamma"]},
    {"id":"q2","type":"multi","prompt":"Pick TWO","options":["a","b","c","d","e"]},
    {"id":"q3","type":"tfng","prompt":"The writer agrees."},
    {"id":"q4","type":"ynng","prompt":"The claim is supported."},
    {"id":"q5","type":"gap","prompt":"It opened in ____","max_words":2},
    {"id":"q6","type":"headings","group":"g1","prompt":"Paragraph A"},
    {"id":"q7","type":"headings","group":"g1","prompt":"Paragraph B"},
    {"id":"q8","type":"open","prompt":"Write 150 words about the text."}
  ]$q$::jsonb,
  $k$ {"q1":{"answer":1},"q2":{"answer":[0,3]},"q3":{"answer":"false"},"q4":{"answer":"not_given"},
       "q5":{"accepted":["1897","in 1897"]},"q6":{"answer":2},"q7":{"answer":0},"q8":{}} $k$::jsonb,
  $g$[{"id":"g1","instructions":"Choose the correct heading","options":["i Growth","ii Decline","iii Reform"]}]$g$::jsonb) as ca3 \gset
select assign_assignment(:'ca3', :'group1', now() + interval '3 days') as hw_i \gset

-- everything right: 9 marks (multi counts 2)
:as_student
select save_submission(:'hw_i', $a$ {"q1":1,"q2":[3,0],"q3":"false","q4":"not_given","q5":" In 1897. ","q6":2,"q7":0,"q8":"my essay"} $a$::jsonb, true);
select tests.assert((select score from submissions where homework_id = :'hw_i' and student_id = :'st1') = 100, 'all types graded correct');
select tests.assert((my_homework_result(:'hw_i')->'marks'->'q2'->>'total') = '2', 'multi is worth two marks');
select tests.assert((my_homework_result(:'hw_i')->'marks'->>'q8') is null, 'open is not auto-marked');

-- partial and wrong answers
:as_acad
select create_custom_assignment(:'center_a', 'IELTS second set', 'reading', 'B2', 'ai', null,
  $q$[{"id":"q1","type":"multi","prompt":"Pick TWO","options":["a","b","c","d"]},
      {"id":"q2","type":"gap","prompt":"____","max_words":1},
      {"id":"q3","type":"tfng","prompt":"X"}]$q$::jsonb,
  $k$ {"q1":{"answer":[0,2]},"q2":{"accepted":["whale"]},"q3":{"answer":"not_given"}} $k$::jsonb) as ca4 \gset
select assign_assignment(:'ca4', :'group1', now() + interval '3 days') as hw_j \gset
:as_student
-- one of two multi right, gap over the word limit, tfng wrong -> 1 of 4 marks
select save_submission(:'hw_j', $a$ {"q1":[0,1],"q2":"a blue whale","q3":"true"} $a$::jsonb, true);
select tests.assert((select score from submissions where homework_id = :'hw_j' and student_id = :'st1') = 25, 'partial multi, word limit and wrong tfng');
select tests.assert((my_homework_result(:'hw_j')->'marks'->'q1'->>'earned') = '1', 'one of two selections earned');
select tests.assert((my_homework_result(:'hw_j')->'marks'->'q2'->>'earned') = '0', 'over the word limit is wrong');

-- selecting more than asked earns nothing
:as_acad
select create_custom_assignment(:'center_a', 'IELTS third set', 'reading', 'B2', 'ai', null,
  $q$[{"id":"q1","type":"multi","prompt":"Pick TWO","options":["a","b","c","d"]}]$q$::jsonb,
  $k$ {"q1":{"answer":[0,2]}} $k$::jsonb) as ca5 \gset
select assign_assignment(:'ca5', :'group1', now() + interval '3 days') as hw_k \gset
:as_student
select save_submission(:'hw_k', '{"q1":[0,1,2,3]}', true);
select tests.assert((select score from submissions where homework_id = :'hw_k' and student_id = :'st1') = 0, 'choosing everything scores nothing');

-- validation
:as_acad
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Bad multi', 'reading', 'B2', 'ai', null,
  '[{"id":"q1","type":"multi","prompt":"p","options":["a","b"]}]', '{"q1":{"answer":[0,1]}}')$$, :'center_a'), 'every option correct');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Bad tfng', 'reading', 'B2', 'ai', null,
  '[{"id":"q1","type":"tfng","prompt":"p"}]', '{"q1":{"answer":"maybe"}}')$$, :'center_a'), 'correct answer for question');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Bad gap', 'reading', 'B2', 'ai', null,
  '[{"id":"q1","type":"gap","prompt":"p","max_words":1}]', '{"q1":{"accepted":["two words here"]}}')$$, :'center_a'), 'longer than its own word limit');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'No group', 'reading', 'B2', 'ai', null,
  '[{"id":"q1","type":"headings","group":"gX","prompt":"p"}]', '{"q1":{"answer":0}}')$$, :'center_a'), 'group that does not exist');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Bad audio', 'listening', 'B2', 'ai', null,
  '[{"id":"q1","type":"tfng","prompt":"p"}]', '{"q1":{"answer":"true"}}', '[]', 'http://x.mp3')$$, :'center_a'), 'must be https');

-- mentor review sees the same marks
:as_mentor
select id as sub_i from submissions where homework_id = :'hw_j' and student_id = :'st1' \gset
select tests.assert((submission_marks(:'sub_i')->'q1'->>'earned') = '1', 'mentor sees the marks');
:as_ownerB
select tests.expect_fail(format($$select submission_marks(%L)$$, :'sub_i'), 'forbidden');

\echo '18. listening audio'
select :'center_a' || '/11111111-1111-4111-8111-111111111111.mp3' as audio1,
       :'center_a' || '/22222222-2222-4222-8222-222222222222.mp3' as audio2,
       :'center_b' || '/33333333-3333-4333-8333-333333333333.mp3' as audio_b \gset
-- who may upload
:as_mentor
insert into storage.objects (bucket_id, name) values ('listening-audio', :'audio1');
insert into storage.objects (bucket_id, name) values ('listening-audio', :'audio2');
select tests.expect_fail(format($$insert into storage.objects (bucket_id, name) values ('listening-audio', %L)$$, :'audio_b'), 'row-level security');
select tests.expect_fail(format($$insert into storage.objects (bucket_id, name) values ('listening-audio', %L)$$, :'center_a' || '/x.mp3'), 'row-level security');
:as_student
select tests.expect_fail(format($$insert into storage.objects (bucket_id, name) values ('listening-audio', %L)$$, :'center_a' || '/44444444-4444-4444-8444-444444444444.mp3'), 'row-level security');
select tests.expect_count('select * from storage.objects', 0);
:as_ownerB
select tests.expect_count('select * from storage.objects', 0);

-- assignment with generated audio: the transcript goes to the key
:as_mentor
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Lost audio', 'listening', 'B1', 'ai', 'A: hi', '[{"id":"q1","type":"tfng","prompt":"p"}]', '{"q1":{"answer":"true"}}', '[]', null, %L)$$,
  :'center_a', :'center_a' || '/55555555-5555-4555-8555-555555555555.mp3'), 'not found');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Both', 'listening', 'B1', 'ai', 'A: hi', '[{"id":"q1","type":"tfng","prompt":"p"}]', '{"q1":{"answer":"true"}}', '[]', 'https://x/a.mp3', %L)$$,
  :'center_a', :'audio1'), 'not both');
select create_custom_assignment(:'center_a', 'Station announcement', 'listening', 'B1', 'ai',
  'Speaker 1: The 9.15 train to Samarkand leaves from platform four.',
  '[{"id":"q1","type":"gap","prompt":"The train leaves from platform ____","max_words":1}]',
  '{"q1":{"accepted":["four","4"]}}', '[]', null, :'audio1') as la1 \gset
select tests.assert((select content->>'audio_path' from assignments where id = :'la1') = :'audio1', 'audio path stored');
select tests.assert((select content ? 'passage' from assignments where id = :'la1') = false, 'transcript not in content');
select tests.assert((select transcript from assignment_keys where assignment_id = :'la1') like '%platform four%', 'transcript kept with the key');
select tests.expect_fail(format($$select create_custom_assignment(%L, 'Reuse', 'listening', 'B1', 'ai', 'x', '[{"id":"q1","type":"tfng","prompt":"p"}]', '{"q1":{"answer":"true"}}', '[]', null, %L)$$,
  :'center_a', :'audio1'), 'already used');
delete from storage.objects where name = :'audio1';
:as_superuser
select tests.assert(exists (select 1 from storage.objects where name = :'audio1'), 'used audio cannot be deleted');
-- an unused preview can be removed by its uploader only
:as_acad
delete from storage.objects where name = :'audio2';
:as_superuser
select tests.assert(exists (select 1 from storage.objects where name = :'audio2'), 'only the uploader deletes');
:as_mentor
delete from storage.objects where name = :'audio2';
:as_superuser
select tests.assert(not exists (select 1 from storage.objects where name = :'audio2'), 'uploader removed the unused preview');

-- who may listen
:as_student
select tests.expect_count(format('select * from storage.objects where name = %L', :'audio1'), 0);
:as_acad
select approve_assignment(:'la1');
select assign_assignment(:'la1', :'group1', now() + interval '2 days') as hw_l \gset
:as_student
select tests.expect_count(format('select * from storage.objects where name = %L', :'audio1'), 1);
select tests.assert((select content::text from assignments where id = :'la1') not like '%platform four%', 'student cannot read the transcript');
select tests.assert(my_homework_result(:'hw_l') is null, 'nothing before submitting');
select save_submission(:'hw_l', '{"q1":"4"}', true);
select tests.assert((my_homework_result(:'hw_l')->>'transcript') like '%platform four%', 'transcript after submitting');
select tests.assert((select score from submissions where homework_id = :'hw_l' and student_id = :'st1') = 100, 'listening marked');
:as_parent
select tests.expect_count(format('select * from storage.objects where name = %L', :'audio1'), 1);
:as_ownerB
select tests.expect_count(format('select * from storage.objects where name = %L', :'audio1'), 0);
:as_anon
select tests.expect_fail(format($$select * from storage.objects where name = %L$$, :'audio1'), '');
:as_acad
select claim_ai_request(:'center_a', 'audio') as ai_audio \gset
:as_superuser
select tests.assert((select kind from ai_requests where id = :'ai_audio') = 'audio', 'audio is an AI request kind');

\echo '19. library tests (platform admins)'
:as_superuser
insert into platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
:as_ownerB
select tests.assert(not am_platform_admin(), 'ownerB is not a platform admin');
select tests.expect_fail($$select new_library_test('listening', 'Sneaky test')$$, 'forbidden');
select tests.expect_fail($$select claim_admin_ai_request('test')$$, 'forbidden');
select tests.expect_fail('select * from platform_admins', 'permission denied');
:as_ownerA
select tests.assert(am_platform_admin(), 'ownerA is a platform admin');
select claim_admin_ai_request('test') as admin_ai \gset
:as_superuser
select tests.assert((select center_id is null and kind = 'test' from ai_requests where id = :'admin_ai'), 'admin AI use belongs to no centre');
:as_ownerA
select tests.expect_fail($$select new_library_test('writing', 'Essay test')$$, 'reading or listening');
select new_library_test('listening', 'Listening Test 1', 'B2') as lt \gset
insert into storage.objects (bucket_id, name) select 'library-audio', format('tests/%s/00000000-0000-4000-8000-00000000000%s.mp3', :'lt', n) from generate_series(1, 3) n;
:as_ownerB
select tests.expect_fail(format($$insert into storage.objects (bucket_id, name) values ('library-audio', 'tests/%s/00000000-0000-4000-8000-000000000009.mp3')$$, :'lt'), 'row-level security');
:as_ownerA
-- 4 sections x 10 questions; section 4 has no recording yet
select jsonb_agg(jsonb_build_object('id', 's' || s, 'title', 'Part ' || s,
         'audio_path', case when s < 4 then format('tests/%s/00000000-0000-4000-8000-00000000000%s.mp3', :'lt', s) end,
         'groups', '[]'::jsonb,
         'questions', (select jsonb_agg(jsonb_build_object('id', 'q' || ((s - 1) * 10 + i), 'type', 'tfng', 'prompt', 'Statement ' || i) order by i) from generate_series(1, 10) i))
       order by s) as lt_sections,
       (select jsonb_object_agg('q' || n, jsonb_build_object('answer', 'true')) from generate_series(1, 40) n) as lt_answers
from generate_series(1, 4) s \gset
select save_library_test(:'lt', 'listening', 'Listening Test 1', 'B2', jsonb_strip_nulls(:'lt_sections'::jsonb), :'lt_answers', '{"s1":"Anna: Hello."}');
select tests.assert((select question_count from library_tests where id = :'lt') = 40, '40 questions counted');
select tests.expect_fail(format($$select set_library_test_status(%L, 'published')$$, :'lt'), 'four sections, each with its recording');
select tests.expect_fail(format($$select save_library_test(%L, 'listening', 'X test', null, '[{"id":"s1","audio_path":"tests/%s/00000000-0000-4000-8000-000000000008.mp3","questions":[{"id":"q1","type":"tfng","prompt":"p"}]}]', '{"q1":{"answer":"true"}}')$$, :'lt', :'lt'), 'recording was not found');
select tests.expect_fail(format($$select save_library_test(%L, 'listening', 'X test', null, '[{"id":"s1","questions":[{"id":"q1","type":"tfng","prompt":"p"}]},{"id":"s2","questions":[{"id":"q1","type":"tfng","prompt":"p"}]}]', '{"q1":{"answer":"true"}}')$$, :'lt'), 'must be unique');
insert into storage.objects (bucket_id, name) values ('library-audio', format('tests/%s/00000000-0000-4000-8000-000000000004.mp3', :'lt'));
select save_library_test(:'lt', 'listening', 'Listening Test 1', 'B2',
  jsonb_set(:'lt_sections'::jsonb, '{3,audio_path}', to_jsonb(format('tests/%s/00000000-0000-4000-8000-000000000004.mp3', :'lt'))), :'lt_answers', '{"s1":"Anna: Hello."}');
-- staff can't see drafts
:as_mentor
select tests.expect_count('select * from library_tests', 0);
:as_ownerA
select set_library_test_status(:'lt', 'published');
select tests.expect_fail(format($$select save_library_test(%L, 'listening', 'Listening Test 1', 'B2', %L, %L)$$, :'lt', :'lt_sections', :'lt_answers'), 'Unpublish');
select tests.expect_fail(format($$select delete_library_test(%L)$$, :'lt'), 'Hide the test');
-- published: staff and mentors of any centre see it and can listen; nobody but admins reads the key
:as_mentor
select tests.expect_count('select * from library_tests', 1);
select tests.expect_count('select * from library_test_keys', 0);
select tests.expect_count(format($$select * from storage.objects where bucket_id = 'library-audio' and name like 'tests/%s/%%'$$, :'lt'), 4);
select tests.expect_fail($$select new_library_test('reading', 'Mentor test')$$, 'forbidden');
:as_ownerB
select tests.expect_count('select * from library_tests', 1);
select tests.expect_count('select * from library_test_keys', 0);
:as_student
select tests.expect_count('select * from library_tests', 0);
select tests.expect_count(format($$select * from storage.objects where bucket_id = 'library-audio' and name like 'tests/%s/%%'$$, :'lt'), 0);
:as_ownerA
select tests.expect_count('select * from library_test_keys', 1);
-- reading needs three real passages
select new_library_test('reading', 'Reading Test 1') as rt \gset
select tests.expect_fail(format($$select save_library_test(%L, 'reading', 'Reading Test 1', null, '[{"id":"s1","audio_path":"x","questions":[{"id":"q1","type":"tfng","prompt":"p"}]}]', '{"q1":{"answer":"true"}}')$$, :'rt'), 'no audio');
select save_library_test(:'rt', 'reading', 'Reading Test 1', null, '[{"id":"s1","passage":"Short.","questions":[{"id":"q1","type":"tfng","prompt":"p"}]}]', '{"q1":{"answer":"true"}}');
select tests.expect_fail(format($$select set_library_test_status(%L, 'published')$$, :'rt'), '40 questions');
select delete_library_test(:'rt');
select tests.expect_count(format('select * from library_tests where id = %L', :'rt'), 0);

\echo '20. online mocks'
:as_superuser
select tests.assert(app.norm_answer('1.5 metres') = '1.5 metres', 'decimals keep their point');
select tests.assert(app.norm_answer('£12.50') = '12.50', 'currency sign dropped, decimal kept');
select tests.assert(app.norm_answer('50,000') = '50000', 'thousands separator dropped');
select tests.assert(app.norm_answer('Paris.') = 'paris', 'full stop dropped');
select tests.assert(app.word_count(app.norm_answer('1.5 metres')) = 2, '1.5 is one word');
select tests.assert(app.academic_band('listening', 30, 40) = 7.0 and app.academic_band('reading', 30, 40) = 7.0, 'band 7 at 30');
select tests.assert(app.academic_band('reading', 26, 40) = 6.0 and app.academic_band('listening', 26, 40) = 6.5, 'reading and listening tables differ');
select tests.assert(app.academic_band('reading', 40, 40) = 9.0 and app.academic_band('reading', 0, 40) = 0, 'ends of the table');
-- a published reading test (3 passages, 13 + 13 + 14 questions)
:as_ownerA
select new_library_test('reading', 'Reading Test 2', 'B2') as rt2 \gset
select save_library_test(:'rt2', 'reading', 'Reading Test 2', 'B2',
  (select jsonb_agg(jsonb_build_object('id', 's' || p, 'title', 'Passage ' || p, 'passage', repeat('Text of the passage. ', 40), 'groups', '[]'::jsonb,
     'questions', (select jsonb_agg(jsonb_build_object('id', 'q' || n, 'type', 'tfng', 'prompt', 'S' || n) order by n)
                   from generate_series(case p when 1 then 1 when 2 then 14 else 27 end, case p when 1 then 13 when 2 then 26 else 40 end) n)) order by p)
   from generate_series(1, 3) p),
  (select jsonb_object_agg('q' || n, jsonb_build_object('answer', 'true')) from generate_series(1, 40) n));
select set_library_test_status(:'rt2', 'published');

:as_acad
select create_mock_session(:'center_a', 'Online mock', :'group1', now(), :'m_mentor') as ms4 \gset
:as_student
select tests.assert(jsonb_array_length(my_online_mocks()) = 0, 'no online mock before tests are chosen');
select tests.expect_fail(format($$select start_mock_module(%L, 'reading')$$, :'ms4'), 'not chosen');
:as_mentor2
select tests.expect_fail(format($$select set_mock_tests(%L, %L, %L)$$, :'ms4', :'rt2', :'lt'), 'forbidden');
:as_mentor
select tests.expect_fail(format($$select set_mock_tests(%L, %L, null)$$, :'ms4', :'lt'), 'published reading test');
select set_mock_tests(:'ms4', :'rt2', :'lt');
:as_student
select tests.assert(jsonb_array_length(my_online_mocks()->0->'modules') = 2, 'student sees the two online modules');
select tests.expect_count(format($$select * from storage.objects where bucket_id = 'library-audio' and name like 'tests/%s/%%'$$, :'lt'), 0);
select start_mock_module(:'ms4', 'reading') as r_start \gset
select (:'r_start'::jsonb->>'attempt_id') as att_r \gset
select tests.assert((:'r_start'::jsonb->'test')::text not like '%"answer"%' and (:'r_start'::jsonb->'test')::text not like '%accepted%', 'no key sent to the student');
select tests.assert(jsonb_array_length(:'r_start'::jsonb->'test'->'sections') = 3, 'three passages sent');
select tests.assert(((:'r_start'::jsonb->>'deadline_at')::timestamptz - (:'r_start'::jsonb->>'started_at')::timestamptz) = interval '60 minutes', 'reading has 60 minutes');
select tests.assert((start_mock_module(:'ms4', 'reading')->>'attempt_id') = :'att_r', 'starting again resumes');
select tests.expect_count('select * from mock_attempts', 0);
select tests.expect_count('select * from library_tests', 0);
select save_mock_answers(:'att_r', '{"q1":"false"}');
select submit_mock_module(:'att_r', (select jsonb_object_agg('q' || n, 'true') from generate_series(1, 40) n));
select tests.expect_fail(format($$select start_mock_module(%L, 'reading')$$, :'ms4'), 'already finished');
select tests.expect_fail(format($$select save_mock_answers(%L, '{}')$$, :'att_r'), 'already submitted');
select tests.expect_count(format('select * from mock_results where mock_session_id = %L', :'ms4'), 0);
-- listening: audio opens with the attempt; answers after the deadline are ignored
select start_mock_module(:'ms4', 'listening')->>'attempt_id' as att_l \gset
select tests.expect_count(format($$select * from storage.objects where bucket_id = 'library-audio' and name like 'tests/%s/%%'$$, :'lt'), 4);
select save_mock_answers(:'att_l', (select jsonb_object_agg('q' || n, 'true') from generate_series(1, 30) n));
select report_mock_focus(:'att_l');
:as_student2
select tests.expect_fail(format($$select save_mock_answers(%L, '{}')$$, :'att_l'), 'forbidden');
select report_mock_focus(:'att_l');
:as_superuser
update mock_attempts set deadline_at = now() - interval '2 minutes' where id = :'att_l';
:as_student
select tests.expect_count(format($$select * from storage.objects where bucket_id = 'library-audio' and name like 'tests/%s/%%'$$, :'lt'), 0);
select tests.expect_fail(format($$select save_mock_answers(%L, '{}')$$, :'att_l'), 'Time is up');
select submit_mock_module(:'att_l', (select jsonb_object_agg('q' || n, 'true') from generate_series(1, 40) n));
:as_mentor
select tests.assert((select raw_score from mock_attempts where id = :'att_r') = 40 and (select band from mock_attempts where id = :'att_r') = 9.0, 'reading 40/40 is band 9');
select tests.assert((select raw_score from mock_attempts where id = :'att_l') = 30 and (select band from mock_attempts where id = :'att_l') = 7.0, 'late answers ignored: 30/40 is band 7');
select tests.assert((select focus_lost from mock_attempts where id = :'att_l') = 1, 'focus loss counted once (only by the owner)');
select tests.assert((select reading_band = 9 and listening_band = 7 and reading_raw = 40 from mock_results where mock_session_id = :'ms4' and student_id = :'st1'), 'bands written to the result');
select tests.expect_fail(format($$select set_mock_tests(%L, null, %L)$$, :'ms4', :'lt'), 'already started');
-- the mentor adds writing and speaking, marks the absent student, then releases
select save_mock_results(:'ms4', jsonb_build_array(
  jsonb_build_object('student_id', :'st1', 'reading', 9, 'listening', 7, 'writing', 6, 'speaking', 6.5),
  jsonb_build_object('student_id', :'st2', 'absent', true)));
select tests.assert((select status from mock_results where mock_session_id = :'ms4' and student_id = :'st1') = 'completed', 'complete after W/S');
:as_ownerB
select tests.expect_count(format('select * from mock_attempts where mock_session_id = %L', :'ms4'), 0);
select tests.expect_fail(format($$select release_mock_results(%L)$$, :'ms4'), 'forbidden');
:as_student
select tests.expect_count(format('select * from mock_results where mock_session_id = %L', :'ms4'), 0);
:as_mentor
select tests.assert(release_mock_results(:'ms4') = 2, 'released');
:as_student
select tests.assert((select overall_band from mock_result_scores where mock_session_id = :'ms4') = 7.0, 'student sees the full result after release');
:as_parent
select tests.expect_count(format('select * from mock_results where mock_session_id = %L', :'ms4'), 1);

\echo '21. mock lockdown'
:as_acad
select create_mock_session(:'center_a', 'Strict mock', :'group1', now(), :'m_mentor') as ms5 \gset
:as_mentor
select set_mock_tests(:'ms5', :'rt2', :'lt');
select count(*) as n_before from notifications \gset
:as_student
select start_mock_module(:'ms5', 'listening')->>'attempt_id' as att_x \gset
select save_mock_answers(:'att_x', (select jsonb_object_agg('q' || n, 'true') from generate_series(1, 40) n));
:as_student2
select tests.expect_fail(format($$select leave_mock_module(%L, 'left_page')$$, :'att_x'), 'forbidden');
:as_student
select leave_mock_module(:'att_x', 'left_fullscreen');
select tests.expect_fail(format($$select start_mock_module(%L, 'listening')$$, :'ms5'), 'removed from this part');
select tests.assert((select m->>'state' from jsonb_array_elements(my_online_mocks()) x, jsonb_array_elements(x->'modules') m
                     where x->>'session_id' = :'ms5' and m->>'skill' = 'listening') = 'removed', 'portal shows removed');
select tests.expect_fail(format($$select save_mock_answers(%L, '{}')$$, :'att_x'), 'already submitted');
select leave_mock_module(:'att_x', 'left_page');
:as_mentor
select tests.assert((select raw_score = 0 and band = 0 and disqualify_reason = 'left_fullscreen' from mock_attempts where id = :'att_x'), 'left: scored 0 despite saved answers');
select tests.assert((select listening_band = 0 from mock_results where mock_session_id = :'ms5' and student_id = :'st1'), 'listening band 0 on the result');
select tests.assert((select count(*) from notifications) = :n_before + 1, 'examiner (group mentor) notified once');
select tests.assert((select body from notifications order by created_at desc limit 1) like 'Aziz Karimov (B2 Morning) left the Listening test%left full screen%', 'notification names the student and group');
select tests.assert((select data->>'student_name' from notifications order by created_at desc limit 1) = 'Aziz Karimov', 'student name kept in data');
:as_ownerA
select tests.assert((select count(*) from notifications where data->>'kind' = 'mock_left') = 1, 'owner notified');
:as_acad
select tests.assert((select count(*) from notifications where data->>'kind' = 'mock_left') = 1, 'academic manager notified');
:as_mentor2
select tests.assert((select count(*) from notifications where data->>'kind' = 'mock_left') = 0, 'other mentors are not notified');
:as_student
select tests.expect_count($$select * from notifications where data->>'kind' = 'mock_left'$$, 0);
-- reading is a separate part and can still be taken
select tests.assert((start_mock_module(:'ms5', 'reading')->>'attempt_id') is not null, 'other part still open');

\echo '22. notifications for families and students'
-- earlier sections already produced some: payments, homework, mocks
:as_admin
select generate_invoices(:'center_a', (date_trunc('month', now()) + interval '2 months')::date);
:as_parent
select tests.assert((select count(*) from notifications where data->>'kind' = 'payment') >= 2, 'parent told about payments');
select tests.assert((select count(*) from notifications where data->>'kind' = 'invoice') >= 1, 'parent told about invoices');
select tests.assert((select count(*) from notifications where data->>'kind' = 'mock_released') >= 1, 'parent told about released mock results');
select count(*) as par_att from notifications where data->>'kind' = 'attendance' \gset
:as_student
select tests.assert((select count(*) from notifications where data->>'kind' = 'homework_new') >= 1, 'student told about new homework');
select tests.assert((select count(*) from notifications where data->>'kind' = 'mock_scheduled') >= 1, 'student told about scheduled mocks');
select tests.assert((select count(*) from notifications where data->>'kind' = 'payment') >= 2, 'student told about payments');
select count(*) as st_att from notifications where data->>'kind' = 'attendance' \gset
-- absent: parents only
:as_mentor
select id as lesson_abs from lessons where group_id = :'group1' and starts_at < now() - interval '1 day' and id <> :'lesson_past' order by starts_at desc limit 1 \gset
select mark_attendance(:'lesson_abs', format('[{"student_id":"%s","status":"absent"}]', :'st1')::jsonb);
select tests.assert((select count(*) from notifications where data->>'kind' in ('attendance','payment','invoice','homework_new')) = 0, 'mentor gets no family notices');
:as_parent
select tests.assert((select count(*) from notifications where data->>'kind' = 'attendance') = :par_att + 1, 'parent told about the absence');
select tests.assert((select body from notifications where data->>'kind' = 'attendance' order by created_at desc limit 1) like 'Aziz Karimov was marked absent%', 'absence notice names the student');
:as_student
select tests.assert((select count(*) from notifications where data->>'kind' = 'attendance') = :st_att, 'student not told about own absence');
-- a cancelled lesson reaches students and parents of the group
:as_admin
select id as lesson_cxl from lessons where group_id = :'group1' and starts_at > now() + interval '1 day' and status = 'scheduled' order by starts_at limit 1 \gset
update lessons set status = 'cancelled' where id = :'lesson_cxl';
:as_student
select tests.assert((select count(*) from notifications where data->>'kind' = 'lesson_cancelled') = 1, 'student told the lesson is cancelled');
:as_student2
select tests.assert((select count(*) from notifications where data->>'kind' = 'lesson_cancelled') = 1, 'classmate told too');
:as_parent
select tests.assert((select count(*) from notifications where data->>'kind' = 'lesson_cancelled') = 1, 'parent told too');
:as_ownerB
select tests.expect_count($$select * from notifications where data->>'kind' = 'lesson_cancelled'$$, 0);
-- marking read
:as_student
select mark_my_notifications_read(:'center_a');
select tests.expect_count('select * from notifications where read_at is null', 0);
:as_parent
select tests.assert((select count(*) from notifications where read_at is null) > 0, 'others stay unread');

\echo '23. invite codes expire'
:as_ownerA
select membership_id as m_inv, invite_code as code_inv from invite_member(:'center_a', 'mentor', 'Late Mentor') \gset
select tests.assert((select invite_expires_at between now() + interval '13 days' and now() + interval '15 days' from memberships where id = :'m_inv'), 'a new code is good for 14 days');
:as_anon
select tests.expect_count(format($$select * from invite_preview(%L)$$, :'code_inv'), 1);
-- an expired code is neither shown nor redeemable
:as_superuser
update memberships set invite_expires_at = now() - interval '1 minute' where id = :'m_inv';
:as_anon
select tests.expect_count(format($$select * from invite_preview(%L)$$, :'code_inv'), 0);
:as_ownerB
select tests.expect_fail(format($$select accept_invite(%L)$$, :'code_inv'), 'expired');
-- only those who may issue the invite can reissue it
:as_mentor
select tests.expect_fail(format($$select reissue_invite(%L)$$, :'m_inv'), 'forbidden');
:as_ownerB
select tests.expect_fail(format($$select reissue_invite(%L)$$, :'m_inv'), 'forbidden');
:as_admin
select tests.expect_fail(format($$select reissue_invite(%L)$$, :'m_admin'), '');
select reissue_invite(:'m_inv') as code_new \gset
select tests.assert(:'code_new' <> :'code_inv', 'reissue gives a new code');
:as_anon
select tests.expect_count(format($$select * from invite_preview(%L)$$, :'code_new'), 1);
select tests.expect_count(format($$select * from invite_preview(%L)$$, :'code_inv'), 0);
:as_ownerB
select tests.expect_fail(format($$select accept_invite(%L)$$, :'code_inv'), 'invalid');
-- the fresh code works once, then it is gone
:as_superuser
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000c1', 'late@a.uz', '{}');
reset role; select tests.login('c1'); set role authenticated;
select accept_invite(:'code_new');
select tests.assert((select invite_code is null and invite_expires_at is null and status = 'active' from memberships where id = :'m_inv'), 'accepted invite clears its code');
:as_ownerA
select tests.expect_fail(format($$select reissue_invite(%L)$$, :'m_inv'), 'already accepted');

\echo '24. answer keys only for the mentor of the work'
-- mentor (group1) set lib-1; mentor2 teaches group2 only
:as_mentor
select tests.assert((select count(*) from assignment_keys k join assignments a on a.id = k.assignment_id where a.library_item_id = 'lib-1') = 1, 'group mentor reads the key');
:as_mentor2
select tests.expect_count(format($$select * from assignment_keys k join assignments a on a.id = k.assignment_id where a.library_item_id = %L$$, 'lib-1'), 0);
select a.id as key_asg from assignments a where a.library_item_id = 'lib-1' \gset
update assignment_keys set answers = '{}' where assignment_id = :'key_asg';
select tests.expect_fail(format($$insert into assignment_keys (assignment_id, center_id, answers) values (%L, %L, '{}')$$, :'key_asg', :'center_a'), 'row-level security');
:as_mentor
update assignment_keys set answers = '{}' where assignment_id = :'key_asg';
:as_acad
select tests.assert((select answers->'q1'->>'answer' from assignment_keys where assignment_id = :'key_asg') = '1', 'mentors cannot change a key directly; academic manager still reads it');

\echo '25. LinguABC podcasts'
\set pq '[{"id":"q1","type":"mc","prompt":"Who?","options":["a","b","c"]},{"id":"q2","type":"tfng","prompt":"S"},{"id":"q3","type":"gap","prompt":"It is ____.","max_words":1}]'
\set pa '{"q1":{"answer":0},"q2":{"answer":"true"},"q3":{"accepted":["red"]}}'
\set ptr '[{"speaker":"Host","text":"Hello."}]'
:as_ownerB
select tests.expect_fail($$select save_library_podcast(null, 'Sneaky', '', 'A1', 'A1', '{}', '[]', '[]', '{}', '[]', null, null, 0)$$, 'forbidden');
:as_ownerA
select save_library_podcast(null, 'At the market', 'Buying fruit', 'A1', 'A2', array['Shopping',' food '], :'ptr', :'pq', :'pa', '[]', null, null, 0) as pod \gset
select tests.assert((select status = 'draft' and kind = 'podcast' and topics = array['food','shopping'] from library_items where id = :'pod'), 'draft podcast saved');
select tests.expect_fail(format($$select set_library_podcast_status(%L, 'published')$$, :'pod'), 'Record the podcast');
select tests.expect_fail(format($$select save_library_podcast(%L, 'At the market', '', 'A1', 'A2', '{}', '[]', '[{"id":"q1","type":"open","prompt":"x"}]', '{}', '[]', null, null, 0)$$, :'pod'), 'only');
-- the recording must exist and the link must match it
select tests.expect_fail(format($$select save_library_podcast(%L, 'At the market', '', 'A1', 'A2', '{}', %L, %L, %L, '[]', 'podcasts/00000000-0000-4000-8000-000000000001.mp3', 'https://x.supabase.co/storage/v1/object/public/library-podcasts/podcasts/00000000-0000-4000-8000-000000000001.mp3', 120)$$, :'pod', :'ptr', :'pq', :'pa'), 'not found');
insert into storage.objects (bucket_id, name) values ('library-podcasts', 'podcasts/00000000-0000-4000-8000-000000000001.mp3');
select tests.expect_fail(format($$select save_library_podcast(%L, 'At the market', '', 'A1', 'A2', '{}', %L, %L, %L, '[]', 'podcasts/00000000-0000-4000-8000-000000000001.mp3', 'https://evil.example/x.mp3', 120)$$, :'pod', :'ptr', :'pq', :'pa'), 'does not match');
select save_library_podcast(:'pod', 'At the market', '', 'A1', 'A2', '{}', :'ptr', :'pq', :'pa', '[]', 'podcasts/00000000-0000-4000-8000-000000000001.mp3', 'https://x.supabase.co/storage/v1/object/public/library-podcasts/podcasts/00000000-0000-4000-8000-000000000001.mp3', 125);
select tests.assert((select minutes = 3 and duration_seconds = 125 from library_items where id = :'pod'), 'length stored');
:as_ownerB
select tests.expect_fail($$insert into storage.objects (bucket_id, name) values ('library-podcasts', 'podcasts/00000000-0000-4000-8000-000000000002.mp3')$$, 'row-level security');
-- drafts are hidden from centres, keys too
:as_mentor
select tests.expect_count(format($$select * from library_items where id = %L$$, :'pod'), 0);
select tests.expect_count(format($$select * from library_answer_keys where item_id = %L$$, :'pod'), 0);
select tests.expect_fail(format($$select assign_library_item(%L, %L, %L, now() + interval '2 days')$$, :'center_a', :'pod', :'group1'), 'not found');
:as_ownerA
select set_library_podcast_status(:'pod', 'published');
select tests.expect_fail(format($$select save_library_podcast(%L, 'Changed', '', 'A1', 'A2', '{}', '[]', '[]', '{}', '[]', null, null, 0)$$, :'pod'), 'Unpublish');
:as_mentor
select tests.expect_count(format($$select * from library_answer_keys where item_id = %L$$, :'pod'), 1);
select assign_library_item(:'center_a', :'pod', :'group1', now() + interval '2 days') as hw_pod \gset
:as_student
select tests.expect_count(format($$select * from library_items where id = %L and audio_url is not null$$, :'pod'), 1);
select tests.expect_count(format($$select * from library_answer_keys where item_id = %L$$, :'pod'), 0);
:as_ownerA
select tests.expect_fail(format($$select delete_library_podcast(%L)$$, :'pod'), 'homework');
-- a recording in use cannot be removed
delete from storage.objects where bucket_id = 'library-podcasts' and name = 'podcasts/00000000-0000-4000-8000-000000000001.mp3';
:as_superuser
select tests.assert(exists (select 1 from storage.objects where name = 'podcasts/00000000-0000-4000-8000-000000000001.mp3'), 'used recording kept');
:as_ownerA
select save_library_podcast(null, 'Spare', '', 'C1', 'C2', '{}', '[]', '[]', '{}', '[]', null, null, 0) as pod2 \gset
select delete_library_podcast(:'pod2');
select tests.expect_count(format($$select * from library_items where id = %L$$, :'pod2'), 0);

\echo '26. payment reminders'
:as_superuser
select b.id as inv_r from invoice_balances b join invoices i on i.id = b.id
 where b.student_id = :'st1' and i.status = 'open' and b.balance > 0 order by b.period desc limit 1 \gset
update invoices set last_reminded_at = now() where id <> :'inv_r';
update invoices set due_date = app.local_today() + 2, last_reminded_at = null where id = :'inv_r';
select app.send_payment_reminders();
select app.send_payment_reminders();
:as_parent
select tests.assert((select count(*) from notifications where data->>'kind' = 'payment_due' and data->>'invoice_id' = :'inv_r') = 1, 'parent told once that a fee is due soon');
:as_student
select tests.assert((select count(*) from notifications where data->>'kind' = 'payment_due' and data->>'invoice_id' = :'inv_r') = 1, 'student told too');
:as_mentor
select tests.expect_count($$select * from notifications where data->>'kind' in ('payment_due','payment_overdue')$$, 0);
:as_superuser
-- the due-soon reminder went out before the due date; now it is a day late
update invoices set due_date = app.local_today() - 1, last_reminded_at = now() - interval '3 days' where id = :'inv_r';
select app.send_payment_reminders();
select app.send_payment_reminders();
:as_parent
select tests.assert((select count(*) from notifications where data->>'kind' = 'payment_overdue' and data->>'invoice_id' = :'inv_r') = 1, 'overdue reminder once');
:as_superuser
update invoices set last_reminded_at = now() - interval '8 days' where id = :'inv_r';
select app.send_payment_reminders();
:as_parent
select tests.assert((select count(*) from notifications where data->>'kind' = 'payment_overdue' and data->>'invoice_id' = :'inv_r') = 2, 'overdue again after a week');
-- by hand: owner or admin only, once a day
:as_admin
select tests.expect_fail(format($$select remind_payment(%L)$$, :'inv_r'), 'already reminded today');
:as_superuser
update invoices set last_reminded_at = now() - interval '2 days' where id = :'inv_r';
:as_mentor
select tests.expect_fail(format($$select remind_payment(%L)$$, :'inv_r'), 'forbidden');
:as_ownerB
select tests.expect_fail(format($$select remind_payment(%L)$$, :'inv_r'), 'forbidden');
:as_admin
select tests.assert(remind_payment(:'inv_r') >= 1, 'admin reminded the family');
:as_parent
select tests.assert((select count(*) from notifications where data->>'kind' = 'payment_overdue' and data->>'invoice_id' = :'inv_r') = 3, 'manual reminder delivered');
-- a paid fee is never chased
:as_admin
select * from record_payment(:'inv_r', (select balance from invoice_balances where id = :'inv_r')::bigint, 'cash');
:as_superuser
update invoices set last_reminded_at = now() - interval '30 days' where id = :'inv_r';
select app.send_payment_reminders();
:as_parent
select tests.assert((select count(*) from notifications where data->>'kind' = 'payment_overdue' and data->>'invoice_id' = :'inv_r') = 3, 'no reminder once paid');

\echo '27. centre report'
:as_mentor
select tests.expect_fail(format($$select center_report(%L, current_date - 30, current_date)$$, :'center_a'), 'forbidden');
:as_ownerB
select tests.expect_fail(format($$select center_report(%L, current_date - 30, current_date)$$, :'center_a'), 'forbidden');
:as_ownerA
select tests.expect_fail(format($$select center_report(%L, current_date, current_date - 1)$$, :'center_a'), 'period');
select center_report(:'center_a', (current_date - 365), current_date + 1) as rep \gset
:as_superuser
select tests.assert((:'rep'::jsonb->'money'->>'collected')::bigint =
  (select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0) from payments
   where center_id = :'center_a' and paid_at >= ((current_date - 365)::timestamp at time zone 'Asia/Tashkent')), 'collections match the ledger');
select tests.assert((:'rep'::jsonb->'students'->>'active')::int = (select count(*) from students where center_id = :'center_a' and status = 'active'), 'active students counted');
select tests.assert(jsonb_array_length(:'rep'::jsonb->'months') = 6, 'six months of collections');
select tests.assert((:'rep'::jsonb->'attendance'->>'present')::int > 0, 'attendance counted');
:as_admin
select tests.assert(center_report(:'center_a', current_date - 30, current_date) ? 'capacity', 'admin can read the report');

\echo '28. self-practice'
:as_superuser
insert into library_items (id, kind, title, skill, level_min, level_max, body_html, questions)
  values ('lib-p', 'article', 'Practice me', 'reading', 'B1', 'B2', 'Text',
          '[{"id":"q1","type":"mc","prompt":"Why?","options":["a","b"]},{"id":"q2","type":"gap","prompt":"It is ____.","max_words":1}]');
insert into library_answer_keys (item_id, answers) values ('lib-p', '{"q1":{"answer":1},"q2":{"accepted":["red"]}}');
:as_mentor
select tests.expect_fail($$select practice_library_item('lib-p', '{}')$$, 'students only');
:as_student
select tests.expect_fail($$select practice_library_item('lib-1', '{}')$$, 'set this as homework');
select tests.assert('lib-1' in (select my_practice_blocked()), 'homework items are blocked');
select practice_library_item('lib-p', '{"q1":1,"q2":"Red"}') as pr \gset
select tests.assert((:'pr'::jsonb->>'score')::numeric = 100, 'all correct scores 100');
select tests.assert(not (:'pr'::jsonb ? 'key') and (:'pr'::jsonb->'correct'->>'q2')::boolean, 'marks without the key');
select tests.assert((practice_library_item('lib-p', '{"q1":0}')->>'score')::numeric = 0, 'wrong scores 0');
select practice_library_item('lib-p', '{}');
select tests.expect_fail($$select practice_library_item('lib-p', '{}')$$, '3 times today');
select tests.expect_count('select * from practice_attempts', 3);
:as_parent
select tests.expect_count('select * from practice_attempts', 3);
:as_mentor
select tests.expect_count('select * from practice_attempts', 3);
:as_student2
select tests.expect_count('select * from practice_attempts', 0);
:as_ownerB
select tests.expect_count('select * from practice_attempts', 0);
select tests.expect_fail($$insert into practice_attempts (center_id, student_id, item_id, skill) values (gen_random_uuid(), gen_random_uuid(), 'lib-p', 'reading')$$, 'row-level security|permission denied');

\echo '29. audio segment cache'
select repeat('a', 64) as seg_h, repeat('b', 64) as seg_h2, repeat('c', 64) as seg_hp \gset
-- a miss is claimed by one caller; everyone else in the centre waits
:as_mentor
select tests.assert(claim_audio_segment(:'center_a', :'seg_h', 'fish', 's2.1-pro', 'v1', 120) = jsonb_build_object('state', 'generate', 'path', :'center_a' || '/' || :'seg_h' || '.mp3'), 'first caller generates');
select tests.assert(claim_audio_segment(:'center_a', :'seg_h', 'fish', 's2.1-pro', 'v1', 120)->>'state' = 'wait', 'same user, second request waits (no double billing)');
:as_acad
select tests.assert(claim_audio_segment(:'center_a', :'seg_h', 'fish', 's2.1-pro', 'v1', 120)->>'state' = 'wait', 'colleague waits too');
-- only the claimer uploads the file, and only at its own path
select tests.expect_fail(format($$insert into storage.objects (bucket_id, name) values ('audio-segments', %L)$$, :'center_a' || '/' || :'seg_h' || '.mp3'), 'row-level security');
select tests.expect_fail($$select finish_audio_segment('$$ || :'center_a' || $$', '$$ || :'seg_h' || $$', 100)$$, 'segment file not found');
:as_mentor
select tests.expect_fail($$select finish_audio_segment('$$ || :'center_a' || $$', '$$ || :'seg_h' || $$', 100)$$, 'segment file not found');
select tests.expect_fail(format($$insert into storage.objects (bucket_id, name) values ('audio-segments', %L)$$, :'center_a' || '/' || :'seg_h2' || '.mp3'), 'row-level security');
select tests.expect_fail(format($$insert into storage.objects (bucket_id, name) values ('audio-segments', %L)$$, :'center_a' || '/x.mp3'), 'row-level security');
insert into storage.objects (bucket_id, name) values ('audio-segments', :'center_a' || '/' || :'seg_h' || '.mp3');
:as_acad
select tests.expect_fail($$select finish_audio_segment('$$ || :'center_a' || $$', '$$ || :'seg_h' || $$', 100)$$, 'not claimed');
:as_mentor
select tests.assert(finish_audio_segment(:'center_a', :'seg_h', 4321) = :'center_a' || '/' || :'seg_h' || '.mp3', 'finished');
-- a hit: no generation, counted
:as_acad
select tests.assert(claim_audio_segment(:'center_a', :'seg_h', 'fish', 's2.1-pro', 'v1', 120) = jsonb_build_object('state', 'ready', 'path', :'center_a' || '/' || :'seg_h' || '.mp3'), 'cache hit');
select tests.expect_count(format('select * from storage.objects where name = %L', :'center_a' || '/' || :'seg_h' || '.mp3'), 1);
:as_superuser
select tests.assert((select hits from audio_segments where center_id = :'center_a' and hash = :'seg_h') = 1, 'hit counted');
-- cached files cannot be replaced or removed by callers
:as_mentor
delete from storage.objects where name = :'center_a' || '/' || :'seg_h' || '.mp3';
update storage.objects set name = name || 'x' where bucket_id = 'audio-segments';
:as_superuser
select tests.assert(exists (select 1 from storage.objects where name = :'center_a' || '/' || :'seg_h' || '.mp3'), 'cached file is immutable');

-- tenant isolation: another centre sees nothing, and the same hash there is a separate segment
:as_ownerB
select tests.expect_fail($$select claim_audio_segment('$$ || :'center_a' || $$', '$$ || :'seg_h' || $$', 'fish', 'm', 'v1', 1)$$, 'forbidden');
select tests.expect_fail($$select finish_audio_segment('$$ || :'center_a' || $$', '$$ || :'seg_h' || $$', 1)$$, 'forbidden');
select tests.expect_count('select * from audio_segments', 0);
select tests.expect_count($$select * from storage.objects where bucket_id = 'audio-segments'$$, 0);
select tests.assert(claim_audio_segment(:'center_b', :'seg_h', 'fish', 's2.1-pro', 'v1', 120) = jsonb_build_object('state', 'generate', 'path', :'center_b' || '/' || :'seg_h' || '.mp3'), 'same hash in another centre is a miss');
select tests.expect_count('select * from audio_segments', 1);
-- a failed generation is released, so the next request can try at once
select release_audio_segment(:'center_b', :'seg_h');
select tests.expect_count('select * from audio_segments', 0);
select tests.assert(claim_audio_segment(:'center_b', :'seg_h', 'fish', 's2.1-pro', 'v1', 120)->>'state' = 'generate', 'claim again after release');
:as_mentor
select tests.expect_count('select * from audio_segments', 1);
select release_audio_segment(:'center_a', :'seg_h');
:as_superuser
select tests.assert((select status from audio_segments where center_id = :'center_a' and hash = :'seg_h') = 'ready', 'release never drops a ready segment');
-- students, parents and anonymous users get nothing
:as_student
select tests.expect_fail($$select claim_audio_segment('$$ || :'center_a' || $$', '$$ || :'seg_h2' || $$', 'fish', 'm', 'v1', 1)$$, 'forbidden');
select tests.expect_count('select * from audio_segments', 0);
select tests.expect_count($$select * from storage.objects where bucket_id = 'audio-segments'$$, 0);
:as_parent
select tests.expect_count('select * from audio_segments', 0);
:as_anon
select tests.expect_fail($$select claim_audio_segment(null, repeat('d', 64), 'fish', 'm', 'v', 1)$$, 'permission denied');
-- no direct writes to the table
:as_mentor
select tests.expect_fail(format($$insert into audio_segments (center_id, hash, provider, model, text_bytes) values (%L, repeat('e', 64), 'fish', 'm', 1)$$, :'center_a'), 'permission denied');
select tests.expect_fail($$select claim_audio_segment('$$ || :'center_a' || $$', 'not-a-hash', 'fish', 'm', 'v1', 1)$$, 'bad segment hash');
-- a stale claim (crashed request) can be taken over
select tests.assert(claim_audio_segment(:'center_a', :'seg_h2', 'fish', 's2.1-pro', 'v2', 50)->>'state' = 'generate', 'mentor claims');
:as_acad
select tests.assert(claim_audio_segment(:'center_a', :'seg_h2', 'fish', 's2.1-pro', 'v2', 50)->>'state' = 'wait', 'fresh claim is respected');
:as_superuser
update audio_segments set claimed_at = now() - interval '4 minutes' where hash = :'seg_h2';
:as_acad
select tests.assert(claim_audio_segment(:'center_a', :'seg_h2', 'fish', 's2.1-pro', 'v2', 50)->>'state' = 'generate', 'stale claim taken over');
-- the LinguABC library scope belongs to platform admins
:as_mentor
select tests.expect_fail($$select claim_audio_segment(null, '$$ || :'seg_hp' || $$', 'fish', 'm', 'v1', 1)$$, 'forbidden');
:as_ownerB
select tests.expect_fail($$select claim_audio_segment(null, '$$ || :'seg_hp' || $$', 'fish', 'm', 'v1', 1)$$, 'forbidden');
:as_ownerA
select tests.assert(claim_audio_segment(null, :'seg_hp', 'fish', 's2.1-pro', 'v1', 10) = jsonb_build_object('state', 'generate', 'path', 'platform/' || :'seg_hp' || '.mp3'), 'platform admin claims a library segment');
insert into storage.objects (bucket_id, name) values ('audio-segments', 'platform/' || :'seg_hp' || '.mp3');
select tests.assert(finish_audio_segment(null, :'seg_hp', 10) = 'platform/' || :'seg_hp' || '.mp3', 'library segment finished');
:as_mentor
select tests.expect_count($$select * from storage.objects where name like 'platform/%'$$, 0);
select tests.expect_count('select * from audio_segments where center_id is null', 0);
-- the existing audio buckets are untouched
:as_superuser
select tests.assert((select count(*) from storage.buckets where id in ('listening-audio', 'library-audio', 'library-podcasts', 'audio-segments') and not public) = 3, 'buckets: three private, podcasts public');

\echo '30. audio jobs'
:as_superuser
grant usage on schema tests to service_role;
\set as_service_role 'reset role; select set_config(''request.jwt.claims'', '''', false); set role service_role;'
select repeat('1', 64) as tok1, repeat('2', 64) as tok2, repeat('3', 64) as tok3, repeat('4', 64) as tok4,
       repeat('a', 64) as idem1, repeat('b', 64) as idem2, repeat('c', 64) as idem3, repeat('d', 64) as idem4,
       :'center_a' || '/aaaaaaaa-0000-4000-8000-000000000001.mp3' as jp1,
       :'center_a' || '/aaaaaaaa-0000-4000-8000-000000000002.mp3' as jp2,
       :'center_a' || '/aaaaaaaa-0000-4000-8000-000000000003.mp3' as jp3,
       :'center_b' || '/bbbbbbbb-0000-4000-8000-000000000001.mp3' as jpb \gset
-- who may start a job, and only where that recording belongs
:as_mentor
select (enqueue_audio_job(:'center_a', 'homework', 'chatterbox-turbo', 'listening-audio', :'jp1', :'idem1', :'tok1', 'homework:d1', repeat('a', 64)))->>'id' as job1 \gset
select tests.assert(enqueue_audio_job(:'center_a', 'homework', 'chatterbox-turbo', 'listening-audio', :'jp1', :'idem1', :'tok1', 'homework:d1', repeat('a', 64)) =
  jsonb_build_object('id', :'job1', 'status', 'queued', 'created', false, 'target_path', :'jp1'), 'same request twice -> same job (idempotent)');
select tests.expect_fail(format($$select enqueue_audio_job(%L, 'homework', 'chatterbox', 'listening-audio', %L, %L, %L, 'homework:d1', repeat('a', 64))$$, :'center_a', :'jpb', :'idem2', :'tok2'), 'bad target');
select tests.expect_fail(format($$select enqueue_audio_job(%L, 'homework', 'chatterbox', 'library-audio', %L, %L, %L, 'homework:d1', repeat('a', 64))$$, :'center_a', :'jp2', :'idem2', :'tok2'), 'bad target');
select tests.expect_fail(format($$select enqueue_audio_job(%L, 'homework', 'fish', 'listening-audio', %L, %L, %L, 'homework:d1', repeat('a', 64))$$, :'center_a', :'jp2', :'idem2', :'tok2'), 'unknown voice engine');
select tests.expect_fail(format($$select enqueue_audio_job(%L, 'homework', 'chatterbox', 'listening-audio', %L, %L, %L, 'homework:d1', repeat('a', 64))$$, :'center_b', :'jpb', :'idem2', :'tok2'), 'forbidden');
select tests.expect_fail($$select enqueue_audio_job(null, 'podcast', 'chatterbox', 'library-podcasts', 'podcasts/aaaaaaaa-0000-4000-8000-0000000000aa.mp3', repeat('e', 64), repeat('5', 64), 'podcast:new', repeat('a', 64))$$, 'forbidden');
select tests.expect_count('select * from audio_jobs', 1);
:as_student
select tests.expect_fail(format($$select enqueue_audio_job(%L, 'homework', 'chatterbox', 'listening-audio', %L, %L, %L, 'homework:d1', repeat('a', 64))$$, :'center_a', :'jp2', :'idem2', :'tok2'), 'forbidden');
select tests.expect_count('select * from audio_jobs', 0);
:as_parent
select tests.expect_count('select * from audio_jobs', 0);
:as_ownerB
select tests.expect_count('select * from audio_jobs', 0);
select tests.expect_fail(format($$select review_audio_job(%L, true)$$, :'job1'), 'forbidden');
select tests.expect_fail(format($$select retry_audio_job(%L, %L, %L)$$, :'job1', :'tok3', :'jp2'), 'forbidden');
:as_anon
select tests.expect_fail($$select * from audio_jobs$$, 'permission denied');
-- the token and the worker's channel are closed to users
:as_acad
select tests.expect_count('select * from audio_jobs', 1);
select tests.expect_fail('select * from audio_job_tokens', 'permission denied');
select tests.expect_fail(format($$select audio_job_update(%L, %L, 1, 'completed', 100)$$, :'job1', :'tok1'), 'permission denied');
select tests.expect_fail(format($$update audio_jobs set status = 'completed' where id = %L$$, :'job1'), 'permission denied');

-- library jobs: platform admins only, into the library buckets
:as_ownerA
select (enqueue_audio_job(null, 'test', 'chatterbox', 'library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000b1.mp3', :'lt'), :'idem3', :'tok3', 'test:' || :'lt' || ':s1', repeat('a', 64)))->>'id' as jobt \gset
select tests.expect_fail(format($$select enqueue_audio_job(null, 'test', 'chatterbox', 'library-audio', 'tests/%s/aaaaaaaa-0000-4000-8000-0000000000b2.mp3', %L, %L, 'test:00000000-0000-4000-8000-000000000000:s1', repeat('a', 64))$$, gen_random_uuid(), :'idem4', :'tok4'), 'bad target');
select (enqueue_audio_job(null, 'podcast', 'qwen', 'library-podcasts', 'podcasts/aaaaaaaa-0000-4000-8000-0000000000c1.mp3', :'idem4', :'tok4', 'podcast:new', repeat('a', 64)))->>'id' as jobp \gset
:as_mentor
select tests.expect_count('select * from audio_jobs where center_id is null', 0);

-- the worker's reports (service role, with the job's token)
:as_service_role
select tests.expect_fail(format($$select audio_job_update(%L, %L, 1, 'processing', 10)$$, :'job1', :'tok2'), 'unknown job or token');
select tests.assert((audio_job_update(:'job1', :'tok1', 1, 'processing', 40, 4, 10))->>'applied' = 'true', 'progress accepted');
select audio_job_update(:'job1', :'tok1', 1, 'processing', 20, 2, 10);
select tests.assert((select progress = 40 and segments_done = 4 and status = 'processing' and lease_until > now() from audio_jobs where id = :'job1'), 'progress never goes back');
select tests.expect_fail(format($$select audio_job_update(%L, %L, 1, 'completed', 100, 10, 10, 412.5)$$, :'job1', :'tok1'), 'not in storage');
select tests.expect_fail(format($$select audio_job_update(%L, %L, 1, 'queued', 0)$$, :'job1', :'tok1'), 'bad status');
:as_superuser
insert into storage.objects (bucket_id, name, owner) values ('listening-audio', :'jp1', '00000000-0000-0000-0000-0000000000a4');
:as_service_role
select tests.assert((audio_job_update(:'job1', :'tok1', 1, 'completed', 100, 10, 10, 412.5, '{"status":"pass","wer":0.004}'))->>'applied' = 'true', 'completed');
select tests.assert((audio_job_update(:'job1', :'tok1', 1, 'completed', 100))->>'applied' = 'false', 'a repeated report changes nothing');
select tests.assert((audio_job_update(:'job1', :'tok1', 1, 'failed', 0, null, null, null, null, 'late'))->>'applied' = 'false', 'a finished job stays finished');
:as_superuser
select tests.assert((select status = 'completed' and progress = 100 and seconds = 412.5 and finished_at is not null and error is null from audio_jobs where id = :'job1'), 'job1 completed once');
-- the finished recording is the mentor's file in the existing bucket: students hear it through the existing rules only
:as_student
select tests.expect_count(format('select * from storage.objects where name = %L', :'jp1'), 0);

-- manual review of flagged recordings
:as_mentor
select (enqueue_audio_job(:'center_a', 'homework', 'chatterbox', 'listening-audio', :'jp2', :'idem2', :'tok2', 'homework:d1', repeat('a', 64)))->>'id' as job2 \gset
select tests.expect_fail(format($$select review_audio_job(%L, true)$$, :'job2'), 'waiting for review');
:as_superuser
insert into storage.objects (bucket_id, name, owner) values ('listening-audio', :'jp2', '00000000-0000-0000-0000-0000000000a4');
:as_service_role
select audio_job_update(:'job2', :'tok2', 1, 'needs_review', 100, 8, 8, 60, '{"status":"needs_review","problems":["recording WER 4% > 3%"]}');
:as_ownerB
select tests.expect_fail(format($$select review_audio_job(%L, true)$$, :'job2'), 'forbidden');
:as_acad
select tests.assert(review_audio_job(:'job2', true) = 'completed', 'a colleague approves after listening');
select tests.assert((select reviewed_by = '00000000-0000-0000-0000-0000000000a3' from audio_jobs where id = :'job2'), 'reviewer recorded');

-- retry: only stopped jobs, new token and file, limited attempts; old reports are ignored
:as_mentor
select (enqueue_audio_job(:'center_a', 'homework', 'qwen', 'listening-audio', :'jp3', repeat('f', 64), repeat('6', 64), 'homework:d1', repeat('a', 64)))->>'id' as job3 \gset
select tests.expect_fail(format($$select retry_audio_job(%L, %L, %L)$$, :'job3', repeat('7', 64), :'center_a' || '/aaaaaaaa-0000-4000-8000-000000000004.mp3'), 'not stopped');
:as_service_role
select audio_job_update(:'job3', repeat('6', 64), 1, 'failed', 0, null, null, null, null, 'GPU out of memory');
:as_mentor
select tests.assert(retry_audio_job(:'job3', repeat('7', 64), :'center_a' || '/aaaaaaaa-0000-4000-8000-000000000004.mp3') = 2, 'second attempt');
select tests.expect_fail(format($$select retry_audio_job(%L, %L, %L)$$, :'job3', repeat('8', 64), :'jpb'), 'not stopped');
:as_service_role
select tests.expect_fail(format($$select audio_job_update(%L, %L, 2, 'processing', 5)$$, :'job3', repeat('6', 64)), 'unknown job or token');
select tests.assert((audio_job_update(:'job3', repeat('7', 64), 1, 'processing', 50))->>'applied' = 'false', 'an older attempt is ignored');
select tests.assert((audio_job_update(:'job3', repeat('7', 64), 2, 'processing', 10))->>'applied' = 'true', 'current attempt accepted');
-- a worker that goes quiet: the job is failed after its lease, then retried until attempts run out
:as_superuser
update audio_jobs set lease_until = now() - interval '1 minute' where id = :'job3';
select tests.assert(app.expire_audio_jobs() >= 1, 'stalled job expired');
select tests.assert((select status = 'failed' and error like '%stopped responding%' from audio_jobs where id = :'job3'), 'expired job failed');
:as_mentor
select retry_audio_job(:'job3', repeat('9', 64), :'center_a' || '/aaaaaaaa-0000-4000-8000-000000000005.mp3');
:as_service_role
select audio_job_update(:'job3', repeat('9', 64), 3, 'failed', 0, null, null, null, null, 'again');
:as_mentor
select tests.expect_fail(format($$select retry_audio_job(%L, %L, %L)$$, :'job3', repeat('0', 64), :'center_a' || '/aaaaaaaa-0000-4000-8000-000000000006.mp3'), 'no attempts left');
-- recovery: the job names its draft; a finished recording is attached once, or dismissed
:as_mentor
select tests.expect_fail(format($$select enqueue_audio_job(%L, 'homework', 'chatterbox', 'listening-audio', %L, repeat('9', 64), repeat('9', 64), 'podcast:x', repeat('a', 64))$$, :'center_a', :'center_a' || '/aaaaaaaa-0000-4000-8000-000000000009.mp3'), 'bad draft');
select tests.assert((select draft_key = 'homework:d1' and script_hash = repeat('a', 64) from audio_jobs where id = :'job1'), 'draft link kept');
select tests.assert(attach_audio_job(:'job1') = :'jp1', 'attach returns the existing file');
select attached_at as att1 from audio_jobs where id = :'job1' \gset
select tests.assert(attach_audio_job(:'job1') = :'jp1' and (select attached_at = :'att1'::timestamptz from audio_jobs where id = :'job1'), 'attaching twice changes nothing');
select tests.expect_fail(format($$select attach_audio_job(%L)$$, :'job3'), 'only a completed recording');
select dismiss_audio_job(:'job3');
select tests.assert((select dismissed_at is not null from audio_jobs where id = :'job3'), 'dismissed');
:as_student
select tests.expect_fail(format($$select attach_audio_job(%L)$$, :'job1'), 'forbidden');
:as_ownerB
select tests.expect_fail(format($$select attach_audio_job(%L)$$, :'job1'), 'forbidden');
select tests.expect_fail(format($$select dismiss_audio_job(%L)$$, :'job1'), 'forbidden');
:as_ownerA
select tests.expect_fail(format($$select dismiss_audio_job(%L)$$, :'jobt'), 'still running');
select tests.expect_fail(format($$select enqueue_audio_job(null, 'test', 'chatterbox', 'library-audio', 'tests/%s/aaaaaaaa-0000-4000-8000-0000000000b9.mp3', repeat('9', 64), repeat('9', 64), 'test:' || gen_random_uuid() || ':s1', repeat('a', 64))$$, :'lt'), 'bad draft');

-- answer-bearing QA: a test recording with answers is completed only if every answer was checked and heard (one running at a time here)
select (enqueue_audio_job(null, 'test', 'chatterbox', 'library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d1.mp3', :'lt'), repeat('5', 63) || '1', repeat('5', 63) || '1', 'test:' || :'lt' || ':s1', repeat('a', 64), 3))->>'id' as jq1 \gset
:as_superuser
insert into storage.objects (bucket_id, name, owner) values ('library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d1.mp3', :'lt'), '00000000-0000-0000-0000-0000000000a1');
:as_service_role
select tests.assert((audio_job_update(:'jq1', repeat('5', 63) || '1', 1, 'completed', 100, 5, 5, 60, '{"status":"pass","answers_checked":3,"answers_missing":["q2"]}'))->>'status' = 'needs_review', 'an unheard answer -> needs review');
:as_ownerA
select (enqueue_audio_job(null, 'test', 'chatterbox', 'library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d2.mp3', :'lt'), repeat('5', 63) || '2', repeat('5', 63) || '2', 'test:' || :'lt' || ':s1', repeat('a', 64), 3))->>'id' as jq2 \gset
:as_superuser
insert into storage.objects (bucket_id, name, owner) values ('library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d2.mp3', :'lt'), '00000000-0000-0000-0000-0000000000a1');
:as_service_role
select tests.assert((audio_job_update(:'jq2', repeat('5', 63) || '2', 1, 'completed', 100, 5, 5, 60, '{"status":"pass","answers_checked":2,"answers_missing":[]}'))->>'status' = 'needs_review', 'answers not all checked -> needs review');
:as_ownerA
select (enqueue_audio_job(null, 'test', 'chatterbox', 'library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d4.mp3', :'lt'), repeat('5', 63) || '4', repeat('5', 63) || '4', 'test:' || :'lt' || ':s1', repeat('a', 64), 3))->>'id' as jq4 \gset
:as_superuser
insert into storage.objects (bucket_id, name, owner) values ('library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d4.mp3', :'lt'), '00000000-0000-0000-0000-0000000000a1');
:as_service_role
select tests.assert((audio_job_update(:'jq4', repeat('5', 63) || '4', 1, 'completed', 100, 5, 5, 60, '{"status":"pass"}'))->>'status' = 'needs_review', 'no answer report -> needs review');
:as_ownerA
select tests.assert((select count(*) from audio_jobs where id in (:'jq1', :'jq2', :'jq4') and status = 'needs_review') = 3, 'never completed automatically');
select tests.expect_fail(format($$select attach_audio_job(%L)$$, :'jq1'), 'only a completed recording');
select tests.assert(review_audio_job(:'jq1', true) = 'completed', 'a person approves after listening');
select tests.assert(attach_audio_job(:'jq1') like 'tests/%', 'then it can be used');
select (enqueue_audio_job(null, 'test', 'chatterbox', 'library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d3.mp3', :'lt'), repeat('5', 63) || '3', repeat('5', 63) || '3', 'test:' || :'lt' || ':s1', repeat('a', 64), 3))->>'id' as jq3 \gset
:as_superuser
insert into storage.objects (bucket_id, name, owner) values ('library-audio', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d3.mp3', :'lt'), '00000000-0000-0000-0000-0000000000a1');
:as_service_role
select tests.assert((audio_job_update(:'jq3', repeat('5', 63) || '3', 1, 'completed', 100, 5, 5, 60, '{"status":"pass","answers_checked":3,"answers_missing":[]}'))->>'status' = 'completed', 'all answers heard -> completed');
:as_ownerA
select tests.assert((select status = 'completed' and answers_expected = 3 from audio_jobs where id = :'jq3'), 'answers expected stored as a count only');

-- at most three running jobs per person
:as_ownerA
select enqueue_audio_job(null, 'podcast', 'chatterbox', 'library-podcasts', 'podcasts/aaaaaaaa-0000-4000-8000-0000000000c2.mp3', repeat('0', 63) || '1', repeat('1', 63) || '2', 'podcast:new', repeat('a', 64));
select tests.expect_fail($$select enqueue_audio_job(null, 'podcast', 'chatterbox', 'library-podcasts', 'podcasts/aaaaaaaa-0000-4000-8000-0000000000c3.mp3', repeat('0', 63) || '2', repeat('1', 63) || '3', 'podcast:new', repeat('a', 64))$$, 'already running');
-- a retried job starts a fresh review
select tests.assert(review_audio_job(:'jq2', false) = 'failed', 'rejected after listening');
select retry_audio_job(:'jq2', repeat('5', 63) || '9', format('tests/%s/aaaaaaaa-0000-4000-8000-0000000000d9.mp3', :'lt'));
select tests.assert((select reviewed_by is null and reviewed_at is null and attempts = 2 from audio_jobs where id = :'jq2'), 'review cleared on retry');
-- a retry cannot move the recording to another test's slot
select new_library_test('listening', 'Another test', 'B2') as lt2 \gset
:as_service_role
select audio_job_update(:'jq2', repeat('5', 63) || '9', 2, 'failed', 0, null, null, null, null, 'stopped');
:as_ownerA
select tests.expect_fail(format($$select retry_audio_job(%L, repeat('5', 64), 'tests/%s/aaaaaaaa-0000-4000-8000-0000000000da.mp3')$$, :'jq2', :'lt2'), 'bad target');
:as_superuser
select tests.assert((select count(*) from audio_jobs) = 10, 'ten jobs in all');

\echo 'ALL TESTS PASSED'
