-- Undo 0034. DELETES EVERY RECORDED EXPENSE: export them first
-- (select * from public.expenses). audit_log keeps its rows.
begin;
drop function public.cash_operating_result(uuid, date, date), public.void_expense(uuid, text),
  public.record_expense(uuid, date, text, bigint, text, uuid), app.center_today(uuid);
drop table public.expenses;
drop function app.expenses_guard();
commit;
