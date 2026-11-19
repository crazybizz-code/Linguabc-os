-- =====================================================================
-- Listening audio (Fish Audio), kept in private Supabase Storage.
--
-- A listening assignment has one listening set: the script students hear
-- and, once generated, one audio file in the private bucket
-- "listening-audio" at
--   centres/<center_id>/generated/<listening_set_id>/<content-hash>.mp3
-- The database keeps the stable object path and its metadata, never a
-- signed URL. The server signs a short-lived URL for each playback after
-- listening_audio_path() has checked that the caller may see the work.
--
-- The script is the transcript. Students can't read listening_sets at all;
-- they get the transcript from my_homework_result() after they submit.
--
-- Audio is generated once: begin_listening_audio() locks the set, the
-- server calls Fish Audio, validates and uploads the file, and
-- finish_listening_audio() records it after checking the object exists at
-- the expected path. Playback never generates.
-- =====================================================================

-- ------------------------------------------------------------- bucket
-- Private: no public URLs, and no storage.objects policies for anon or
-- authenticated, so the Storage API refuses every list, read and upload
-- except the server's own (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listening-audio', 'listening-audio', false, 20971520, '{audio/mpeg}')
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------- table
create table public.listening_sets (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references public.centers(id) on delete cascade,
  assignment_id   uuid not null,
  script          text not null check (length(btrim(script)) between 20 and 6000),
  status          text not null default 'draft' check (status in ('draft','generating','ready','failed')),
  pending_hash    text check (pending_hash ~ '^[0-9a-f]{64}$'),
  started_at      timestamptz,
  audio_path      text,
  audio_hash      text check (audio_hash ~ '^[0-9a-f]{64}$'),
  audio_bytes     int check (audio_bytes > 0),
  duration_ms     int check (duration_ms > 0),
  model           text,
  voices          text[] not null default '{}',
  error           text check (length(error) <= 300),
  generated_by    uuid,
  generated_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, center_id),
  unique (assignment_id),
  foreign key (assignment_id, center_id) references public.assignments(id, center_id) on delete cascade,
  foreign key (generated_by, center_id)  references public.memberships(id, center_id),
  check ((status = 'ready') <= (audio_path is not null)),
  check ((audio_path is null) = (audio_hash is null))
);
create trigger listening_sets_updated_at before update on public.listening_sets
  for each row execute function app.set_updated_at();

alter table public.listening_sets enable row level security;
-- Staff and mentors of the centre read it (the script is the transcript).
-- Every write goes through the functions below.
create policy listening_sets_select on public.listening_sets for select to authenticated
  using (app.is_staff(center_id) or app.has_role(center_id, '{mentor}'));
revoke all on public.listening_sets from anon;
revoke insert, update, delete on public.listening_sets from authenticated;
grant select on public.listening_sets to authenticated;

-- Who may (re)generate a set's audio: staff, or the mentor who wrote the
-- assignment while it is still theirs to edit (mirrors assignments_update).
create function app.can_edit_listening(p_set public.listening_sets)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_staff(p_set.center_id)
      or exists (select 1 from public.assignments a
                 join public.memberships m on m.id = a.created_by
                 where a.id = p_set.assignment_id and m.user_id = auth.uid() and m.status = 'active'
                   and m.role = 'mentor' and a.status in ('draft','pending_approval','approved'));
$$;

-- ------------------------------------------------------------- create
-- create_custom_assignment, now taking the listening script. A listening
-- assignment keeps its script out of the content students can read.
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
  p_audio_url text default null,
  p_script    text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid; v_staff boolean := app.is_staff(p_center); v_script text := nullif(btrim(coalesce(p_script, '')), '');
begin
  if not (v_staff or app.has_role(p_center, '{mentor}')) then perform app.forbid(); end if;
  if p_source not in ('upload','ai') then raise exception 'unsupported source'; end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then raise exception 'Give the assignment a title.'; end if;
  if length(p_title) > 200 then raise exception 'Keep the title under 200 characters.'; end if;
  if length(coalesce(p_passage, '')) > 30000 then raise exception 'The passage is too long (30,000 characters at most).'; end if;
  if p_audio_url is not null and p_audio_url !~ '^https://' then raise exception 'The audio link must be https.'; end if;
  if v_script is not null and p_skill <> 'listening' then raise exception 'Only listening assignments have an audio script.'; end if;
  if v_script is not null and length(v_script) < 20 then raise exception 'The audio script is too short.'; end if;
  if v_script is not null and length(v_script) > 6000 then raise exception 'Keep the audio script under 6,000 characters (about 6 minutes of audio).'; end if;
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

  if v_script is not null then
    insert into public.listening_sets (center_id, assignment_id, script) values (p_center, v_id, v_script);
  end if;
  return v_id;
