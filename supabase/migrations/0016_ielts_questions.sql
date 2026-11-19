-- =====================================================================
-- IELTS-style question engine.
--
-- Question types, all marked server-side against a key students cannot read:
--   mc        one correct option                    answer: 2
--   multi     choose N letters                      answer: [0,3]   (1 mark each)
--   tfng      True / False / Not Given              answer: "false"
--   ynng      Yes / No / Not Given                  answer: "no"
--   gap       completion, word-limited              accepted: ["1897","in 1897"]
--   matching  pick from the group's shared options  answer: 2
--   headings  same as matching, shown as a list     answer: 2
--   open      written answer, graded by the mentor  (0 auto marks)
--
-- Questions may belong to a group, which carries the shared instructions
-- and, for matching/headings, the pool of options:
--   content = { passage, groups: [{id, instructions, options}], questions: [...] }
-- Older content (plain mc/open, no groups) keeps working unchanged.
-- =====================================================================

-- Compare answers the way a marker would: case, spacing and stray
-- punctuation are ignored; hyphens, apostrophes and slashes are not.
create function app.norm_answer(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(lower(coalesce(p, '')), '[^a-z0-9/''’\-\s]', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

create function app.word_count(p text) returns int
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p, '')) = '' then 0
              else array_length(regexp_split_to_array(btrim(p), '\s+'), 1) end;
$$;

-- Marks a question is worth when marked automatically. Open answers, and
-- anything with no key, are left to the mentor and count for nothing.
create function app.question_marks(q jsonb, k jsonb) returns int
language sql immutable set search_path = '' as $$
  select case
           when coalesce(q->>'type', 'mc') = 'open' then 0
           when k is null or k = '{}'::jsonb then 0
           when coalesce(q->>'type', 'mc') = 'multi' then greatest(coalesce(jsonb_array_length(k->'answer'), 1), 1)
           else 1
         end;
$$;

