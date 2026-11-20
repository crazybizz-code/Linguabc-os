-- 0028: self-practice for students (Base44 "Practice").
--
-- A student picks a published LinguABC library article or podcast, answers
-- its questions and is marked in the database. To keep homework honest:
--   * the answer key is never returned, only which questions were right;
--   * an item the centre has set as homework cannot be practised;
--   * at most 3 attempts per item per day.
-- Attempts are kept so the student, their parents and staff see practice
-- in progress.

create table public.practice_attempts (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null,
  student_id uuid not null,
  item_id    text not null references public.library_items(id) on delete cascade,
  skill      public.skill not null,
  score      numeric(5,2) check (score between 0 and 100),
  earned     int not null default 0,
  total      int not null default 0,
  created_at timestamptz not null default now(),
  foreign key (student_id, center_id) references public.students(id, center_id) on delete cascade
);
create index practice_attempts_student_idx on public.practice_attempts (student_id, created_at desc);

alter table public.practice_attempts enable row level security;
create policy practice_attempts_select on public.practice_attempts for select to authenticated
  using (app.can_see_student(student_id));
revoke all on public.practice_attempts from anon;
grant select on public.practice_attempts to authenticated;

-- The signed-in student's own record (one centre at a time).
create function app.my_student_row()
returns public.students language sql stable security definer set search_path = '' as $$
  select s.* from public.students s
  join public.memberships m on m.id = s.membership_id
  where m.user_id = auth.uid() and m.status = 'active' and m.role = 'student'
  limit 1;
$$;

create function public.practice_library_item(p_item text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s public.students; v_i public.library_items; v_k jsonb; v_marks jsonb; v_earned int; v_total int; v_score numeric;
begin
  v_s := app.my_student_row();
  if v_s.id is null then perform app.forbid('students only'); end if;
  if jsonb_typeof(coalesce(p_answers, 'null')) <> 'object' or length(p_answers::text) > 20000 then raise exception 'Answers are malformed.'; end if;
  select * into v_i from public.library_items where id = p_item and status = 'published';
  if v_i.id is null then raise exception 'Library item not found.'; end if;
  if exists (select 1 from public.assignments where center_id = v_s.center_id and library_item_id = p_item) then
    raise exception 'Your centre set this as homework, so it is not open for practice.';
  end if;
  if (select count(*) from public.practice_attempts where student_id = v_s.id and item_id = p_item and created_at > now() - interval '1 day') >= 3 then
    raise exception 'You have practised this 3 times today. Try another one.';
  end if;

  select answers into v_k from public.library_answer_keys where item_id = p_item;
  v_marks := app.mark_map(v_i.questions, coalesce(v_k, '{}'), p_answers);
  select coalesce(sum((m->>'earned')::int), 0), coalesce(sum((m->>'total')::int), 0) into v_earned, v_total
  from jsonb_each(v_marks) e(id, m);
  v_score := case when v_total > 0 then round(100.0 * v_earned / v_total, 2) end;

  insert into public.practice_attempts (center_id, student_id, item_id, skill, score, earned, total)
  values (v_s.center_id, v_s.id, p_item, v_i.skill, v_score, v_earned, v_total);
  -- Which questions were right; never the key itself.
  return jsonb_build_object('score', v_score, 'earned', v_earned, 'total', v_total,
    'correct', (select coalesce(jsonb_object_agg(e.id, (e.m->>'earned')::int = (e.m->>'total')::int), '{}') from jsonb_each(v_marks) e(id, m)));
end $$;

-- Library items the student may practise (not set as homework in their centre).
create function public.my_practice_blocked()
returns setof text language sql stable security definer set search_path = '' as $$
  select a.library_item_id from public.assignments a
  where a.center_id = (app.my_student_row()).center_id and a.library_item_id is not null;
$$;

revoke execute on function app.my_student_row() from public, anon;
grant execute on function app.my_student_row() to authenticated;
revoke execute on function public.practice_library_item(text, jsonb), public.my_practice_blocked() from public, anon;
grant execute on function public.practice_library_item(text, jsonb), public.my_practice_blocked() to authenticated;
