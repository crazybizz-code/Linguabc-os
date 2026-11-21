-- 0026: payment reminders (owner, 2026-11-20: V1 has no online payment;
-- families are only told about payments).
--
-- Students and their parents get an in-app reminder
--   * once, when an unpaid fee is due within 3 days ("payment_due"),
--   * when it becomes overdue, then every 7 days while it stays unpaid
--     ("payment_overdue").
-- A daily job sends them at 09:00 Tashkent time (pg_cron, where available).
-- Owners and admins can also remind a family by hand (remind_payment),
-- at most once a day per invoice.

alter table public.invoices add column last_reminded_at timestamptz;

-- Today in the centres' time zone (Uzbekistan).
create function app.local_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Tashkent')::date $$;

-- Sends one reminder for an invoice; returns how many people got it.
create function app.remind_invoice(p_invoice uuid, p_kind text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_i public.invoices; v_name text; v_balance bigint; v_to uuid[];
begin
  select * into v_i from public.invoices where id = p_invoice for update;
  if v_i.id is null or v_i.status <> 'open' then return 0; end if;
  select v_i.amount - coalesce(sum(case when kind = 'payment' then amount else -amount end), 0)
    into v_balance from public.payments where invoice_id = v_i.id;
  if v_balance <= 0 then return 0; end if;

  select s.full_name into v_name from public.students s where s.id = v_i.student_id;
  v_to := app.family_of(v_i.student_id);
  perform app.notify(v_i.center_id, v_to, p_kind,
    case when p_kind = 'payment_overdue' then 'Payment overdue' else 'Payment due soon' end,
    case when p_kind = 'payment_overdue'
         then format('%s: %s UZS for %s was due on %s.', v_name, v_balance, to_char(v_i.period, 'Mon YYYY'), to_char(v_i.due_date, 'DD Mon'))
         else format('%s: %s UZS for %s is due on %s.', v_name, v_balance, to_char(v_i.period, 'Mon YYYY'), to_char(v_i.due_date, 'DD Mon')) end,
    jsonb_build_object('student', v_name, 'student_id', v_i.student_id, 'invoice_id', v_i.id, 'amount', v_balance,
                       'period', v_i.period, 'due', v_i.due_date));
  update public.invoices set last_reminded_at = now() where id = v_i.id;
  return coalesce(array_length(v_to, 1), 0);
end $$;

-- The daily run. Safe to call more than once a day: it only sends what is due.
create function app.send_payment_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare v_today date := app.local_today(); r record; v_sent int := 0;
begin
  for r in
    select b.id, b.due_date, i.last_reminded_at
    from public.invoice_balances b join public.invoices i on i.id = b.id
    where i.status = 'open' and b.balance > 0
      and b.due_date <= v_today + 3
  loop
    if r.due_date >= v_today then
      -- due soon: once
      if r.last_reminded_at is null then v_sent := v_sent + app.remind_invoice(r.id, 'payment_due'); end if;
    else
      -- overdue: the first day after the due date, then weekly
      if r.last_reminded_at is null or (r.last_reminded_at at time zone 'Asia/Tashkent')::date <= r.due_date
         or (r.last_reminded_at at time zone 'Asia/Tashkent')::date <= v_today - 7 then
        v_sent := v_sent + app.remind_invoice(r.id, 'payment_overdue');
      end if;
    end if;
  end loop;
  return v_sent;
end $$;

-- A reminder sent by hand from the payments desk.
create function public.remind_payment(p_invoice uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_i public.invoices;
begin
  select * into v_i from public.invoices where id = p_invoice;
  if v_i.id is null or not app.is_admin(v_i.center_id) then perform app.forbid(); end if;
  if v_i.last_reminded_at > now() - interval '1 day' then raise exception 'This family was already reminded today.'; end if;
  return app.remind_invoice(p_invoice, case when v_i.due_date < app.local_today() then 'payment_overdue' else 'payment_due' end);
end $$;

revoke execute on function app.local_today(), app.remind_invoice(uuid, text), app.send_payment_reminders() from public, anon, authenticated;
grant execute on function app.local_today() to authenticated;
revoke execute on function public.remind_payment(uuid) from public, anon;
grant execute on function public.remind_payment(uuid) to authenticated;

-- Daily at 04:00 UTC = 09:00 in Tashkent. Skipped where pg_cron is not
-- available (the local test database); there the function is called directly.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('payment-reminders', '0 4 * * *', 'select app.send_payment_reminders()');
  end if;
end $$;