create function app.grade_one(q jsonb, k jsonb, a jsonb) returns int
language plpgsql immutable set search_path = '' as $$
declare t text := coalesce(q->>'type', 'mc'); n int; got int; txt text;
begin
  if k is null or a is null or jsonb_typeof(a) = 'null' then return 0; end if;

  if t = 'multi' then
    n := coalesce(jsonb_array_length(k->'answer'), 0);
    if n = 0 or jsonb_typeof(a) <> 'array' then return 0; end if;
    -- Selecting more than asked scores nothing, as in the exam.
    if jsonb_array_length(a) > n then return 0; end if;
    select count(distinct x) into got from jsonb_array_elements(a) x
     where exists (select 1 from jsonb_array_elements(k->'answer') y where y = x);
    return got;

  elsif t = 'gap' then
    txt := app.norm_answer(a #>> '{}');
    if txt = '' then return 0; end if;
    -- Over the word limit is wrong, as in the exam.
    if app.word_count(txt) > coalesce((q->>'max_words')::int, 3) then return 0; end if;
    return case when exists (
      select 1 from jsonb_array_elements_text(coalesce(k->'accepted', '[]'::jsonb)) acc
       where app.norm_answer(acc) = txt) then 1 else 0 end;

  elsif t = 'open' then
    return 0;

  else -- mc, tfng, ynng, matching, headings
    return case when k->'answer' is not null
                 and (a #>> '{}') is not distinct from (k->'answer' #>> '{}') then 1 else 0 end;
  end if;
end $$;

-- {question_id: {earned, total}} for every automatically marked question.
create function app.mark_map(p_questions jsonb, p_key jsonb, p_answers jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(x->>'id', jsonb_build_object(
           'earned', app.grade_one(x, p_key->(x->>'id'), p_answers->(x->>'id')),
           'total',  app.question_marks(x, p_key->(x->>'id')))), '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) x
  where coalesce(x->>'type', 'mc') <> 'open' and app.question_marks(x, p_key->(x->>'id')) > 0;
$$;

-- Percentage of the automatically marked questions answered correctly.
create or replace function app.grade_answers(p_assignment uuid, p_answers jsonb)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_q jsonb; v_k jsonb; v_earned int := 0; v_total int := 0; x jsonb;
begin
  select a.content->'questions', coalesce(k.answers, '{}'::jsonb) into v_q, v_k
  from public.assignments a
  left join public.assignment_keys k on k.assignment_id = a.id
  where a.id = p_assignment;
  if v_q is null then return null; end if;

  for x in select * from jsonb_array_elements(v_q) loop
    v_total  := v_total + app.question_marks(x, v_k->(x->>'id'));
    v_earned := v_earned + app.grade_one(x, v_k->(x->>'id'), p_answers->(x->>'id'));
  end loop;
  if v_total = 0 then return null; end if;
  return round(100.0 * v_earned / v_total, 2);
end $$;

-- Student's own result, with the key and per-question marks, after submitting.
create or replace function public.my_homework_result(p_homework uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_h public.homework; v_s public.submissions; v_q jsonb; v_k jsonb;
begin
  select * into v_h from public.homework where id = p_homework;
  if v_h.id is null then perform app.forbid(); end if;
  select sub.* into v_s from public.submissions sub
  join public.students st on st.id = sub.student_id
  join public.memberships m on m.id = st.membership_id
  where sub.homework_id = p_homework and m.user_id = auth.uid() and m.status = 'active';
  if v_s.id is null or v_s.status not in ('submitted','reviewed') then return null; end if;

  select a.content->'questions', coalesce(k.answers, '{}'::jsonb) into v_q, v_k
  from public.assignments a
  left join public.assignment_keys k on k.assignment_id = a.id
  where a.id = v_h.assignment_id;

  return jsonb_build_object(
    'status', v_s.status, 'score', v_s.score, 'feedback', v_s.feedback, 'answers', v_s.answers,
    'key', v_k, 'marks', app.mark_map(v_q, v_k, v_s.answers));
end $$;

-- Marks for one submission, for the mentor's review.
create function public.submission_marks(p_submission uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_s public.submissions; v_q jsonb; v_k jsonb;
begin
  select * into v_s from public.submissions where id = p_submission;
  if v_s.id is null or not (app.is_staff(v_s.center_id) or app.has_role(v_s.center_id, '{mentor}')) then
    perform app.forbid();
  end if;
  select a.content->'questions', coalesce(k.answers, '{}'::jsonb) into v_q, v_k
  from public.homework h
  join public.assignments a on a.id = h.assignment_id
  left join public.assignment_keys k on k.assignment_id = a.id
  where h.id = v_s.homework_id;
  return app.mark_map(v_q, v_k, v_s.answers);
end $$;

-- ------------------------------------------------------------- validation
create or replace function app.check_questions(p_questions jsonb, p_answers jsonb, p_groups jsonb default '[]')
returns void language plpgsql stable set search_path = '' as $$
declare
  q jsonb; n int := 0; v_id text; v_type text; v_opts int; v_ans jsonb; v_grp text; v_pool int;
begin
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then raise exception 'Add at least one question.'; end if;
  if jsonb_array_length(p_questions) > 60 then raise exception 'Keep it to 60 questions or fewer.'; end if;
  if jsonb_typeof(coalesce(p_answers, '{}')) <> 'object' then raise exception 'answers must be an object'; end if;
  if jsonb_typeof(coalesce(p_groups, '[]')) <> 'array' then raise exception 'groups must be an array'; end if;

  for q in select * from jsonb_array_elements(p_questions) loop
    n := n + 1;
    v_id := q->>'id';
    v_type := coalesce(q->>'type', 'mc');
    if v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'Question % has no valid id.', n; end if;
    if coalesce(length(btrim(q->>'prompt')), 0) < 1 then raise exception 'Question % needs a prompt.', n; end if;
    if length(q->>'prompt') > 2000 then raise exception 'Question % is too long.', n; end if;
    v_ans := p_answers->v_id->'answer';

    -- a question may only point at a group that exists
    v_grp := q->>'group';
    v_pool := null;
    if v_grp is not null then
      select coalesce(jsonb_array_length(g->'options'), 0) into v_pool
      from jsonb_array_elements(p_groups) g where g->>'id' = v_grp;
      if v_pool is null then raise exception 'Question % refers to a group that does not exist.', n; end if;
    end if;

    if v_type in ('mc', 'multi') then
      v_opts := coalesce(jsonb_array_length(q->'options'), 0);
      if v_opts < 2 or v_opts > 10 then raise exception 'Question % needs 2 to 10 options.', n; end if;
      if exists (select 1 from jsonb_array_elements_text(q->'options') o where btrim(o) = '') then
        raise exception 'Question % has an empty option.', n;
      end if;
      if v_type = 'mc' then
        if v_ans is null or jsonb_typeof(v_ans) <> 'number' or (v_ans #>> '{}')::int not between 0 and v_opts - 1 then
          raise exception 'Mark the correct option for question %.', n;
        end if;
      else
        if v_ans is null or jsonb_typeof(v_ans) <> 'array' or jsonb_array_length(v_ans) < 2 then
          raise exception 'Question % needs at least two correct options.', n;
        end if;
        if jsonb_array_length(v_ans) >= v_opts then raise exception 'Question % cannot have every option correct.', n; end if;
        if exists (select 1 from jsonb_array_elements(v_ans) y
                   where jsonb_typeof(y) <> 'number' or (y #>> '{}')::int not between 0 and v_opts - 1) then
          raise exception 'Question % has a correct option that does not exist.', n;
        end if;
        if (select count(distinct y) from jsonb_array_elements(v_ans) y) <> jsonb_array_length(v_ans) then
          raise exception 'Question % lists the same correct option twice.', n;
        end if;
      end if;

    elsif v_type in ('tfng', 'ynng') then
      if v_ans is null or (v_ans #>> '{}') <> all (case when v_type = 'tfng'
            then array['true','false','not_given'] else array['yes','no','not_given'] end) then
        raise exception 'Choose the correct answer for question %.', n;
      end if;

    elsif v_type in ('matching', 'headings') then
      if v_grp is null then raise exception 'Question % must belong to a group with the options.', n; end if;
      if v_pool < 2 or v_pool > 14 then raise exception 'The group for question % needs 2 to 14 options.', n; end if;
      if v_ans is null or jsonb_typeof(v_ans) <> 'number' or (v_ans #>> '{}')::int not between 0 and v_pool - 1 then
        raise exception 'Mark the correct option for question %.', n;
      end if;

    elsif v_type = 'gap' then
      if coalesce((q->>'max_words')::int, 3) not between 1 and 5 then raise exception 'Question % has an odd word limit.', n; end if;
      if coalesce(jsonb_array_length(p_answers->v_id->'accepted'), 0) = 0 then
        raise exception 'Question % needs at least one accepted answer.', n;
      end if;
      if exists (select 1 from jsonb_array_elements_text(p_answers->v_id->'accepted') acc where btrim(acc) = '') then
        raise exception 'Question % has an empty accepted answer.', n;
      end if;
      if exists (select 1 from jsonb_array_elements_text(p_answers->v_id->'accepted') acc
                 where app.word_count(app.norm_answer(acc)) > coalesce((q->>'max_words')::int, 3)) then
        raise exception 'An accepted answer for question % is longer than its own word limit.', n;
      end if;

    elsif v_type <> 'open' then
      raise exception 'Question % has an unknown type.', n;
    end if;
  end loop;

  if (select count(distinct x->>'id') from jsonb_array_elements(p_questions) x) <> n then raise exception 'Question ids must be unique.'; end if;
  if (select count(distinct g->>'id') from jsonb_array_elements(p_groups) g) <> jsonb_array_length(p_groups) then
    raise exception 'Group ids must be unique.';
  end if;
end $$;

drop function if exists app.check_questions(jsonb, jsonb);

-- create_custom_assignment, now carrying groups and the richer question shapes.
create or replace function public.create_custom_assignment(
  p_center    uuid,
  p_title     text,
  p_skill     public.skill,
  p_level     public.cefr_level,
  p_source    public.assignment_source,
  p_passage   text,
  p_questions jsonb,
  p_answers   jsonb,
  p_groups    jsonb default '[]',
  p_audio_url text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid; v_staff boolean := app.is_staff(p_center);
begin
  if not (v_staff or app.has_role(p_center, '{mentor}')) then perform app.forbid(); end if;
  if p_source not in ('upload','ai') then raise exception 'unsupported source'; end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then raise exception 'Give the assignment a title.'; end if;
  if length(p_title) > 200 then raise exception 'Keep the title under 200 characters.'; end if;
  if length(coalesce(p_passage, '')) > 30000 then raise exception 'The passage is too long (30,000 characters at most).'; end if;
  if p_audio_url is not null and p_audio_url !~ '^https://' then raise exception 'The audio link must be https.'; end if;
  perform app.check_questions(p_questions, p_answers, coalesce(p_groups, '[]'));
  v_me := app.my_staff_membership(p_center);

  insert into public.assignments (center_id, title, skill, level, source, content, status, created_by, approved_by, approved_at)
  values (p_center, btrim(p_title), p_skill, p_level, p_source,
          jsonb_strip_nulls(jsonb_build_object(
            'passage', nullif(btrim(coalesce(p_passage, '')), ''),
            'audio_url', p_audio_url,
            'groups', coalesce(p_groups, '[]'),
            'questions', (
              select jsonb_agg(jsonb_strip_nulls(
                       jsonb_build_object('id', x->>'id', 'type', coalesce(x->>'type', 'mc'),
                                          'prompt', btrim(x->>'prompt'), 'group', x->>'group',
                                          'options', x->'options', 'max_words', x->'max_words',
                                          'select', case when coalesce(x->>'type','mc') = 'multi'
                                                    then to_jsonb(jsonb_array_length(p_answers->(x->>'id')->'answer')) end))
                     order by o)
              from jsonb_array_elements(p_questions) with ordinality t(x, o)))),
          case when v_staff then 'approved' else 'pending_approval' end::public.assignment_status,
          v_me, case when v_staff then v_me end, case when v_staff then now() end)
  returning id into v_id;

  insert into public.assignment_keys (assignment_id, center_id, answers)
  values (v_id, p_center, coalesce(p_answers, '{}'));
  return v_id;
end $$;

drop function if exists public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb);

revoke execute on function app.check_questions(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function app.mark_map(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb, jsonb, text) from public, anon;
revoke execute on function public.submission_marks(uuid) from public, anon;
grant execute on function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function public.submission_marks(uuid) to authenticated;
