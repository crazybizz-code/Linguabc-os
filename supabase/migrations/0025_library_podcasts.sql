-- 0025: LinguABC's own podcasts (owner, 2026-11-20).
--
-- The library should hold as many podcasts as articles, at every level from
-- A1 to C2. Platform admins write them at /admin/podcasts: the AI drafts a
-- script with questions and vocabulary, Fish Audio records it, the admin
-- checks and publishes.
--
-- Podcasts are learning material, not exam content, so their recordings live
-- in a public bucket and play through a plain link, like the VOA podcasts
-- already in the library. Only platform admins can upload or remove them.

alter table public.library_items drop constraint library_items_status_check;
alter table public.library_items add constraint library_items_status_check check (status in ('draft','published','hidden'));
alter table public.library_items
  add column audio_path text,
  add column created_by uuid references auth.users(id) on delete set null,
  add column updated_at timestamptz;

-- Drafts and their keys are seen only by platform admins.
drop policy library_items_select on public.library_items;
create policy library_items_select on public.library_items for select to authenticated
  using (status = 'published' or app.is_platform_admin());
drop policy library_answer_keys_select on public.library_answer_keys;
create policy library_answer_keys_select on public.library_answer_keys for select to authenticated
  using (app.is_platform_admin()
         or (app.is_any_staff() and exists (select 1 from public.library_items i where i.id = item_id and i.status = 'published')));

-- ---------------------------------------------------------------------
-- Recordings
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('library-podcasts', 'library-podcasts', true, 31457280, array['audio/mpeg'])
on conflict (id) do nothing;

create function app.podcast_audio_ok(p_name text)
returns boolean language sql immutable set search_path = '' as $$
  select p_name ~ '^podcasts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3$';
$$;
create function app.podcast_audio_used(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.library_items where audio_path = p_name);
$$;
revoke execute on function app.podcast_audio_ok(text), app.podcast_audio_used(text) from public, anon;
grant execute on function app.podcast_audio_ok(text), app.podcast_audio_used(text) to authenticated;

create policy library_podcasts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'library-podcasts' and app.is_platform_admin() and app.podcast_audio_ok(name));
create policy library_podcasts_select on storage.objects for select to authenticated
  using (bucket_id = 'library-podcasts' and app.is_platform_admin());
-- A replaced recording can be removed once no podcast points to it.
create policy library_podcasts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'library-podcasts' and app.is_platform_admin() and not app.podcast_audio_used(name));

-- ---------------------------------------------------------------------
-- Writing podcasts (platform admins only)
-- ---------------------------------------------------------------------

-- Saves a draft podcast (new when p_id is null) and its answer key.
-- p_transcript: [{speaker, text}]; p_questions as stored (q1.., no answers).
create function public.save_library_podcast(
  p_id          text,
  p_title       text,
  p_description text,
  p_level_min   public.cefr_level,
  p_level_max   public.cefr_level,
  p_topics      text[],
  p_transcript  jsonb,
  p_questions   jsonb,
  p_answers     jsonb,
  p_vocabulary  jsonb,
  p_audio_path  text,
  p_audio_url   text,
  p_seconds     int)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id text := p_id; v_status text;
