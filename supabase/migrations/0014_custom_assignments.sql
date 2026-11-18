-- =====================================================================
-- Centre-made assignments (uploaded worksheets, AI drafts) and AI usage.
--
-- Questions are either multiple choice ("mc": options + a key) or open
-- ("open": a written answer the mentor grades). Auto-grading only counts
-- multiple-choice questions; open answers wait for the mentor's review.
--
-- Staff-made assignments are approved straight away; a mentor's goes to
-- "pending approval" for a manager, as the original workflow intended.
-- =====================================================================

-- Auto-grade multiple-choice questions only.
create or replace function app.grade_answers(p_assignment uuid, p_answers jsonb)
returns numeric language sql stable security definer set search_path = '' as $$
  with q as (
    select x->>'id' as id from public.assignments a, jsonb_array_elements(a.content->'questions') x
    where a.id = p_assignment and coalesce(x->>'type', 'mc') = 'mc'
  ), k as (select answers from public.assignment_keys where assignment_id = p_assignment)
  select case when (select count(*) from q) = 0 or not exists (select 1 from k) then null
         else round(100.0 * (
                select count(*) from q, k
                where p_answers ? q.id and k.answers ? q.id
                  and p_answers->>q.id = k.answers->q.id->>'answer'
              ) / (select count(*) from q), 2) end;
$$;

-- Students may now write open answers; cap the size of what they save.
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
  if length(coalesce(p_answers, '{}'::jsonb)::text) > 100000 then raise exception 'Your answers are too long.'; end if;

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

-- Validates a question set and its key; raises a readable error.
create function app.check_questions(p_questions jsonb, p_answers jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare q jsonb; n int := 0; v_id text; v_opts int; v_ans text;
begin
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then raise exception 'Add at least one question.'; end if;
  if jsonb_array_length(p_questions) > 40 then raise exception 'Keep it to 40 questions or fewer.'; end if;
  if jsonb_typeof(coalesce(p_answers, '{}')) <> 'object' then raise exception 'answers must be an object'; end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    n := n + 1;
    v_id := q->>'id';
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Question % has no valid id.', n; end if;
    if coalesce(length(trim(q->>'prompt')), 0) < 3 then raise exception 'Question % needs a prompt.', n; end if;
    if length(q->>'prompt') > 2000 then raise exception 'Question % is too long.', n; end if;
    if coalesce(q->>'type', '') = 'mc' then
      v_opts := coalesce(jsonb_array_length(q->'options'), 0);
      if v_opts < 2 or v_opts > 6 then raise exception 'Question % needs 2 to 6 options.', n; end if;
      if exists (select 1 from jsonb_array_elements_text(q->'options') o where length(trim(o)) = 0) then
        raise exception 'Question % has an empty option.', n;
      end if;
      v_ans := p_answers->v_id->>'answer';
      if v_ans is null or v_ans !~ '^\d+$' or v_ans::int >= v_opts then raise exception 'Mark the correct option for question %.', n; end if;
    elsif coalesce(q->>'type', '') <> 'open' then
      raise exception 'Question % has an unknown type.', n;
    end if;
  end loop;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_questions) x) <> n then raise exception 'Question ids must be unique.'; end if;
end $$;

create function public.create_custom_assignment(
  p_center    uuid,
  p_title     text,
  p_skill     public.skill,
  p_level     public.cefr_level,
  p_source    public.assignment_source,
  p_passage   text,
  p_questions jsonb,
  p_answers   jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid; v_staff boolean := app.is_staff(p_center);
begin
  if not (v_staff or app.has_role(p_center, '{mentor}')) then perform app.forbid(); end if;
  if p_source not in ('upload','ai') then raise exception 'unsupported source'; end if;
  if coalesce(length(trim(p_title)), 0) < 3 then raise exception 'Give the assignment a title.'; end if;
  if length(p_title) > 200 then raise exception 'Keep the title under 200 characters.'; end if;
  if length(coalesce(p_passage, '')) > 30000 then raise exception 'The passage is too long (30,000 characters at most).'; end if;
  perform app.check_questions(p_questions, p_answers);
  v_me := app.my_staff_membership(p_center);

  insert into public.assignments (center_id, title, skill, level, source, content, status, created_by, approved_by, approved_at)
  values (p_center, trim(p_title), p_skill, p_level, p_source,
          jsonb_build_object('passage', nullif(trim(coalesce(p_passage, '')), ''),
            'questions', (select jsonb_agg(jsonb_build_object('id', x->>'id', 'type', x->>'type', 'prompt', trim(x->>'prompt'))
                                           || case when x->>'type' = 'mc' then jsonb_build_object('options', x->'options') else '{}'::jsonb end)
                          from jsonb_array_elements(p_questions) x)),
          case when v_staff then 'approved' else 'pending_approval' end::public.assignment_status,
          v_me, case when v_staff then v_me end, case when v_staff then now() end)
  returning id into v_id;

  insert into public.assignment_keys (assignment_id, center_id, answers)
  values (v_id, p_center, coalesce(p_answers, '{}'));
  return v_id;
end $$;

-- Assign any approved assignment, with an optional note for this setting.
create function public.assign_assignment(p_assignment uuid, p_group uuid, p_due_at timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_hw uuid;
begin
  v_hw := public.assign_homework(p_assignment, p_group, p_due_at);
  if length(coalesce(p_note, '')) > 2000 then raise exception 'Keep the note under 2000 characters.'; end if;
  update public.homework set note = nullif(trim(p_note), '') where id = v_hw;
  return v_hw;
end $$;

-- ------------------------------------------------------------- AI usage
create table public.ai_requests (
  id         bigint generated always as identity primary key,
  center_id  uuid not null references public.centers(id) on delete cascade,
  user_id    uuid not null,
  kind       text not null check (kind in ('generate','extract')),
  created_at timestamptz not null default now()
);
create index ai_requests_recent_idx on public.ai_requests (center_id, created_at desc);
alter table public.ai_requests enable row level security;
create policy ai_requests_select on public.ai_requests for select to authenticated using (app.is_admin(center_id));
revoke all on public.ai_requests from anon;
grant select on public.ai_requests to authenticated;

-- Called by the server before each AI request: checks the caller may use AI
-- in this centre and is within the limits, then records the request.
create function public.claim_ai_request(p_center uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (app.is_staff(p_center) or app.has_role(p_center, '{mentor}')) then perform app.forbid(); end if;
  if (select count(*) from public.ai_requests where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'AI limit reached: 20 requests per hour. Try again a little later.';
  end if;
  if (select count(*) from public.ai_requests where center_id = p_center and created_at > now() - interval '1 day') >= 200 then
    raise exception 'AI limit reached for your centre today (200 requests).';
  end if;
  insert into public.ai_requests (center_id, user_id, kind) values (p_center, auth.uid(), p_kind);
end $$;

revoke execute on function app.check_questions(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb) from public, anon;
revoke execute on function public.assign_assignment(uuid, uuid, timestamptz, text) from public, anon;
revoke execute on function public.claim_ai_request(uuid, text) from public, anon;
grant execute on function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb) to authenticated;
grant execute on function public.assign_assignment(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.claim_ai_request(uuid, text) to authenticated;
