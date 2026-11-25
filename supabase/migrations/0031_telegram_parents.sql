-- 0031: Parent Telegram bot, foundation.
--
-- Parents use a Telegram bot instead of the web portal. This migration holds
-- everything the bot needs from the database; the webhook and the menus are
-- in the app (src/app/api/telegram/, src/lib/telegram/).
--
-- * Linking: an owner or admin issues a one-time link for a guardian
--   (`issue_telegram_link`). Only a SHA-256 hash of the token is stored. The
--   token is 192 random bits, lasts 24 hours and is used once. Issuing a new
--   one cancels the old. The parent opens t.me/<bot>?start=<token>, and the
--   server redeems it (`tg_redeem_link`, service role only).
-- * A parent with two children is ONE parent membership: the second guardian
--   row is attached to it (`attach_guardian_to_parent`), so every child
--   shows up in the bot. No phone-number or username matching, ever.
-- * Access: every bot read starts from the Telegram user id that Telegram
--   sent with the update and goes through `app.tg_can_see_student`:
--   active link -> parent membership (not suspended) -> guardians row ->
--   student, all in the same centre. A student id sent by the client is
--   never trusted on its own.
-- * Notifications: `app.notify` (0022) already writes one row per recipient
--   inside the same transaction as the change (attendance, payment, ...). A
--   trigger copies the parent-relevant kinds into `telegram_outbox`, so a
--   message is queued only if the change commits. The app sends the outbox
--   and retries with backoff; (notification, link) is unique, so a message
--   is never queued twice. A parent who blocks the bot is marked and skipped.
-- * Webhook deliveries: `tg_claim_update` / `tg_finish_update` handle each
--   update_id once, and a failed one is handed back to Telegram's retry.
-- * Delivery is at least once, never "exactly once": see tg_outbox_claim.
--
-- Rollback: drop the functions and the four tables below, and restore
-- app.notify from 0022. No existing row is changed by this migration.

-- ------------------------------------------------------------------ tables
create table public.telegram_link_tokens (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null,
  membership_id uuid not null,              -- the parent membership
  token_hash    bytea not null unique,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       bigint,                     -- Telegram user who redeemed it
  revoked_at    timestamptz,
  foreign key (membership_id, center_id) references public.memberships(id, center_id) on delete cascade,
  foreign key (created_by, center_id)    references public.memberships(id, center_id)
);
create index telegram_link_tokens_membership_idx on public.telegram_link_tokens (membership_id);

create table public.telegram_links (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null,
  membership_id    uuid not null,
  telegram_user_id bigint not null,
  chat_id          bigint not null,        -- private chat with the bot
  username         text,
  linked_at        timestamptz not null default now(),
  last_seen_at     timestamptz,
  blocked_at       timestamptz,            -- parent blocked the bot (403 from Telegram)
  revoked_at       timestamptz,
  revoked_by       uuid,
  unique (id, center_id),
  foreign key (membership_id, center_id) references public.memberships(id, center_id) on delete cascade,
  foreign key (revoked_by, center_id)    references public.memberships(id, center_id),
  check (chat_id > 0)                      -- private chats only, never groups
);
-- One live Telegram account per parent membership.
create unique index telegram_links_one_live on public.telegram_links (membership_id) where revoked_at is null;
create index telegram_links_user_idx on public.telegram_links (telegram_user_id) where revoked_at is null;

-- Webhook deliveries already handled (Telegram retries until it gets a 200).
create table public.telegram_updates (
  update_id   bigint primary key,
  status      text not null default 'processing' check (status in ('processing','done')),
  claim_id    uuid,
  received_at timestamptz not null default now(),
  claimed_at  timestamptz not null default now()
);

create table public.telegram_outbox (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  link_id         uuid not null,
  status          text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts        int not null default 0,
  claim_id        uuid,                    -- current send attempt (lease)
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (notification_id, link_id),
  foreign key (link_id, center_id) references public.telegram_links(id, center_id) on delete cascade
);
create index telegram_outbox_due_idx on public.telegram_outbox (next_attempt_at) where status in ('queued','sending');

alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_links       enable row level security;
alter table public.telegram_updates     enable row level security;
alter table public.telegram_outbox      enable row level security;
revoke all on public.telegram_link_tokens, public.telegram_links, public.telegram_updates, public.telegram_outbox from anon;
revoke all on public.telegram_link_tokens, public.telegram_updates, public.telegram_outbox from authenticated;
revoke insert, update, delete on public.telegram_links from authenticated;