end $$;

drop function if exists public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb, jsonb, text);

-- ------------------------------------------------------------- generation
-- Lock a set for generation. p_hash identifies what will be generated
-- (script, model, voices, audio settings). If audio for exactly that is
-- already stored, nothing is generated again ("skip").
create function public.begin_listening_audio(p_set uuid, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.listening_sets;
begin
  select * into v from public.listening_sets where id = p_set for update;
  if v.id is null or not app.can_edit_listening(v) then perform app.forbid(); end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid audio hash'; end if;
  if v.audio_hash = p_hash and v.status in ('ready','failed') then
    update public.listening_sets set status = 'ready', error = null where id = p_set;
    return jsonb_build_object('skip', true, 'path', v.audio_path);
  end if;
  if v.status = 'generating' and v.started_at > now() - interval '10 minutes' then
    raise exception 'The audio is already being generated. Wait a minute and refresh.';
  end if;
  update public.listening_sets
     set status = 'generating', pending_hash = p_hash, started_at = now(), error = null
   where id = p_set;
  return jsonb_build_object('skip', false, 'center_id', v.center_id, 'script', v.script,
    'path', 'centres/' || v.center_id || '/generated/' || v.id || '/' || p_hash || '.mp3');
end $$;

-- Record the uploaded file. The path must be the one begin_listening_audio
-- handed out, and the object must exist in the bucket. Returns the path of
-- the audio it replaces, if any, so the server can delete that file.
create function public.finish_listening_audio(
  p_set uuid, p_path text, p_bytes int, p_duration_ms int, p_model text, p_voices text[])
returns text language plpgsql security definer set search_path = '' as $$
declare v public.listening_sets; v_old text;
begin
  select * into v from public.listening_sets where id = p_set for update;
  if v.id is null or not app.can_edit_listening(v) then perform app.forbid(); end if;
  if v.status <> 'generating' then raise exception 'This audio is not being generated.'; end if;
  if p_path is distinct from 'centres/' || v.center_id || '/generated/' || v.id || '/' || v.pending_hash || '.mp3' then
    raise exception 'unexpected audio path';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'listening-audio' and o.name = p_path) then
    raise exception 'The audio file was not stored.';
  end if;
  if coalesce(p_bytes, 0) <= 0 or p_bytes > 20971520 then raise exception 'invalid audio size'; end if;
  if coalesce(p_duration_ms, 0) < 1000 or p_duration_ms > 20 * 60 * 1000 then raise exception 'invalid audio duration'; end if;

  v_old := case when v.audio_path is distinct from p_path then v.audio_path end;
  update public.listening_sets
     set status = 'ready', audio_path = p_path, audio_hash = v.pending_hash, pending_hash = null, started_at = null,
         audio_bytes = p_bytes, duration_ms = p_duration_ms, model = left(p_model, 100),
         voices = coalesce(p_voices[1:8], '{}'), error = null,
         generated_by = app.my_staff_membership(v.center_id), generated_at = now()
   where id = p_set;
  return v_old;
end $$;