begin
  if not app.is_platform_admin() then perform app.forbid(); end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then raise exception 'Give the podcast a title.'; end if;
  if p_level_min is null or p_level_max is null or p_level_max < p_level_min then raise exception 'Choose the levels.'; end if;
  if jsonb_typeof(p_transcript) <> 'array' or jsonb_typeof(p_questions) <> 'array' or jsonb_typeof(p_answers) <> 'object'
     or jsonb_typeof(p_vocabulary) <> 'array' then raise exception 'The podcast is malformed.'; end if;
  if length(p_transcript::text) > 60000 or length(p_questions::text) > 60000 or length(p_answers::text) > 60000
     or length(p_vocabulary::text) > 20000 then raise exception 'The podcast is too long.'; end if;
  if exists (select 1 from jsonb_array_elements(p_questions) q where q->>'type' not in ('mc','multi','tfng','gap')) then
    raise exception 'Podcasts use multiple choice, true/false/not given and gap questions only.';
  end if;
  if p_audio_path is not null then
    if not app.podcast_audio_ok(p_audio_path)
       or not exists (select 1 from storage.objects where bucket_id = 'library-podcasts' and name = p_audio_path) then
      raise exception 'The recording was not found.';
    end if;
    if p_audio_url is null or p_audio_url !~ '^https://' or right(p_audio_url, length('/library-podcasts/' || p_audio_path)) <> '/library-podcasts/' || p_audio_path then
      raise exception 'The recording link does not match the recording.';
    end if;
  end if;

  if v_id is null then
    v_id := 'podcast-lg-' || encode(extensions.gen_random_bytes(8), 'hex');
    insert into public.library_items (id, kind, title, description, level_min, level_max, topics, skill, status, created_by,
                                      source_name, licence, questions, transcript, vocabulary)
    values (v_id, 'podcast', btrim(p_title), '', p_level_min, p_level_max, '{}', 'listening', 'draft', auth.uid(),
            'LinguABC', 'LinguABC original', '[]', '[]', '[]');
  else
    select status into v_status from public.library_items where id = v_id and kind = 'podcast' for update;
    if v_status is null then raise exception 'Podcast not found.'; end if;
    if v_status = 'published' then raise exception 'Unpublish the podcast to edit it.'; end if;
  end if;

  update public.library_items set
    title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''),
    level_min = p_level_min, level_max = p_level_max,
    topics = coalesce((select array_agg(distinct lower(btrim(t))) from unnest(p_topics) t where btrim(t) <> ''), '{}'),
    transcript = p_transcript, questions = p_questions, vocabulary = p_vocabulary,
    audio_path = p_audio_path, audio_url = case when p_audio_path is null then null else p_audio_url end,
    duration_seconds = case when p_audio_path is null then null else nullif(p_seconds, 0) end,
    minutes = case when p_audio_path is null or coalesce(p_seconds, 0) <= 0 then null else greatest(1, ceil(p_seconds / 60.0)::int) end,
    updated_at = now()
  where id = v_id;

  insert into public.library_answer_keys (item_id, answers) values (v_id, p_answers)
  on conflict (item_id) do update set answers = excluded.answers;
  return v_id;
end $$;

create function public.set_library_podcast_status(p_id text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.library_items;
begin
  if not app.is_platform_admin() then perform app.forbid(); end if;
  if p_status not in ('draft','published','hidden') then raise exception 'Unknown status.'; end if;
  select * into v from public.library_items where id = p_id and kind = 'podcast' for update;
  if v.id is null then raise exception 'Podcast not found.'; end if;
  if p_status = 'published' then
    if v.audio_url is null then raise exception 'Record the podcast before publishing.'; end if;
    if jsonb_array_length(v.questions) < 3 then raise exception 'A podcast needs at least 3 questions.'; end if;
  end if;
  update public.library_items set status = p_status, updated_at = now() where id = p_id;
end $$;

-- Only drafts nobody has set as homework can be deleted.
create function public.delete_library_podcast(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.forbid(); end if;
  if exists (select 1 from public.assignments where library_item_id = p_id) then raise exception 'This podcast was set as homework; hide it instead.'; end if;
  delete from public.library_items where id = p_id and kind = 'podcast' and status = 'draft';
  if not found then raise exception 'Only draft podcasts can be deleted.'; end if;
end $$;

revoke execute on function public.save_library_podcast(text, text, text, public.cefr_level, public.cefr_level, text[], jsonb, jsonb, jsonb, jsonb, text, text, int),
  public.set_library_podcast_status(text, text), public.delete_library_podcast(text) from public, anon;
grant execute on function public.save_library_podcast(text, text, text, public.cefr_level, public.cefr_level, text[], jsonb, jsonb, jsonb, jsonb, text, text, int),
  public.set_library_podcast_status(text, text), public.delete_library_podcast(text) to authenticated;
