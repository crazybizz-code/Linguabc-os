-- 0039: Telegram delivery health for owner/admin, without sensitive data.
--
-- telegram_queue_health(center): counts of the centre's Telegram messages
-- of the last 7 days by state, how many linked parents have blocked the
-- bot, the time of the newest failure and the failure classes (the HTTP
-- status only: 429, 403, 400, 0 = network). No chat ids, no message text,
-- no names, no Telegram error text. Owner/admin only (app.is_admin).
-- Works before 0033 (sending also happens right after staff actions).
--
-- Rollback: drop function public.telegram_queue_health(uuid).

create function public.telegram_queue_health(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin(p_center) then perform app.forbid(); end if;
  return (
    select jsonb_build_object(
      'since', now() - interval '7 days',
      'sent',    count(*) filter (where o.status = 'sent'),
      'waiting', count(*) filter (where o.status in ('queued','sending')),
      'failed',  count(*) filter (where o.status = 'failed'),
      'skipped', count(*) filter (where o.status = 'skipped'),
      'oldest_waiting_minutes', round(extract(epoch from now() - min(o.created_at) filter (where o.status in ('queued','sending'))) / 60),
      'last_failure_at', max(o.created_at) filter (where o.status = 'failed'),
      'failure_classes', coalesce((
          select jsonb_object_agg(cls, n) from (
            select coalesce(substring(o2.last_error from '^([0-9]{1,3})\M'), 'other') as cls, count(*) as n
            from public.telegram_outbox o2
            where o2.center_id = p_center and o2.created_at > now() - interval '7 days'
              and o2.last_error is not null and o2.status in ('failed','queued')
            group by 1) c), '{}'),
      'linked_parents',  (select count(*) from public.telegram_links l where l.center_id = p_center and l.revoked_at is null),
      'blocked_parents', (select count(*) from public.telegram_links l where l.center_id = p_center and l.revoked_at is null and l.blocked_at is not null))
    from public.telegram_outbox o
    where o.center_id = p_center and o.created_at > now() - interval '7 days');
end $$;
revoke execute on function public.telegram_queue_health(uuid) from public, anon;
grant execute on function public.telegram_queue_health(uuid) to authenticated;
