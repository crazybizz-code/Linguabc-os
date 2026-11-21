-- =====================================================================
-- 0029: audio segment cache.
--
-- A listening script is spoken one turn (segment) at a time. Each spoken
-- segment is kept, so the same words in the same voice are never paid for
-- twice: re-recording after one line changed only speaks that line, and a
-- recording that failed half-way keeps the turns it already has.
--
--   * A segment is identified by a SHA-256 hash made on the server from the
--     provider, model, voice, expression, exact text, generation settings
--     and scope (src/lib/ai/segment-cache.ts). The database treats it as
--     opaque.
--   * Scope is a centre (center_id) or the LinguABC library (center_id is
--     null, platform admins only). The same hash in two scopes is two rows,
--     and nobody can read or claim another scope's segment.
--   * Files live in the private audio-segments bucket at
--     {center_id | platform}/{hash}.mp3. They are never shown to students:
--     the joined recording is saved to the existing buckets as before.
--   * claim_audio_segment hands out each missing segment to one caller at a
--     time, so two requests for the same script do not both pay for it.
--     A claim older than 3 minutes (a crashed request) can be taken over.
--   * Cached files are immutable: no update or delete policy.
-- =====================================================================

create table public.audio_segments (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid references public.centers(id) on delete cascade, -- null: LinguABC library
  hash        text not null check (hash ~ '^[0-9a-f]{64}$'),
  provider    text not null check (provider in ('fish', 'qwen', 'kokoro')),
  model       text not null check (length(model) between 1 and 80),
  voice       text not null default '' check (length(voice) <= 80),
  text_bytes  int  not null check (text_bytes between 0 and 100000),
  status      text not null default 'pending' check (status in ('pending', 'ready')),
  path        text,
  audio_bytes int check (audio_bytes >= 0),
  hits        int not null default 0,
  claimed_by  uuid references auth.users(id) on delete set null,
  claimed_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  ready_at    timestamptz,
  last_used_at timestamptz,
  unique nulls not distinct (center_id, hash),
  check ((status = 'ready') = (path is not null))
);
create index audio_segments_center_idx on public.audio_segments (center_id);
create index audio_segments_claimed_by_idx on public.audio_segments (claimed_by);

-- The folder a scope's files go in.
create function app.segment_scope(p_center uuid)
returns text language sql immutable set search_path = '' as $$
  select coalesce(p_center::text, 'platform');
$$;

