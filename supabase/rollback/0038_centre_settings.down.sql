-- Undo 0038: direct owner updates come back (as in 0002); the function goes.
begin;
drop function public.update_center_settings(uuid, text, text, text, text);
grant update on public.centers to authenticated;
create policy centers_update on public.centers for update to authenticated
  using (app.has_role(id, '{owner}')) with check (app.has_role(id, '{owner}'));
commit;
