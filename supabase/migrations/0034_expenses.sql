-- 0034: operating expenses and the NET CASH-BASED OPERATING RESULT.
--
--   net cash-based operating result = payments received (minus refunds)
--                                   - recorded operating expenses
-- for the same period, by date of the money movement (paid_at / spent_on),
-- in the centre's time zone. It is a cash measure, NOT accounting net
-- profit: no accruals, depreciation, taxes or unrecorded costs. Invoices
-- that are not paid are shown beside it as receivables, never added to it.
--
-- * Owner only: reads (RLS) and writes (RPCs re-check the role).
-- * Whole UZS in bigint, amount > 0.
-- * Never edited or deleted. A mistake is voided with a reason
--   (`void_expense`), or corrected: `record_expense(..., p_corrects)` writes
--   the right entry and voids the wrong one in one transaction, linked both
--   ways. Every insert and void is in audit_log (app.audit).
--
-- Rollback: supabase/rollback/0034_expenses.down.sql (drops the table and
-- every expense in it; export them first).

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references public.centers(id) on delete cascade,
  spent_on     date not null check (spent_on >= date '2020-01-01'),
  category     text not null check (category in ('rent','salaries','utilities','marketing','supplies','maintenance','taxes_fees','other')),
  amount       bigint not null check (amount > 0 and amount <= 10000000000),
  description  text not null check (length(trim(description)) between 2 and 500),
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  corrects     uuid,                       -- the voided entry this one replaces
  voided_at    timestamptz,
  voided_by    uuid,
  void_reason  text check (void_reason is null or length(trim(void_reason)) between 3 and 300),
  replaced_by  uuid,                       -- set when voided by a correction
  unique (id, center_id),
  foreign key (created_by, center_id) references public.memberships(id, center_id),
  foreign key (voided_by, center_id)  references public.memberships(id, center_id),
  foreign key (corrects, center_id)    references public.expenses(id, center_id),
  foreign key (replaced_by, center_id) references public.expenses(id, center_id),
  check ((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null))
);
create index expenses_center_day_idx on public.expenses (center_id, spent_on) where voided_at is null;

alter table public.expenses enable row level security;
revoke all on public.expenses from anon;
revoke insert, update, delete on public.expenses from authenticated;
create policy expenses_select on public.expenses for select to authenticated
  using (app.has_role(center_id, '{owner}'));

-- Only one change is ever allowed: voiding a live entry (inside the RPCs).
create function app.expenses_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'expenses are never deleted; void them' using errcode = '42501'; end if;
  if old.voided_at is not null
     or new.voided_at is null
     or (to_jsonb(new) - '{voided_at,voided_by,void_reason,replaced_by}'::text[])
        <> (to_jsonb(old) - '{voided_at,voided_by,void_reason,replaced_by}'::text[]) then
    raise exception 'expenses cannot be edited; void and record again' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger expenses_guard before update or delete on public.expenses
  for each row execute function app.expenses_guard();
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function app.audit();

create function app.center_today(p_center uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.centers where id = p_center), 'Asia/Tashkent'))::date;
$$;
revoke execute on function app.center_today(uuid) from public, anon, authenticated;

create function public.record_expense(p_center uuid, p_spent_on date, p_category text, p_amount bigint,
                                      p_description text, p_corrects uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid := app.my_membership(p_center, 'owner'); v_id uuid; o public.expenses%rowtype;
begin
  if v_me is null then perform app.forbid(); end if;
  if p_spent_on is null or p_spent_on > app.center_today(p_center) then raise exception 'expense date cannot be in the future'; end if;
  if p_corrects is not null then
    select * into o from public.expenses where id = p_corrects and center_id = p_center for update;
    if o.id is null then perform app.forbid(); end if;
    if o.voided_at is not null then raise exception 'this expense is already void'; end if;
  end if;
  insert into public.expenses (center_id, spent_on, category, amount, description, created_by, corrects)
  values (p_center, p_spent_on, p_category, p_amount, trim(p_description), v_me, p_corrects)
  returning id into v_id;
  if p_corrects is not null then
    update public.expenses set voided_at = now(), voided_by = v_me, void_reason = 'corrected', replaced_by = v_id
    where id = p_corrects;
  end if;
  return v_id;
end $$;

create function public.void_expense(p_expense uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_center uuid; v_void timestamptz; v_me uuid;
begin
  select center_id, voided_at into v_center, v_void from public.expenses where id = p_expense for update;
  v_me := app.my_membership(v_center, 'owner');
  if v_center is null or v_me is null then perform app.forbid(); end if;
  if v_void is not null then raise exception 'this expense is already void'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'give a reason for voiding'; end if;
  update public.expenses set voided_at = now(), voided_by = v_me, void_reason = left(trim(p_reason), 300) where id = p_expense;
end $$;

-- The owner's cash view for one period, plus a month-by-month trend.
create function public.cash_operating_result(p_center uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  v jsonb;
begin
  if app.my_membership(p_center, 'owner') is null then perform app.forbid(); end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Choose a period of up to about a year.';
  end if;
  select timezone into v_tz from public.centers where id = p_center;
  with pay as (
    select (p.paid_at at time zone v_tz)::date as d, case when p.kind = 'payment' then p.amount else -p.amount end as amt, p.kind
    from public.payments p where p.center_id = p_center
  ), exp as (
    select e.spent_on as d, e.amount, e.category from public.expenses e
    where e.center_id = p_center and e.voided_at is null
  ), months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as m
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'timezone', v_tz,
    'payments_received', (select coalesce(sum(amt) filter (where kind = 'payment'), 0) from pay where d between p_from and p_to),
    'refunds',           (select coalesce(-sum(amt) filter (where kind = 'refund'), 0) from pay where d between p_from and p_to),
    'collected',         (select coalesce(sum(amt), 0) from pay where d between p_from and p_to),
    'expenses',          (select coalesce(sum(amount), 0) from exp where d between p_from and p_to),
    'expense_count',     (select count(*) from exp where d between p_from and p_to),
    'by_category',       (select coalesce(jsonb_object_agg(category, total), '{}') from
                            (select category, sum(amount) as total from exp where d between p_from and p_to group by category) c),
    'months', (select jsonb_agg(jsonb_build_object('month', m,
                  'collected', (select coalesce(sum(amt), 0) from pay where date_trunc('month', d) = m),
                  'expenses',  (select coalesce(sum(amount), 0) from exp where date_trunc('month', d) = m)) order by m)
               from months),
    -- shown beside the result, never part of it
    'receivables_now', (select jsonb_build_object(
        'outstanding', coalesce(sum(balance) filter (where payment_status in ('pending','partial','overdue')), 0),
        'overdue',     coalesce(sum(balance) filter (where payment_status = 'overdue'), 0))
      from public.invoice_balances where center_id = p_center))
  into v;
  return v || jsonb_build_object('net_cash_result', (v->>'collected')::bigint - (v->>'expenses')::bigint);
end $$;

revoke execute on function public.record_expense(uuid, date, text, bigint, text, uuid),
  public.void_expense(uuid, text), public.cash_operating_result(uuid, date, date) from public, anon;
grant execute on function public.record_expense(uuid, date, text, bigint, text, uuid),
  public.void_expense(uuid, text), public.cash_operating_result(uuid, date, date) to authenticated;
revoke execute on function app.expenses_guard() from public, anon, authenticated;
