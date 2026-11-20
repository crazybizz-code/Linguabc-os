-- 0023: invitation codes expire (pre-launch security blocker).
--
-- An unused code used to stay redeemable for ever. Now every code is good
-- for 14 days. /join and accept_invite refuse an expired code, and staff
-- who may issue the invite can give the person a fresh code
-- (reissue_invite), which also cancels the old one.

alter table public.memberships add column invite_expires_at timestamptz;

-- Pending invites already sent get the full 14 days from today.
update public.memberships set invite_expires_at = now() + interval '14 days'
 where status = 'invited' and invite_code is not null;

create or replace function app.invite_ttl() returns interval
language sql immutable set search_path = '' as $$ select interval '14 days' $$;

create or replace function public.invite_member(
  p_center uuid, p_role public.member_role, p_full_name text,
  p_email text default null, p_phone text default null, p_branch uuid default null,
  p_student uuid default null, p_guardian uuid default null)
returns table (membership_id uuid, invite_code text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_id uuid; v_code text;
begin
  if not app.is_admin(p_center) then perform app.forbid(); end if;
  if p_role in ('owner','admin') and not app.has_role(p_center, '{owner}') then
    perform app.forbid('only the owner can invite owners or admins');
  end if;
  if p_role = 'student' and p_student is null then
    raise exception 'student invite needs p_student';
  end if;
  if p_role = 'parent' and p_guardian is null then
    raise exception 'parent invite needs p_guardian';
  end if;

  v_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  insert into public.memberships (center_id, role, status, full_name, email, phone, branch_id, invite_code, invite_expires_at, invited_by)
  values (p_center, p_role, 'invited', trim(p_full_name), lower(p_email), p_phone, p_branch, v_code,
          now() + app.invite_ttl(), app.my_staff_membership(p_center))
  returning id into v_id;

  if p_role = 'student' then
    update public.students set membership_id = v_id
    where id = p_student and center_id = p_center and membership_id is null;
    if not found then raise exception 'student not found or already has a login'; end if;
  elsif p_role = 'parent' then
    update public.guardians set membership_id = v_id
    where id = p_guardian and center_id = p_center and membership_id is null;
    if not found then raise exception 'guardian not found or already has a login'; end if;
  end if;

  return query select v_id, v_code;
end $$;

create or replace function public.accept_invite(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then perform app.forbid('sign in first'); end if;
  update public.memberships
     set user_id = auth.uid(), status = 'active', invite_code = null, invite_expires_at = null
   where invite_code = upper(trim(p_code)) and status = 'invited'
     and invite_expires_at > now()
  returning id into v_id;
  if v_id is null then raise exception 'invalid or used invite code, or it has expired'; end if;
  return v_id;
end $$;

create or replace function public.invite_preview(p_code text)
returns table (center_name text, role public.member_role, full_name text, email text)
language sql stable security definer set search_path = '' as $$
  select c.name, m.role, m.full_name, m.email
  from public.memberships m
  join public.centers c on c.id = m.center_id
  where m.invite_code = upper(trim(p_code)) and m.status = 'invited'
    and m.invite_expires_at > now()
    and length(trim(p_code)) >= 12;
$$;

-- A fresh code for a pending invite; the old code stops working at once.
-- Same rule as issuing: owner or admin, and only the owner for owners and admins.
create function public.reissue_invite(p_membership uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_m public.memberships; v_code text;
begin
  select * into v_m from public.memberships where id = p_membership for update;
  if v_m.id is null or not app.is_admin(v_m.center_id) then perform app.forbid(); end if;
  if v_m.role in ('owner','admin') and not app.has_role(v_m.center_id, '{owner}') then
    perform app.forbid('only the owner can invite owners or admins');
  end if;
  if v_m.status <> 'invited' or v_m.user_id is not null then raise exception 'this invitation was already accepted'; end if;
  v_code := upper(encode(extensions.gen_random_bytes(6), 'hex'));
  update public.memberships set invite_code = v_code, invite_expires_at = now() + app.invite_ttl()
   where id = p_membership;
  return v_code;
end $$;

revoke execute on function public.reissue_invite(uuid) from public, anon;
grant execute on function public.reissue_invite(uuid) to authenticated;
revoke execute on function app.invite_ttl() from public, anon;
grant execute on function app.invite_ttl() to authenticated;