-- Owner and admin see whether a parent has linked Telegram (Parents page).
-- Chat ids and tokens are not needed there; the page reads status columns.
create policy telegram_links_select on public.telegram_links for select to authenticated
  using (app.is_admin(center_id));

-- ----------------------------------------------------------------- helpers
create function app.tg_hash(p_token text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');
$$;

-- The live link of a Telegram user (one per centre at most in practice).
create function app.tg_live_memberships(p_tg_user bigint)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select l.membership_id
  from public.telegram_links l
  join public.memberships m on m.id = l.membership_id and m.center_id = l.center_id
  where l.telegram_user_id = p_tg_user and l.revoked_at is null
    and m.role = 'parent' and m.status <> 'suspended';
$$;

-- May this Telegram user see this student? The only gate for bot reads.
create function app.tg_can_see_student(p_tg_user bigint, p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_tg_user is not null and p_student is not null and exists (
    select 1
    from public.telegram_links l
    join public.memberships m on m.id = l.membership_id and m.center_id = l.center_id
    join public.guardians g on g.membership_id = m.id and g.center_id = m.center_id
    join public.students s on s.id = g.student_id and s.center_id = g.center_id
    where l.telegram_user_id = p_tg_user and l.revoked_at is null
      and m.role = 'parent' and m.status <> 'suspended'
      and s.id = p_student);
$$;

revoke execute on function app.tg_hash(text), app.tg_live_memberships(bigint),
  app.tg_can_see_student(bigint, uuid) from public, anon, authenticated;

-- app.notify (0022) skipped memberships that are not active. A parent who
-- only uses Telegram never signs in, so their membership stays 'invited';
-- they are now included while they have a live Telegram link.
create or replace function app.notify(p_center uuid, p_recipients uuid[], p_kind text, p_title text, p_body text, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (center_id, recipient_id, channel, status, title, body, data, sent_at)
  select p_center, m.id, 'in_app'::public.notification_channel, 'sent'::public.notification_status,
         p_title, p_body, coalesce(p_data, '{}') || jsonb_build_object('kind', p_kind), now()
  from public.memberships m
  where m.id = any(p_recipients) and m.center_id = p_center
    and (m.status = 'active'
         or (m.status = 'invited' and exists (
               select 1 from public.telegram_links l
               where l.membership_id = m.id and l.center_id = m.center_id and l.revoked_at is null)));
$$;
revoke execute on function app.notify(uuid, uuid[], text, text, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------- staff-side RPCs
-- Issue a one-time Telegram link for a guardian. Creates the parent
-- membership if the guardian has none yet (no web login is needed).
create function public.issue_telegram_link(p_guardian uuid)
returns table (token text, expires_at timestamptz, membership_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  g public.guardians%rowtype;
  v_member uuid;
  v_role public.member_role;
  v_status public.member_status;
  v_token text;
  v_exp timestamptz := now() + interval '24 hours';
begin
  select * into g from public.guardians where id = p_guardian;
  if g.id is null or not app.is_admin(g.center_id) then perform app.forbid(); end if;

  v_member := g.membership_id;
  if v_member is null then
    insert into public.memberships (center_id, role, status, full_name, phone, invited_by)
    values (g.center_id, 'parent', 'invited', g.full_name, g.phone, app.my_staff_membership(g.center_id))
    returning id into v_member;
    update public.guardians set membership_id = v_member where id = g.id;
  else
    select m.role, m.status into v_role, v_status from public.memberships m where m.id = v_member;
    if v_role <> 'parent' then raise exception 'this guardian is linked to a non-parent account'; end if;
    if v_status = 'suspended' then raise exception 'this parent account is suspended'; end if;
  end if;

  -- one valid token at a time
  update public.telegram_link_tokens t set revoked_at = now()
  where t.membership_id = v_member and t.used_at is null and t.revoked_at is null;

  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.telegram_link_tokens (center_id, membership_id, token_hash, created_by, expires_at)
  values (g.center_id, v_member, app.tg_hash(v_token), app.my_staff_membership(g.center_id), v_exp);

  return query select v_token, v_exp, v_member;
end $$;

-- Second (third, ...) child of a parent who is already set up: point the
-- guardian row at the existing parent membership.
create function public.attach_guardian_to_parent(p_guardian uuid, p_parent uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare g public.guardians%rowtype; v_center uuid; v_role public.member_role;
begin
  select * into g from public.guardians where id = p_guardian;
  select m.center_id, m.role into v_center, v_role from public.memberships m where m.id = p_parent;
  if g.id is null or v_center is null or not app.is_admin(g.center_id) then perform app.forbid(); end if;
  if v_center <> g.center_id then perform app.forbid(); end if;
  if v_role <> 'parent' then raise exception 'not a parent account'; end if;
  if g.membership_id is not null then raise exception 'this guardian already has an account'; end if;
  if exists (select 1 from public.guardians x where x.student_id = g.student_id and x.membership_id = p_parent) then
    raise exception 'this parent is already linked to the student';
  end if;
  update public.guardians set membership_id = p_parent where id = g.id;
end $$;

-- Disconnect a parent's Telegram: the link and any unused token stop working.
create function public.revoke_telegram_link(p_membership uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_center uuid; n int;
begin
  select center_id into v_center from public.memberships where id = p_membership;
  if v_center is null or not app.is_admin(v_center) then perform app.forbid(); end if;
  update public.telegram_links set revoked_at = now(), revoked_by = app.my_staff_membership(v_center)
  where membership_id = p_membership and revoked_at is null;
  get diagnostics n = row_count;
  update public.telegram_link_tokens set revoked_at = now()
  where membership_id = p_membership and used_at is null and revoked_at is null;
  update public.telegram_outbox o set status = 'skipped', last_error = 'link revoked'
  from public.telegram_links l
  where o.link_id = l.id and l.membership_id = p_membership and o.status in ('queued','sending');
  return n;
end $$;

revoke execute on function public.issue_telegram_link(uuid), public.attach_guardian_to_parent(uuid, uuid),
  public.revoke_telegram_link(uuid) from public, anon;
grant execute on function public.issue_telegram_link(uuid), public.attach_guardian_to_parent(uuid, uuid),
  public.revoke_telegram_link(uuid) to authenticated;

-- ----------------------------------------------- bot RPCs (service role)
-- Webhook updates, in two steps so a failure never loses one.
--
-- tg_claim_update(update_id) returns {state, claim}:
--   'claimed' -> handle it, then call tg_finish_update with this claim id;
--   'done'    -> handled before: answer 200;
--   'busy'    -> another request holds a fresh claim: answer 503, NOT 200,
--                so Telegram tries again later. If that request fails, the
--                update is still delivered; if it succeeds, the retry
--                finds 'done'.
-- A claim older than 90 seconds is taken over with a new claim id. The
-- webhook route runs at most 30 seconds (maxDuration), so a live request is
-- never overtaken.
--
-- tg_finish_update(update_id, claim, ok) returns true only if this claim
-- still holds the row: ok -> 'done' for good; not ok -> the claim is
-- released so the retry is handled. A stale claim (taken over) returns
-- false and changes nothing. The route answers 200 only when ok and true.
create function public.tg_claim_update(p_update_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_claim uuid := gen_random_uuid(); v_status text;
begin
  if p_update_id is null then raise exception 'update id required'; end if;
  insert into public.telegram_updates (update_id, claim_id) values (p_update_id, v_claim) on conflict do nothing;
  if found then return jsonb_build_object('state', 'claimed', 'claim', v_claim); end if;
  update public.telegram_updates set claimed_at = now(), claim_id = v_claim
  where update_id = p_update_id and status = 'processing' and claimed_at < now() - interval '90 seconds';
  if found then return jsonb_build_object('state', 'claimed', 'claim', v_claim); end if;
  select status into v_status from public.telegram_updates where update_id = p_update_id;
  return jsonb_build_object('state', case when v_status = 'done' then 'done' else 'busy' end);
end $$;

create function public.tg_finish_update(p_update_id bigint, p_claim uuid, p_ok boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_ok then
    update public.telegram_updates set status = 'done'
    where update_id = p_update_id and claim_id = p_claim and status = 'processing';
  else
    delete from public.telegram_updates
    where update_id = p_update_id and claim_id = p_claim and status = 'processing';
  end if;
  return found;
end $$;

-- Redeem a link token for the Telegram user who sent /start <token>.
-- Private chats only: there the chat id is the user's own id, so a token
-- pasted into a group can never link the group. Every failure gives the
-- same answer, so a guess learns nothing. The row lock makes two parallel
-- redemptions of one token wait for each other: only the first succeeds.
create function public.tg_redeem_link(p_token text, p_tg_user bigint, p_chat bigint, p_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.telegram_link_tokens%rowtype; v_status public.member_status; v_role public.member_role;
begin
  if p_token is null or length(p_token) not between 20 and 64 or p_tg_user is null or p_tg_user <= 0
     or p_chat is distinct from p_tg_user then
    return jsonb_build_object('ok', false);
  end if;
  select * into t from public.telegram_link_tokens where token_hash = app.tg_hash(p_token) for update;
  -- The same person sending the same /start again (a webhook retry after
  -- success) gets the same answer, not "invalid link". Anyone else: refused.
  if t.id is not null and t.used_at is not null and t.used_by = p_tg_user and t.revoked_at is null
     and exists (select 1 from public.telegram_links l where l.membership_id = t.membership_id
                 and l.telegram_user_id = p_tg_user and l.revoked_at is null) then
    return jsonb_build_object('ok', true, 'repeat', true, 'center_id', t.center_id,
      'center', (select name from public.centers where id = t.center_id),
      'children', (select count(*) from public.guardians g where g.membership_id = t.membership_id));
  end if;
  if t.id is null or t.used_at is not null or t.revoked_at is not null or t.expires_at <= now() then
    return jsonb_build_object('ok', false);
  end if;
  select m.status, m.role into v_status, v_role from public.memberships m
  where m.id = t.membership_id and m.center_id = t.center_id;
  if v_role is distinct from 'parent' or v_status = 'suspended' then
    return jsonb_build_object('ok', false);
  end if;

  update public.telegram_link_tokens set used_at = now(), used_by = p_tg_user where id = t.id;
  -- a new phone replaces the old one
  update public.telegram_links set revoked_at = now()
  where membership_id = t.membership_id and revoked_at is null;
  insert into public.telegram_links (center_id, membership_id, telegram_user_id, chat_id, username, last_seen_at)
  values (t.center_id, t.membership_id, p_tg_user, p_chat, left(p_username, 64), now());

  return jsonb_build_object('ok', true, 'center_id', t.center_id,
    'center', (select name from public.centers where id = t.center_id),
    'children', (select count(*) from public.guardians g where g.membership_id = t.membership_id));
end $$;

-- The children this Telegram user may see.
create function public.tg_children(p_tg_user bigint)
returns table (student_id uuid, full_name text, center_id uuid, center_name text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.full_name, s.center_id, c.name
  from public.guardians g
  join public.students s on s.id = g.student_id and s.center_id = g.center_id
  join public.centers c on c.id = s.center_id
  where g.membership_id in (select app.tg_live_memberships(p_tg_user))
    and s.status in ('lead','active','paused')
  order by s.full_name;
$$;

-- The parent pressed "Disconnect" in the bot.
create function public.tg_unlink(p_tg_user bigint)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.telegram_outbox o set status = 'skipped', last_error = 'unlinked'
  from public.telegram_links l
  where o.link_id = l.id and l.telegram_user_id = p_tg_user and l.revoked_at is null and o.status in ('queued','sending');
  update public.telegram_links set revoked_at = now() where telegram_user_id = p_tg_user and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Blocked: Telegram answered 403, or a my_chat_member update said
-- "kicked". Unblocked: the parent wrote to the bot again, pressed a button,
-- or a my_chat_member update said "member". Messages skipped while blocked
-- are not replayed (they are out of date); new ones are queued again.
create function public.tg_set_blocked(p_tg_user bigint, p_blocked boolean)
returns void language sql security definer set search_path = '' as $$
  update public.telegram_links
  set blocked_at = case when p_blocked then coalesce(blocked_at, now()) end,
      last_seen_at = case when p_blocked then last_seen_at else now() end
  where telegram_user_id = p_tg_user and revoked_at is null;
$$;

-- Kinds a parent gets on Telegram (priority list of the V1 pilot).
create function app.tg_kind_wanted(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('attendance', 'payment_due', 'payment_overdue', 'payment',
                    'lesson_cancelled', 'lesson_moved', 'mock_released');
$$;

-- Lesson notices (0022) carried only the group's name. They now also carry
-- the group and lesson ids, so Telegram delivery can be checked against the
-- child's current enrolment. In-app behaviour is unchanged (same text, same
-- recipients); the data just gains two ids.
create or replace function app.notify_lesson_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_group text;
begin
  select name into v_group from public.groups where id = new.group_id;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform app.notify(new.center_id, app.group_audience(new.group_id, true), 'lesson_cancelled', 'Lesson cancelled',
      format('The %s lesson on %s is cancelled.', v_group, app.tz_text(new.starts_at)),
      jsonb_build_object('group', v_group, 'at', new.starts_at, 'group_id', new.group_id, 'lesson_id', new.id));
  elsif new.status = 'scheduled' and new.starts_at is distinct from old.starts_at then
    perform app.notify(new.center_id, app.group_audience(new.group_id, true), 'lesson_moved', 'Lesson moved',
      format('The %s lesson on %s moved to %s.', v_group, app.tz_text(old.starts_at), app.tz_text(new.starts_at)),
      jsonb_build_object('group', v_group, 'from', old.starts_at, 'at', new.starts_at, 'group_id', new.group_id, 'lesson_id', new.id));
  end if;
  return new;
end $$;

-- A uuid from notification data, or null if it is missing or malformed
-- (never an error).
create function app.tg_uuid(p text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

-- Is this message still allowed to go out? Checked when it is queued and
-- again right before it is sent. The link must be live and not blocked,
-- the parent not suspended, and the notice must be attributable:
--   * about one student (student_id): still this parent's child;
--   * about a group (group_id): one of this parent's children is enrolled
--     in that group NOW (a child who moved or left no longer brings the
--     old group's notices, and its name is never shown);
--   * neither, or malformed ids: not sent (no guessing).
create function app.tg_may_deliver(p_link uuid, p_data jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.telegram_links l
    join public.memberships m on m.id = l.membership_id and m.center_id = l.center_id
    where l.id = p_link and l.revoked_at is null and l.blocked_at is null
      and m.role = 'parent' and m.status <> 'suspended'
      and case
        when p_data ? 'student_id' then
          app.tg_can_see_student(l.telegram_user_id, app.tg_uuid(p_data->>'student_id'))
        when p_data ? 'group_id' then exists (
          select 1 from public.guardians g
          join public.enrollments e on e.student_id = g.student_id and e.center_id = g.center_id
          join public.students s on s.id = g.student_id and s.center_id = g.center_id
          where g.membership_id = m.id and g.center_id = m.center_id
            and e.group_id = app.tg_uuid(p_data->>'group_id') and e.status = 'active'
            and s.status in ('lead','active','paused'))
        else false
      end);
$$;

-- Queuing for Telegram must never break the change that caused the notice
-- (an attendance mark, a payment): any error here skips Telegram for this
-- notice and lets the transaction go on.
create function app.tg_queue_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not app.tg_kind_wanted(new.data->>'kind') then return new; end if;
  begin
    insert into public.telegram_outbox (center_id, notification_id, link_id)
    select new.center_id, new.id, l.id
    from public.telegram_links l
    where l.membership_id = new.recipient_id and l.center_id = new.center_id
      and app.tg_may_deliver(l.id, new.data)
    on conflict (notification_id, link_id) do nothing;
  exception when others then
    raise warning 'telegram queue skipped for notification %', new.id;
  end;
  return new;
end $$;
create trigger notifications_telegram after insert on public.notifications
  for each row execute function app.tg_queue_notification();

-- Take a batch of due messages (1-50). Each gets a fresh claim id and a
-- 2-minute lease; `for update skip locked` keeps two senders from taking the
-- same row, and an expired lease lets another sender retry it. Messages
-- that may no longer go out (revoked, blocked, suspended, child unlinked)
-- or are older than 24 hours are skipped here, not sent.
--
-- Delivery is at least once: if Telegram accepted a message but the sender
-- died before tg_outbox_done, the lease expires and it is sent again. The
-- sender keeps that window small (10 s request timeout, lease 120 s), and
-- tg_outbox_done only accepts the current claim id, so a late answer from
-- an old attempt changes nothing.
create function public.tg_outbox_claim(p_limit int default 25)
returns table (id uuid, claim uuid, chat_id bigint, kind text, data jsonb, title text, body text, attempts int)
language plpgsql security definer set search_path = '' as $$
declare r record; v_claim uuid; n int := 0; v_max int := least(greatest(coalesce(p_limit, 25), 1), 50);
begin
  for r in
    select o.id, o.link_id, o.attempts, o.created_at, nt.data, nt.title, nt.body, l.chat_id
    from public.telegram_outbox o
    join public.notifications nt on nt.id = o.notification_id
    join public.telegram_links l on l.id = o.link_id
    where o.status in ('queued','sending') and o.next_attempt_at <= now()
    order by o.next_attempt_at
    limit v_max * 2
    for update of o skip locked
  loop
    if r.created_at < now() - interval '24 hours' then
      update public.telegram_outbox set status = 'skipped', last_error = 'stale' where telegram_outbox.id = r.id;
    elsif not app.tg_may_deliver(r.link_id, r.data) then
      update public.telegram_outbox set status = 'skipped', last_error = 'not allowed any more' where telegram_outbox.id = r.id;
    elsif n < v_max then
      v_claim := gen_random_uuid();
      update public.telegram_outbox
      set status = 'sending', claim_id = v_claim, attempts = r.attempts + 1, next_attempt_at = now() + interval '2 minutes'
      where telegram_outbox.id = r.id;
      n := n + 1;
      id := r.id; claim := v_claim; chat_id := r.chat_id; kind := r.data->>'kind';
      data := r.data; title := r.title; body := r.body; attempts := r.attempts + 1;
      return next;
    end if;
  end loop;
end $$;

-- Report how a send went. p_retry_after: seconds Telegram asked us to wait
-- (429). After 6 attempts the message is given up.
create function public.tg_outbox_done(p_id uuid, p_claim uuid, p_ok boolean, p_error text default null,
                                      p_retry_after int default null, p_blocked boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.telegram_outbox%rowtype;
begin
  select * into o from public.telegram_outbox where id = p_id for update;
  if o.id is null or o.status <> 'sending' or o.claim_id is distinct from p_claim then return; end if;
  if p_ok then
    update public.telegram_outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
  elsif p_blocked then
    update public.telegram_outbox set status = 'skipped', last_error = left(p_error, 300) where id = p_id;
    update public.telegram_links set blocked_at = coalesce(blocked_at, now()) where id = o.link_id;
  elsif o.attempts >= 6 then
    update public.telegram_outbox set status = 'failed', last_error = left(p_error, 300) where id = p_id;
  else
    update public.telegram_outbox
    set status = 'queued', last_error = left(p_error, 300),
        next_attempt_at = now() + make_interval(secs => least(3600, greatest(coalesce(p_retry_after, 0), 30 * power(2, o.attempts - 1)::int)))
    where id = p_id;
  end if;
end $$;

-- Keep the dedupe table small; finished outbox rows go after 30 days.
create function app.tg_prune() returns void
language sql security definer set search_path = '' as $$
  delete from public.telegram_updates where received_at < now() - interval '7 days';
  delete from public.telegram_outbox where status in ('sent','failed','skipped') and created_at < now() - interval '30 days';
$$;


revoke execute on function public.tg_claim_update(bigint), public.tg_finish_update(bigint, uuid, boolean), public.tg_redeem_link(text, bigint, bigint, text),
  public.tg_children(bigint), public.tg_unlink(bigint), public.tg_set_blocked(bigint, boolean),
  public.tg_outbox_claim(int), public.tg_outbox_done(uuid, uuid, boolean, text, int, boolean)
  from public, anon, authenticated;
grant execute on function public.tg_claim_update(bigint), public.tg_finish_update(bigint, uuid, boolean), public.tg_redeem_link(text, bigint, bigint, text),
  public.tg_children(bigint), public.tg_unlink(bigint), public.tg_set_blocked(bigint, boolean),
  public.tg_outbox_claim(int), public.tg_outbox_done(uuid, uuid, boolean, text, int, boolean)
  to service_role;
revoke execute on function app.tg_kind_wanted(text), app.tg_may_deliver(uuid, jsonb), app.tg_uuid(text), app.tg_queue_notification(), app.tg_prune()
  from public, anon, authenticated;

-- No cron job here: the pruning and sending jobs are in 0033 (needs pg_net
-- and a separate go-ahead for production).