-- Who may make and reuse audio in a scope: staff and mentors of the centre,
-- or platform admins for the library.
create function app.can_use_segments(p_center uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_center is null then app.is_platform_admin()
              else app.is_staff(p_center) or app.has_role(p_center, '{mentor}') end;
$$;

-- The scope of an audio-segments object from its path ('platform' -> null),
-- and whether the path is well formed at all.
create function app.segment_path_ok(p_name text)
returns boolean language sql immutable set search_path = '' as $$
  select p_name ~ '^(platform|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[0-9a-f]{64}\.mp3$';
$$;
create function app.segment_path_center(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when app.segment_path_ok(p_name) and split_part(p_name, '/', 1) <> 'platform'
              then split_part(p_name, '/', 1)::uuid end;
$$;

create function app.can_read_segment_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.segment_path_ok(p_name) and app.can_use_segments(app.segment_path_center(p_name));
$$;

-- Upload only the file for a segment this user has claimed and not finished.
create function app.can_write_segment_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.segment_path_ok(p_name)
     and app.can_use_segments(app.segment_path_center(p_name))
     and exists (
       select 1 from public.audio_segments s
       where s.center_id is not distinct from app.segment_path_center(p_name)
         and s.hash = split_part(split_part(p_name, '/', 2), '.', 1)
         and s.status = 'pending'
         and s.claimed_by = auth.uid());
$$;

revoke execute on function app.segment_scope(uuid), app.can_use_segments(uuid), app.segment_path_ok(text),
  app.segment_path_center(text), app.can_read_segment_file(text), app.can_write_segment_file(text) from public, anon;
grant execute on function app.segment_scope(uuid), app.can_use_segments(uuid), app.segment_path_ok(text),
  app.segment_path_center(text), app.can_read_segment_file(text), app.can_write_segment_file(text) to authenticated;

alter table public.audio_segments enable row level security;
create policy audio_segments_select on public.audio_segments for select to authenticated
  using (app.can_use_segments(center_id));
revoke all on public.audio_segments from anon, authenticated;
grant select on public.audio_segments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio-segments', 'audio-segments', false, 5242880, array['audio/mpeg'])
on conflict (id) do nothing;

create policy audio_segments_file_select on storage.objects for select to authenticated
  using (bucket_id = 'audio-segments' and app.can_read_segment_file(name));
create policy audio_segments_file_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'audio-segments' and app.can_write_segment_file(name));

-- Look a segment up, or claim it for generation.
-- Returns {"state":"ready","path":...}  - reuse the file (counted as a hit);
--         {"state":"generate","path":...} - speak it, upload to path, then finish;
--         {"state":"wait"}               - someone else is speaking it right now.
create function public.claim_audio_segment(
  p_center uuid, p_hash text, p_provider text, p_model text, p_voice text, p_text_bytes int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.audio_segments;
  v_path text := app.segment_scope(p_center) || '/' || p_hash || '.mp3';
begin
  if auth.uid() is null or not app.can_use_segments(p_center) then raise exception 'forbidden'; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'bad segment hash'; end if;

  insert into public.audio_segments (center_id, hash, provider, model, voice, text_bytes, claimed_by)
  values (p_center, p_hash, p_provider, p_model, coalesce(p_voice, ''), p_text_bytes, auth.uid())
  on conflict (center_id, hash) do nothing
  returning * into v;
  if found then return jsonb_build_object('state', 'generate', 'path', v_path); end if;

  select * into v from public.audio_segments
  where center_id is not distinct from p_center and hash = p_hash
  for update;

  if v.status = 'ready' then
    update public.audio_segments set hits = hits + 1, last_used_at = now() where id = v.id;
    return jsonb_build_object('state', 'ready', 'path', v.path);
  end if;
  -- Even the same user waits: two tabs recording one script must not both pay.
  if v.claimed_at < now() - interval '3 minutes' then
    update public.audio_segments set claimed_by = auth.uid(), claimed_at = now() where id = v.id;
    return jsonb_build_object('state', 'generate', 'path', v_path);
  end if;
  return jsonb_build_object('state', 'wait');
end $$;

-- The claimed segment's file is uploaded: it may now be reused.
create function public.finish_audio_segment(p_center uuid, p_hash text, p_audio_bytes int)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_path text := app.segment_scope(p_center) || '/' || p_hash || '.mp3';
begin
  if auth.uid() is null or not app.can_use_segments(p_center) then raise exception 'forbidden'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'audio-segments' and name = v_path) then
    raise exception 'segment file not found';
  end if;
  update public.audio_segments
     set status = 'ready', path = v_path, audio_bytes = p_audio_bytes, ready_at = now(), last_used_at = now()
   where center_id is not distinct from p_center and hash = p_hash and status = 'pending' and claimed_by = auth.uid();
  if not found then
    if exists (select 1 from public.audio_segments where center_id is not distinct from p_center and hash = p_hash and status = 'ready') then
      return v_path;
    end if;
    raise exception 'segment not claimed';
  end if;
  return v_path;
end $$;

-- Speaking failed: let the next request try again at once.
create function public.release_audio_segment(p_center uuid, p_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app.can_use_segments(p_center) then raise exception 'forbidden'; end if;
  delete from public.audio_segments
  where center_id is not distinct from p_center and hash = p_hash and status = 'pending' and claimed_by = auth.uid();
end $$;

revoke execute on function public.claim_audio_segment(uuid, text, text, text, text, int),
  public.finish_audio_segment(uuid, text, int), public.release_audio_segment(uuid, text) from public, anon;
grant execute on function public.claim_audio_segment(uuid, text, text, text, text, int),
  public.finish_audio_segment(uuid, text, int), public.release_audio_segment(uuid, text) to authenticated;
