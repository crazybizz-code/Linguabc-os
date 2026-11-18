-- =====================================================================
-- Parent and student portals.
-- Parents and students cannot read the staff roster (memberships), but
-- they should see who teaches their group. This returns only that one
-- name, and only for a group the caller is allowed to see.
-- =====================================================================

create function public.group_mentor_name(p_group uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.full_name
  from public.groups g
  join public.memberships m on m.id = g.mentor_id
  where g.id = p_group and app.can_see_group(p_group);
$$;

revoke execute on function public.group_mentor_name(uuid) from public, anon;
grant execute on function public.group_mentor_name(uuid) to authenticated;
