-- 0024: answer keys reach only the mentors who need them (pre-launch blocker).
--
-- assignment_keys used to be readable and writable by every mentor in the
-- centre. Now a mentor reads a key only for work they wrote, or work set for
-- a group they teach. Owners, admins and academic managers keep full access.
-- Keys are written only by the security-definer homework functions, so no
-- mentor needs to write the table directly any more.

drop policy assignment_keys_select on public.assignment_keys;
drop policy assignment_keys_write on public.assignment_keys;

create function app.can_read_assignment_key(p_assignment uuid, p_center uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_staff(p_center)
      or exists (select 1 from public.assignments a
                 where a.id = p_assignment and a.center_id = p_center
                   and a.created_by in (select m.id from public.memberships m
                                        where m.user_id = auth.uid() and m.center_id = p_center and m.status = 'active'))
      or exists (select 1 from public.homework h
                 where h.assignment_id = p_assignment and h.center_id = p_center
                   and app.is_mentor_of_group(h.group_id));
$$;
revoke execute on function app.can_read_assignment_key(uuid, uuid) from public, anon;
grant execute on function app.can_read_assignment_key(uuid, uuid) to authenticated;

create policy assignment_keys_select on public.assignment_keys for select to authenticated
  using (app.can_read_assignment_key(assignment_id, center_id));
create policy assignment_keys_write on public.assignment_keys for all to authenticated
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));
