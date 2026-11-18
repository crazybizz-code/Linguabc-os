-- =====================================================================
-- LinguABC library and answer keys.
--
-- The library is shared by every centre: curated articles and podcasts,
-- each with its own comprehension questions. It is read-only for centres
-- (only the service role writes it) and students may read the material
-- itself, because they study it when it is set as homework.
--
-- Correct answers never sit next to the questions. They live in separate
-- key tables that only staff and mentors can read, so a student who calls
-- the API directly sees the questions but not the answers.
-- =====================================================================

create table public.library_items (
  id               text primary key,                 -- stable id from the legacy content store
  kind             text not null check (kind in ('article','podcast')),
  title            text not null,
  description      text,
  level_min        public.cefr_level,
  level_max        public.cefr_level,
  topics           text[] not null default '{}',
  skill            public.skill not null,
  minutes          int check (minutes > 0),
  body_html        text,                              -- articles: republished HTML or plain text
  body_format      text not null default 'text' check (body_format in ('text','html')),
  audio_url        text,                              -- podcasts
  duration_seconds int,
  transcript       jsonb,
  summary          text,
  vocabulary       jsonb not null default '[]',
  questions        jsonb not null default '[]',       -- [{id, type, prompt, options}] — no answers
  discussion       jsonb not null default '[]',
  source_name      text,
  source_url       text,
  author           text,
  licence          text,
  attribution      text,
  status           text not null default 'published' check (status in ('published','hidden')),
  created_at       timestamptz not null default now()
);
create index library_items_browse_idx on public.library_items (status, kind, level_min);

create table public.library_answer_keys (
  item_id text primary key references public.library_items(id) on delete cascade,
  answers jsonb not null default '{}'                 -- {question_id: {answer, explanation}}
);

-- Answer key for a centre's assignment (copied from the library, or written
-- by staff for their own material).
create table public.assignment_keys (
  assignment_id uuid primary key,
  center_id     uuid not null,
  answers       jsonb not null default '{}',
  foreign key (assignment_id, center_id) references public.assignments(id, center_id) on delete cascade
);

-- A mentor's note for this particular setting of the work.
alter table public.homework add column note text check (length(note) <= 2000);

-- One copy of a library item per centre.
create unique index assignments_library_item_uidx
  on public.assignments (center_id, library_item_id) where library_item_id is not null;

alter table public.library_items       enable row level security;
alter table public.library_answer_keys enable row level security;
alter table public.assignment_keys     enable row level security;

-- Anyone working in any centre (staff or mentor).
create function app.is_any_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.user_id = auth.uid() and m.status = 'active'
                   and m.role in ('owner','admin','academic_manager','mentor'));
$$;

create policy library_items_select on public.library_items for select to authenticated
  using (status = 'published');
create policy library_answer_keys_select on public.library_answer_keys for select to authenticated
  using (app.is_any_staff());
create policy assignment_keys_select on public.assignment_keys for select to authenticated
  using (app.is_staff(center_id) or app.has_role(center_id, '{mentor}'));
create policy assignment_keys_write on public.assignment_keys for all to authenticated
  using (app.is_staff(center_id) or app.has_role(center_id, '{mentor}'))
  with check (app.is_staff(center_id) or app.has_role(center_id, '{mentor}'));

revoke all on public.library_items, public.library_answer_keys, public.assignment_keys from anon;
grant select on public.library_items, public.library_answer_keys to authenticated;
grant select, insert, update, delete on public.assignment_keys to authenticated;

-- Set a library item as homework for a group. Library content is curated,
-- so it needs no approval; the centre's copy is created once and reused.
create function public.assign_library_item(
  p_center       uuid,
  p_item         text,
  p_group        uuid,
  p_due_at       timestamptz,
  p_instructions text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_item public.library_items; v_assignment uuid; v_me uuid; v_hw uuid;
begin
  if not (app.is_staff(p_center)
          or (app.is_mentor_of_group(p_group)
              and exists (select 1 from public.groups where id = p_group and center_id = p_center))) then
    perform app.forbid();
  end if;
  select * into v_item from public.library_items where id = p_item and status = 'published';
  if v_item.id is null then raise exception 'Library item not found.'; end if;
  if jsonb_array_length(v_item.questions) = 0 then raise exception 'This item has no questions yet.'; end if;
  v_me := app.my_staff_membership(p_center);

  select id into v_assignment from public.assignments
  where center_id = p_center and library_item_id = p_item;

  if v_assignment is null then
    insert into public.assignments (center_id, title, skill, level, source, library_item_id, content,
                                    status, created_by, approved_by, approved_at)
    values (p_center, v_item.title, v_item.skill, v_item.level_min, 'library', v_item.id,
            jsonb_build_object('questions', v_item.questions),
            'approved', v_me, v_me, now())
    returning id into v_assignment;
    insert into public.assignment_keys (assignment_id, center_id, answers)
    select v_assignment, p_center, k.answers from public.library_answer_keys k where k.item_id = v_item.id;
  end if;

  v_hw := public.assign_homework(v_assignment, p_group, p_due_at);
  update public.homework set note = nullif(trim(p_instructions), '') where id = v_hw;
  return v_hw;
end $$;

revoke execute on function public.assign_library_item(uuid, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.assign_library_item(uuid, text, uuid, timestamptz, text) to authenticated;
