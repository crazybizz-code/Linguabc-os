-- =====================================================================
-- LinguABC OS — phone sign-in support
--
-- Owners register with a phone number and may later sign in with
-- "email or phone". The phone lives on profiles (normalised to digits
-- with a leading +) and must be unique, so a phone maps to one account.
-- The lookup phone → email happens server-side with the service role;
-- it is never exposed to the browser.
-- =====================================================================

create function app.normalize_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null or regexp_replace(p, '\D', '', 'g') = '' then null
              else '+' || regexp_replace(p, '\D', '', 'g') end;
$$;

create function app.profiles_normalize_phone() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.phone := app.normalize_phone(new.phone);
  return new;
end $$;

create trigger profiles_phone_normalize before insert or update of phone on public.profiles
  for each row execute function app.profiles_normalize_phone();

create unique index profiles_phone_unique on public.profiles (phone) where phone is not null;

-- New auth users: take name and phone from sign-up metadata.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id,
          new.raw_user_meta_data ->> 'full_name',
          coalesce(new.phone, new.raw_user_meta_data ->> 'phone'))
  on conflict (id) do nothing;
  return new;
exception when unique_violation then
  -- phone already used by another account: keep the profile, drop the phone
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;

revoke execute on function app.normalize_phone(text) from public, anon;
revoke execute on function app.profiles_normalize_phone() from public, anon;
grant execute on function app.normalize_phone(text) to authenticated;
