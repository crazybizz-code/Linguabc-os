-- =====================================================================
-- LinguABC library: full IELTS Academic reading and listening tests.
--
-- Written by LinguABC itself (platform admins), with AI drafts and Fish
-- Audio recordings, so there is no third-party licence. Full mocks use
-- these tests only; centres may also set them as homework (later).
--
--   * library_tests: the test as students see it, in sections. Reading has
--     3 passages, listening 4 recorded sections; 40 questions in all,
--     numbered q1..q40 across the sections.
--   * library_test_keys: answers and listening transcripts. Readable by
--     platform admins only. Anyone can open a centre and become "staff",
--     so a key readable by every centre's staff would leak mock answers.
--     Marking happens in the database.
--   * library-audio bucket: tests/{test_id}/{uuid}.mp3. Admins write;
--     staff and mentors can listen to published tests when choosing one.
--
-- Platform admins are listed in platform_admins, which only the database
-- owner can change (no policies, no grants).
-- =====================================================================

create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

create function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
revoke execute on function app.is_platform_admin() from public, anon;
grant execute on function app.is_platform_admin() to authenticated;

-- For the UI: show the LinguABC admin area or not.
create function public.am_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select app.is_platform_admin(); $$;
revoke execute on function public.am_platform_admin() from public, anon;
grant execute on function public.am_platform_admin() to authenticated;

create table public.library_tests (
  id             uuid primary key default gen_random_uuid(),
  skill          public.skill not null check (skill in ('reading','listening')),
  title          text not null check (length(btrim(title)) between 3 and 200),
  level          public.cefr_level,
  status         text not null default 'draft' check (status in ('draft','published','hidden')),
  -- [{id, title, instructions, passage (reading), audio_path (listening), groups, questions}]
  sections       jsonb not null default '[]' check (jsonb_typeof(sections) = 'array'),
  question_count int not null default 0,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  published_at   timestamptz
);
create index library_tests_browse_idx on public.library_tests (status, skill, created_at desc);

create table public.library_test_keys (
  test_id     uuid primary key references public.library_tests(id) on delete cascade,
  answers     jsonb not null default '{}',   -- {q1: {answer|accepted, explanation}}
  transcripts jsonb not null default '{}'    -- {section_id: script}
);

alter table public.library_tests     enable row level security;
alter table public.library_test_keys enable row level security;

create policy library_tests_select on public.library_tests for select to authenticated
  using ((status = 'published' and app.is_any_staff()) or app.is_platform_admin());
create policy library_test_keys_select on public.library_test_keys for select to authenticated
  using (app.is_platform_admin());

revoke all on public.library_tests, public.library_test_keys from anon;
grant select on public.library_tests, public.library_test_keys to authenticated;

-- AI usage by platform admins belongs to no centre.
alter table public.ai_requests alter column center_id drop not null;
alter table public.ai_requests drop constraint ai_requests_kind_check;
alter table public.ai_requests add constraint ai_requests_kind_check check (kind in ('generate', 'extract', 'audio', 'test'));

