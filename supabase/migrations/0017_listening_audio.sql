-- =====================================================================
-- Listening audio (Fish Audio).
--
-- Audio is generated on the server and kept in a private Supabase Storage
-- bucket, one folder per centre:  listening-audio/{center_id}/{uuid}.mp3
--   * staff and mentors of the centre may upload and listen;
--   * a student or parent may listen only to audio attached to an
--     assignment set as homework for a group they can see;
--   * playback goes through short-lived signed URLs made on the server.
--
-- When an assignment has audio, its passage is the transcript. The
-- transcript would give the answers away, so it is kept with the answer
-- key (assignment_keys.transcript) and reaches a student only through
-- my_homework_result, after they submit.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listening-audio', 'listening-audio', false, 20971520, array['audio/mpeg'])
on conflict (id) do nothing;

-- The centre a listening-audio object belongs to, from its path; null if
-- the path is not {uuid}/{uuid}.mp3.
create function app.audio_center(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

-- Staff and mentors of the centre may make listening audio.
create function app.can_make_audio(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.audio_center(p_name) is not null
     and (app.is_staff(app.audio_center(p_name)) or app.has_role(app.audio_center(p_name), '{mentor}'));
$$;

-- Students and parents may hear audio set as homework for a group they can see.
create function app.can_hear_audio(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.can_make_audio(p_name) or exists (
    select 1 from public.assignments a
    join public.homework h on h.assignment_id = a.id and h.center_id = a.center_id
    where a.center_id = app.audio_center(p_name)
      and a.content->>'audio_path' = p_name
      and app.can_see_group(h.group_id));
$$;

-- An audio file nobody's assignment uses yet (a preview that was replaced).
create function app.audio_unused(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.assignments a
                     where a.center_id = app.audio_center(p_name) and a.content->>'audio_path' = p_name);
$$;

revoke execute on function app.audio_center(text), app.can_make_audio(text), app.can_hear_audio(text), app.audio_unused(text) from public, anon;
grant execute on function app.audio_center(text), app.can_make_audio(text), app.can_hear_audio(text), app.audio_unused(text) to authenticated;

create policy listening_audio_select on storage.objects for select to authenticated
  using (bucket_id = 'listening-audio' and app.can_hear_audio(name));
create policy listening_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'listening-audio' and app.can_make_audio(name));
-- Only the uploader may remove a file, and only while no assignment uses it.
create policy listening_audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'listening-audio' and owner = auth.uid() and app.can_make_audio(name) and app.audio_unused(name));

-- AI usage now includes audio generation.
alter table public.ai_requests drop constraint ai_requests_kind_check;
alter table public.ai_requests add constraint ai_requests_kind_check check (kind in ('generate', 'extract', 'audio'));

-- The transcript lives with the key.
alter table public.assignment_keys add column transcript text;

-- create_custom_assignment gains p_audio_path. With audio, p_passage is
-- the transcript and goes to the key instead of the student-visible content.
drop function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb, jsonb, text);

create function public.create_custom_assignment(
  p_center     uuid,
  p_title      text,
  p_skill      public.skill,
  p_level      public.cefr_level,
  p_source     public.assignment_source,
  p_passage    text,
  p_questions  jsonb,
  p_answers    jsonb,
  p_groups     jsonb default '[]',
  p_audio_url  text default null,
  p_audio_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid; v_staff boolean := app.is_staff(p_center);
        v_passage text := nullif(btrim(coalesce(p_passage, '')), '');
begin
  if not (v_staff or app.has_role(p_center, '{mentor}')) then perform app.forbid(); end if;
  if p_source not in ('upload','ai') then raise exception 'unsupported source'; end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then raise exception 'Give the assignment a title.'; end if;
  if length(p_title) > 200 then raise exception 'Keep the title under 200 characters.'; end if;
  if length(coalesce(p_passage, '')) > 30000 then raise exception 'The passage is too long (30,000 characters at most).'; end if;
  if p_audio_url is not null and p_audio_url !~ '^https://' then raise exception 'The audio link must be https.'; end if;
  if p_audio_path is not null then
    if p_audio_url is not null then raise exception 'Use either an audio link or generated audio, not both.'; end if;
    if app.audio_center(p_audio_path) is distinct from p_center
       or not exists (select 1 from storage.objects where bucket_id = 'listening-audio' and name = p_audio_path) then
      raise exception 'The audio file was not found. Generate the audio again.';
    end if;
    if exists (select 1 from public.assignments where center_id = p_center and content->>'audio_path' = p_audio_path) then
      raise exception 'That audio is already used by another assignment. Generate the audio again.';
    end if;
  end if;
  perform app.check_questions(p_questions, p_answers, coalesce(p_groups, '[]'));
  v_me := app.my_staff_membership(p_center);

  insert into public.assignments (center_id, title, skill, level, source, content, status, created_by, approved_by, approved_at)
  values (p_center, btrim(p_title), p_skill, p_level, p_source,
          jsonb_strip_nulls(jsonb_build_object(
            'passage', case when p_audio_path is null then v_passage end,
            'audio_url', p_audio_url,
            'audio_path', p_audio_path,
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

  insert into public.assignment_keys (assignment_id, center_id, answers, transcript)
  values (v_id, p_center, coalesce(p_answers, '{}'), case when p_audio_path is not null then v_passage end);
  return v_id;
end $$;

revoke execute on function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb, jsonb, text, text) to authenticated;

-- my_homework_result also returns the transcript once the work is in.
create or replace function public.my_homework_result(p_homework uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_h public.homework; v_s public.submissions; v_q jsonb; v_k jsonb; v_t text;
begin
  select * into v_h from public.homework where id = p_homework;
  if v_h.id is null then perform app.forbid(); end if;
  select sub.* into v_s from public.submissions sub
  join public.students st on st.id = sub.student_id
  join public.memberships m on m.id = st.membership_id
  where sub.homework_id = p_homework and m.user_id = auth.uid() and m.status = 'active';
  if v_s.id is null or v_s.status not in ('submitted','reviewed') then return null; end if;

  select a.content->'questions', coalesce(k.answers, '{}'::jsonb), k.transcript into v_q, v_k, v_t
  from public.assignments a
  left join public.assignment_keys k on k.assignment_id = a.id
  where a.id = v_h.assignment_id;

  return jsonb_build_object(
    'status', v_s.status, 'score', v_s.score, 'feedback', v_s.feedback, 'answers', v_s.answers,
    'key', v_k, 'marks', app.mark_map(v_q, v_k, v_s.answers))
    || case when v_t is not null then jsonb_build_object('transcript', v_t) else '{}'::jsonb end;
end $$;
