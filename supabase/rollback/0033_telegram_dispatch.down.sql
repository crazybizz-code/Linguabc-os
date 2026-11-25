-- Undo 0033. Run before the 0032 and 0031 rollbacks. pg_net stays installed.
begin;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('telegram-dispatch', 'telegram-prune');
  end if;
end $$;
drop function app.tg_dispatch_tick();
drop table public.telegram_dispatch_state;
commit;
