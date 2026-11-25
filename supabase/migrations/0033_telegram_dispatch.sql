-- 0033: send queued parent Telegram messages from the database clock.
--
-- NEEDS A SEPARATE GO-AHEAD FOR PRODUCTION: it enables the pg_net extension
-- and schedules two pg_cron jobs.
--
-- Every minute `app.tg_dispatch_tick()`:
--   * does nothing (no network at all) unless a message is due;
--   * does nothing unless both Vault secrets exist:
--       telegram_dispatch_url     https://<app>/api/telegram/dispatch
--       telegram_dispatch_secret  same value as TELEGRAM_DISPATCH_SECRET in Vercel
--     (created by hand in the dashboard: Vault, never in a migration or Git);
--   * makes at most one HTTP call per minute (pg_net, async, 25 s timeout),
--     and skips a minute while the previous call may still be running.
-- The app then sends one bounded batch (25). So the worst case is 1,440
-- calls a day, and zero on a quiet day. Daily at 03:17 UTC old webhook ids
-- and finished outbox rows are pruned.
--
-- Rollback: supabase/rollback/0033_telegram_dispatch.down.sql (unschedules
-- the jobs; pg_net is left installed, harmless).

create table public.telegram_dispatch_state (
  id             boolean primary key default true check (id),
  last_called_at timestamptz
);
insert into public.telegram_dispatch_state (id) values (true);
alter table public.telegram_dispatch_state enable row level security;
revoke all on public.telegram_dispatch_state from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

create function app.tg_dispatch_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_last timestamptz;
begin
  if not exists (select 1 from public.telegram_outbox where status in ('queued','sending') and next_attempt_at <= now()) then
    return 0;
  end if;
  select last_called_at into v_last from public.telegram_dispatch_state where id for update;
  if v_last is not null and v_last > now() - interval '50 seconds' then return 0; end if;
  -- Vault and pg_net are looked up at run time, so this file also loads
  -- where they are missing (the local test database); then nothing is sent.
  begin
    execute $q$select max(decrypted_secret) filter (where name = 'telegram_dispatch_url'),
                      max(decrypted_secret) filter (where name = 'telegram_dispatch_secret')
               from vault.decrypted_secrets
               where name in ('telegram_dispatch_url', 'telegram_dispatch_secret')$q$
      into v_url, v_secret;
  exception when undefined_table or invalid_schema_name then
    return 0;
  end;
  if v_url is null or v_secret is null or v_url !~ '^https://' then return 0; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 25000)'
    using v_url, '{}'::jsonb, jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json');
  update public.telegram_dispatch_state set last_called_at = now() where id;
  return 1;
end $$;
revoke execute on function app.tg_dispatch_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('telegram-dispatch', '* * * * *', 'select app.tg_dispatch_tick()');
    perform cron.schedule('telegram-prune', '17 3 * * *', 'select app.tg_prune()');
  end if;
end $$;
