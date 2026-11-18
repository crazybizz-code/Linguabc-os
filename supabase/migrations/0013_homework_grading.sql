-- =====================================================================
-- Homework grading.
--
-- Objective questions are marked the moment a student submits: the score
-- is the share of questions answered correctly, using the answer key the
-- student cannot read. A mentor can still review — adjust the score and
-- leave feedback — which moves the submission to "reviewed".
--
-- Once their work is in, a student may see the correct answers and
-- explanations for that one piece of homework, and nothing else.
-- =====================================================================

create or replace function app.grade_answers(p_assignment uuid, p_answers jsonb)
returns numeric language sql stable security definer set search_path = '' as $$
  with q as (
    select x->>'id' as id from public.assignments a, jsonb_array_elements(a.content->'questions') x
    where a.id = p_assignment
  ), k as (select answers from public.assignment_keys where assignment_id = p_assignment)
  select case when (select count(*) from q) = 0 or not exists (select 1 from k) then null
         else round(100.0 * (
                select count(*) from q, k
                where p_answers ? q.id and k.answers ? q.id
                  and p_answers->>q.id = k.answers->q.id->>'answer'
              ) / (select count(*) from q), 2) end;
$$;

create or replace function public.save_submission(p_homework uuid, p_answers jsonb, p_submit boolean default false)
returns public.submission_status language plpgsql security definer set search_path = '' as $$
declare v_h public.homework; v_student uuid; v_s public.submissions; v_title text; v_score numeric;
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
  if jsonb_typeof(coalesce(p_answers, '{}'::jsonb)) <> 'object' then raise exception 'answers must be an object'; end if;

  insert into public.submissions (center_id, homework_id, student_id)
  values (v_h.center_id, p_homework, v_student)
  on conflict (homework_id, student_id) do nothing;

  select * into v_s from public.submissions
  where homework_id = p_homework and student_id = v_student for update;
  if v_s.status in ('submitted','reviewed') then raise exception 'already submitted'; end if;

  if p_submit then v_score := app.grade_answers(v_h.assignment_id, coalesce(p_answers, '{}'::jsonb)); end if;

  update public.submissions
     set answers = coalesce(p_answers, '{}'::jsonb),
         status = case when p_submit then 'submitted' else 'in_progress' end::public.submission_status,
         started_at = coalesce(started_at, now()),
         submitted_at = case when p_submit then now() end,
         score = case when p_submit then v_score end
   where id = v_s.id
  returning * into v_s;

  if p_submit then
    select a.title into v_title from public.assignments a where a.id = v_h.assignment_id;
    perform app.add_activity(v_h.center_id, v_student, 'homework', 'Homework submitted',
      v_title || coalesce(' · ' || round(v_score)::text || '%', ''), null, p_homework);
  end if;
  return v_s.status;
end $$;

-- The signed-in student's own result for one homework, with the answer key,
-- available only after they have submitted.
create function public.my_homework_result(p_homework uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_h public.homework; v_s public.submissions;
begin
  select * into v_h from public.homework where id = p_homework;
  if v_h.id is null then perform app.forbid(); end if;
  select sub.* into v_s from public.submissions sub
  join public.students st on st.id = sub.student_id
  join public.memberships m on m.id = st.membership_id
  where sub.homework_id = p_homework and m.user_id = auth.uid() and m.status = 'active';
  if v_s.id is null or v_s.status not in ('submitted','reviewed') then return null; end if;
  return jsonb_build_object(
    'status', v_s.status, 'score', v_s.score, 'feedback', v_s.feedback, 'answers', v_s.answers,
    'key', (select k.answers from public.assignment_keys k where k.assignment_id = v_h.assignment_id));
end $$;

revoke execute on function app.grade_answers(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.my_homework_result(uuid) from public, anon;
grant execute on function public.my_homework_result(uuid) to authenticated;
