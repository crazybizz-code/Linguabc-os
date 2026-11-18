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
select tests.expect_count('select * from notifications', 0);

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
select tests.assert((select count(*) from activities where ref_id = :'ms2' and student_id = :'st1') = 1, 'result on timeline');
select tests.expect_fail(format($$select save_mock_results(%L, '[{"student_id":"%s","reading":6.3}]')$$, :'ms2', :'st1'), 'check');
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
select claim_ai_request(:'center_a', 'generate') from generate_series(1, 20);
select tests.expect_fail(format($$select claim_ai_request(%L, 'generate')$$, :'center_a'), '20 requests per hour');
:as_ownerB
select tests.expect_fail(format($$select claim_ai_request(%L, 'extract')$$, :'center_a'), 'forbidden');

\echo 'ALL TESTS PASSED'
