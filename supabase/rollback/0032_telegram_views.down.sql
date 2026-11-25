-- Undo 0032. Run in one transaction, as the database owner, before 0031's.
-- Loses: the centre phone and address typed in Settings (note them first).
begin;
drop function public.tg_child_profile(bigint, uuid), public.tg_child_schedule(bigint, uuid),
  public.tg_child_attendance(bigint, uuid), public.tg_child_payments(bigint, uuid),
  public.tg_child_homework(bigint, uuid), public.tg_child_results(bigint, uuid),
  public.tg_center_contact(bigint, uuid), app.tg_guard(bigint, uuid);
alter table public.centers drop column phone, drop column address;
commit;