create function public.claim_admin_ai_request(p_kind text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not app.is_platform_admin() then perform app.forbid(); end if;
  if p_kind not in ('test', 'audio') then raise exception 'unsupported kind'; end if;
  if (select count(*) from public.ai_requests where user_id = auth.uid() and center_id is null
      and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'AI limit reached: 120 requests per hour. Try again a little later.';
  end if;
  insert into public.ai_requests (center_id, user_id, kind) values (null, auth.uid(), p_kind) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.claim_admin_ai_request(text) from public, anon;
grant execute on function public.claim_admin_ai_request(text) to authenticated;

-- ---------------------------------------------------------------------
-- Library audio
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library-audio', 'library-audio', false, 31457280, array['audio/mpeg'])
on conflict (id) do nothing;

-- The test a library-audio object belongs to; null if the path is not
-- tests/{uuid}/{uuid}.mp3.
create function app.library_audio_test(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_name ~ '^tests/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$'
              then split_part(p_name, '/', 2)::uuid end;
$$;

-- Is this file one of the sections of the test it is filed under?
create function app.library_audio_used(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.library_tests t, jsonb_array_elements(t.sections) s
                 where t.id = app.library_audio_test(p_name) and s->>'audio_path' = p_name);
$$;

create function app.can_hear_library_audio(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin()
      or (app.is_any_staff() and app.library_audio_used(p_name)
          and exists (select 1 from public.library_tests where id = app.library_audio_test(p_name) and status = 'published'));
$$;

revoke execute on function app.library_audio_test(text), app.library_audio_used(text), app.can_hear_library_audio(text) from public, anon;
grant execute on function app.library_audio_test(text), app.library_audio_used(text), app.can_hear_library_audio(text) to authenticated;

create policy library_audio_select on storage.objects for select to authenticated
  using (bucket_id = 'library-audio' and app.can_hear_library_audio(name));
create policy library_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'library-audio' and app.is_platform_admin() and app.library_audio_test(name) is not null);
-- A replaced recording can be removed while no section uses it.
create policy library_audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'library-audio' and app.is_platform_admin() and not app.library_audio_used(name));

-- ---------------------------------------------------------------------
-- Writing tests (platform admins only)
-- ---------------------------------------------------------------------

-- Saves a draft (new when p_id is null). Questions are numbered q1.. across
-- sections; group ids must be unique across the test.
create function public.save_library_test(
  p_id          uuid,
  p_skill       public.skill,
  p_title       text,
  p_level       public.cefr_level,
  p_sections    jsonb,
  p_answers     jsonb,
  p_transcripts jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_questions jsonb; v_groups jsonb; v_sec jsonb; v_status text;
begin
  if not app.is_platform_admin() then perform app.forbid(); end if;
  if p_skill not in ('reading','listening') then raise exception 'A library test is reading or listening.'; end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then raise exception 'Give the test a title.'; end if;
  if jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then raise exception 'Add at least one section.'; end if;
  if jsonb_array_length(p_sections) > 4 then raise exception 'A test has at most four sections.'; end if;
  if length(p_sections::text) > 400000 then raise exception 'The test is too long.'; end if;
  if jsonb_typeof(coalesce(p_transcripts, '{}')) <> 'object' then raise exception 'transcripts must be an object'; end if;
  if v_id is not null then
    select status into v_status from public.library_tests where id = v_id for update;
    if v_status is null then raise exception 'Test not found.'; end if;
    if v_status = 'published' then raise exception 'Unpublish the test before editing it.'; end if;
  end if;

  for v_sec in select * from jsonb_array_elements(p_sections) loop
    if p_skill = 'reading' and coalesce(v_sec->>'audio_path', '') <> '' then raise exception 'Reading sections have no audio.'; end if;
    if coalesce(v_sec->>'audio_path', '') <> '' and (app.library_audio_test(v_sec->>'audio_path') is distinct from v_id
        or not exists (select 1 from storage.objects where bucket_id = 'library-audio' and name = v_sec->>'audio_path')) then
      raise exception 'A recording was not found. Record that section again.';
    end if;
    if length(coalesce(v_sec->>'passage', '')) > 20000 then raise exception 'A passage is too long (20,000 characters at most).'; end if;
  end loop;

  select coalesce(jsonb_agg(q order by s.o, t.o), '[]'), coalesce((select jsonb_agg(g) from jsonb_array_elements(p_sections) s2, jsonb_array_elements(coalesce(s2->'groups', '[]')) g), '[]')
    into v_questions, v_groups
  from jsonb_array_elements(p_sections) with ordinality s(sec, o),
       jsonb_array_elements(coalesce(s.sec->'questions', '[]')) with ordinality t(q, o);
  if (select count(distinct x->>'id') from jsonb_array_elements(v_groups) x) <> jsonb_array_length(v_groups) then
    raise exception 'Two question groups share an id.';
  end if;
  perform app.check_questions(v_questions, p_answers, v_groups);

  if v_id is null then
    insert into public.library_tests (skill, title, level, sections, question_count, created_by)
    values (p_skill, btrim(p_title), p_level, p_sections, jsonb_array_length(v_questions), auth.uid())
    returning id into v_id;
    insert into public.library_test_keys (test_id, answers, transcripts) values (v_id, p_answers, coalesce(p_transcripts, '{}'));
  else
    update public.library_tests
       set skill = p_skill, title = btrim(p_title), level = p_level, sections = p_sections,
           question_count = jsonb_array_length(v_questions), updated_at = now()
     where id = v_id;
    update public.library_test_keys set answers = p_answers, transcripts = coalesce(p_transcripts, '{}') where test_id = v_id;
  end if;
  return v_id;
end $$;

-- A new test needs its id before its audio can be filed under it.
create function public.new_library_test(p_skill public.skill, p_title text, p_level public.cefr_level default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.is_platform_admin() then perform app.forbid(); end if;
  if p_skill not in ('reading','listening') then raise exception 'A library test is reading or listening.'; end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then raise exception 'Give the test a title.'; end if;
  insert into public.library_tests (skill, title, level, created_by) values (p_skill, btrim(p_title), p_level, auth.uid()) returning id into v_id;
  insert into public.library_test_keys (test_id) values (v_id);
  return v_id;
end $$;

-- Publish (checks the IELTS shape) or take back to draft / hide.
create function public.set_library_test_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.library_tests; v_sections int;
begin
  if not app.is_platform_admin() then perform app.forbid(); end if;
  if p_status not in ('draft','published','hidden') then raise exception 'unknown status'; end if;
  select * into v from public.library_tests where id = p_id for update;
  if v.id is null then raise exception 'Test not found.'; end if;
  if p_status = 'published' then
    v_sections := jsonb_array_length(v.sections);
    if v.question_count <> 40 then raise exception 'A full test has 40 questions; this one has %.', v.question_count; end if;
    if v.skill = 'listening' and (v_sections <> 4 or exists (
         select 1 from jsonb_array_elements(v.sections) s where coalesce(s->>'audio_path', '') = '')) then
      raise exception 'A listening test needs four sections, each with its recording.';
    end if;
    if v.skill = 'reading' and (v_sections <> 3 or exists (
         select 1 from jsonb_array_elements(v.sections) s where length(btrim(coalesce(s->>'passage', ''))) < 500)) then
      raise exception 'A reading test needs three passages.';
    end if;
  end if;
  update public.library_tests
     set status = p_status, updated_at = now(),
         published_at = case when p_status = 'published' then now() else published_at end
   where id = p_id;
end $$;

-- Only drafts that were never published can be deleted.
create function public.delete_library_test(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.forbid(); end if;
  if exists (select 1 from public.library_tests where id = p_id and (status <> 'draft' or published_at is not null)) then
    raise exception 'Only an unpublished draft can be deleted. Hide the test instead.';
  end if;
  delete from public.library_tests where id = p_id;
end $$;

revoke execute on function public.save_library_test(uuid, public.skill, text, public.cefr_level, jsonb, jsonb, jsonb),
                           public.new_library_test(public.skill, text, public.cefr_level),
                           public.set_library_test_status(uuid, text),
                           public.delete_library_test(uuid) from public, anon;
grant execute on function public.save_library_test(uuid, public.skill, text, public.cefr_level, jsonb, jsonb, jsonb),
                          public.new_library_test(public.skill, text, public.cefr_level),
                          public.set_library_test_status(uuid, text),
                          public.delete_library_test(uuid) to authenticated;
