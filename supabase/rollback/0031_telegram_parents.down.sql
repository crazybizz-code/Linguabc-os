-- Undo 0031. Run in one transaction, as the database owner, after 0032's.
-- Loses: every Telegram link and queued message (parents must link again).
-- Parent memberships created by issue_telegram_link stay (status 'invited',
-- linked to their guardian rows), like a web invite that was never used.
begin;
drop trigger notifications_telegram on public.notifications;
drop function public.tg_claim_update(bigint), public.tg_finish_update(bigint, uuid, boolean),
  public.tg_redeem_link(text, bigint, bigint, text), public.tg_children(bigint), public.tg_unlink(bigint),
  public.tg_set_blocked(bigint, boolean), public.tg_outbox_claim(int),
  public.tg_outbox_done(uuid, uuid, boolean, text, int, boolean),
  public.issue_telegram_link(uuid), public.attach_guardian_to_parent(uuid, uuid), public.revoke_telegram_link(uuid),
  app.tg_queue_notification(), app.tg_may_deliver(uuid, jsonb), app.tg_uuid(text), app.tg_kind_wanted(text), app.tg_prune(),
  app.tg_can_see_student(bigint, uuid), app.tg_live_memberships(bigint), app.tg_hash(text);
drop table public.telegram_outbox, public.telegram_updates, public.telegram_links, public.telegram_link_tokens;

-- app.notify as in 0022
create or replace function app.notify(p_center uuid, p_recipients uuid[], p_kind text, p_title text, p_body text, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (center_id, recipient_id, channel, status, title, body, data, sent_at)
  select p_center, m.id, 'in_app'::public.notification_channel, 'sent'::public.notification_status,
         p_title, p_body, coalesce(p_data, '{}') || jsonb_build_object('kind', p_kind), now()
  from public.memberships m
  where m.id = any(p_recipients) and m.center_id = p_center and m.status = 'active';
$$;
revoke execute on function app.notify(uuid, uuid[], text, text, text, jsonb) from public, anon, authenticated;

-- app.notify_lesson_change as in 0022
create or replace function app.notify_lesson_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_group text;
begin
  select name into v_group from public.groups where id = new.group_id;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform app.notify(new.center_id, app.group_audience(new.group_id, true), 'lesson_cancelled', 'Lesson cancelled',
      format('The %s lesson on %s is cancelled.', v_group, app.tz_text(new.starts_at)),
      jsonb_build_object('group', v_group, 'at', new.starts_at));
  elsif new.status = 'scheduled' and new.starts_at is distinct from old.starts_at then
    perform app.notify(new.center_id, app.group_audience(new.group_id, true), 'lesson_moved', 'Lesson moved',
      format('The %s lesson on %s moved to %s.', v_group, app.tz_text(old.starts_at), app.tz_text(new.starts_at)),
      jsonb_build_object('group', v_group, 'from', old.starts_at, 'at', new.starts_at));
  end if;
  return new;
end $$;
commit;
