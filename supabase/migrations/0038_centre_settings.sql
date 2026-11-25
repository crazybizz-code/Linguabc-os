-- 0038: centre settings the owner can change, through one checked function.
--
-- * update_center_settings(center, name, phone, address, timezone): owner
--   only. Phone and address are what the parent bot shows under
--   "Markaz bilan aloqa" (columns from 0032).
-- * Time zone: the code still assumes UTC+5 in places (reports, reminders,
--   lesson times), so V1 accepts only Uzbekistan's zones, which are both
--   UTC+5 with no daylight saving. Anything else is refused rather than
--   half-applied.
-- * Direct UPDATE on centers is closed: until now the owner could write any
--   column with a plain API call, including receipt_seq (receipt numbering,
--   which only record_payment may advance) and slug. Owners now change the
--   centre only through this function.
--
-- Rollback: supabase/rollback/0038_centre_settings.down.sql.

create function public.update_center_settings(p_center uuid, p_name text, p_phone text, p_address text, p_timezone text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text := nullif(trim(p_phone), ''); v_addr text := nullif(trim(p_address), '');
begin
  if not app.has_role(p_center, '{owner}') then perform app.forbid(); end if;
  if coalesce(length(trim(p_name)), 0) not between 2 and 120 then raise exception 'Enter a name of 2 to 120 characters.'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{5,32}$' then raise exception 'Enter a phone number such as +998 71 200 00 00.'; end if;
  if v_addr is not null and length(v_addr) > 300 then raise exception 'Keep the address under 300 characters.'; end if;
  if p_timezone is null or p_timezone not in ('Asia/Tashkent', 'Asia/Samarkand') then
    raise exception 'Choose Asia/Tashkent or Asia/Samarkand.';
  end if;
  update public.centers
  set name = trim(p_name), phone = v_phone, address = v_addr, timezone = p_timezone
  where id = p_center;
end $$;

revoke execute on function public.update_center_settings(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_center_settings(uuid, text, text, text, text) to authenticated;

-- Centre rows are now changed only by functions (create_center, record_payment,
-- update_center_settings), never by a direct API update.
drop policy centers_update on public.centers;
revoke update on public.centers from authenticated, anon;