-- A failed attempt keeps any earlier audio playable.
create function public.fail_listening_audio(p_set uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.listening_sets;
begin
  select * into v from public.listening_sets where id = p_set for update;
  if v.id is null or not app.can_edit_listening(v) then perform app.forbid(); end if;
  if v.status <> 'generating' then return; end if;
  update public.listening_sets
     set status = case when audio_path is not null then 'ready' else 'failed' end,
         pending_hash = null, started_at = null, error = left(coalesce(p_error, 'Generation failed.'), 300)
   where id = p_set;
end $$;

-- ------------------------------------------------------------- playback
-- The stored path of an assignment's audio, for whoever may read the
-- assignment itself (same rule as assignments_select). The server signs a
-- short-lived URL for it; the path alone opens nothing.
create function public.listening_audio_path(p_assignment uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_a public.assignments; v_path text;
begin
  select * into v_a from public.assignments where id = p_assignment;
  if v_a.id is null then perform app.forbid(); end if;
  if not (app.is_staff(v_a.center_id) or app.has_role(v_a.center_id, '{mentor}')
          or exists (select 1 from public.homework h where h.assignment_id = v_a.id and app.can_see_group(h.group_id))) then
    perform app.forbid();
  end if;
  select audio_path into v_path from public.listening_sets
   where assignment_id = p_assignment and status = 'ready';
  return v_path;
end $$;

-- ------------------------------------------------------------- assign
-- Listening work with a script can't be set before its audio is ready.
create or replace function public.assign_assignment(p_assignment uuid, p_group uuid, p_due_at timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_hw uuid;
begin
  if exists (select 1 from public.listening_sets where assignment_id = p_assignment and audio_path is null) then
    raise exception 'Generate the audio before setting this listening work.';
  end if;
  v_hw := public.assign_homework(p_assignment, p_group, p_due_at);
  if length(coalesce(p_note, '')) > 2000 then raise exception 'Keep the note under 2000 characters.'; end if;
  update public.homework set note = nullif(trim(p_note), '') where id = v_hw;
  return v_hw;
end $$;

-- ------------------------------------------------------------- result
-- my_homework_result, now with the listening transcript after submission.
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

  select a.content->'questions', coalesce(k.answers, '{}'::jsonb) into v_q, v_k
  from public.assignments a
  left join public.assignment_keys k on k.assignment_id = a.id
  where a.id = v_h.assignment_id;
  select script into v_t from public.listening_sets where assignment_id = v_h.assignment_id;

  return jsonb_build_object(
    'status', v_s.status, 'score', v_s.score, 'feedback', v_s.feedback, 'answers', v_s.answers,
    'key', v_k, 'marks', app.mark_map(v_q, v_k, v_s.answers))
    || case when v_t is not null then jsonb_build_object('transcript', v_t) else '{}'::jsonb end;
end $$;

-- ------------------------------------------------------------- AI limits
-- Audio is a new kind of AI request, with its own, tighter limits on top
-- of the general AI limits.
alter table public.ai_requests drop constraint ai_requests_kind_check;
alter table public.ai_requests add constraint ai_requests_kind_check check (kind in ('generate','extract','tts'));

create or replace function public.claim_ai_request(p_center uuid, p_kind text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not (app.is_staff(p_center) or app.has_role(p_center, '{mentor}')) then perform app.forbid(); end if;
  if (select count(*) from public.ai_requests where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'AI limit reached: 20 requests per hour. Try again a little later.';
  end if;
  if (select count(*) from public.ai_requests where center_id = p_center and created_at > now() - interval '1 day') >= 200 then
    raise exception 'AI limit reached for your centre today (200 requests).';
  end if;
  if p_kind = 'tts' then
    if (select count(*) from public.ai_requests where user_id = auth.uid() and kind = 'tts' and created_at > now() - interval '1 hour') >= 10 then
      raise exception 'AI limit reached: 10 audio generations per hour. Try again a little later.';
    end if;
    if (select count(*) from public.ai_requests where center_id = p_center and kind = 'tts' and created_at > now() - interval '1 day') >= 30 then
      raise exception 'AI limit reached for your centre today (30 audio generations).';
    end if;
  end if;
  insert into public.ai_requests (center_id, user_id, kind) values (p_center, auth.uid(), p_kind) returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------- grants
revoke execute on function app.can_edit_listening(public.listening_sets) from public, anon;
revoke execute on function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb, jsonb, text, text) from public, anon;
revoke execute on function public.begin_listening_audio(uuid, text) from public, anon;
revoke execute on function public.finish_listening_audio(uuid, text, int, int, text, text[]) from public, anon;
revoke execute on function public.fail_listening_audio(uuid, text) from public, anon;
revoke execute on function public.listening_audio_path(uuid) from public, anon;
grant execute on function public.create_custom_assignment(uuid, text, public.skill, public.cefr_level, public.assignment_source, text, jsonb, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.begin_listening_audio(uuid, text) to authenticated;
grant execute on function public.finish_listening_audio(uuid, text, int, int, text, text[]) to authenticated;
grant execute on function public.fail_listening_audio(uuid, text) to authenticated;
grant execute on function public.listening_audio_path(uuid) to authenticated;
