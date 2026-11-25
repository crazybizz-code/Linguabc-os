-- Undo 0035 (functions only; edits, transfers and timetable changes made with them stay).
begin;
drop function public.update_student(uuid, text, text, text, date, uuid, text),
  public.save_guardian(uuid, uuid, text, text, text, boolean),
  public.end_enrollment(uuid, text, date, text), public.transfer_student(uuid, uuid, date, boolean),
  public.update_group(uuid, text, uuid, text, int), public.update_group_schedule(uuid, smallint[], time, time, date),
  public.cancel_lesson(uuid, text), public.move_lesson(uuid, timestamptz, timestamptz), app.clash_message(timestamptz, text);
commit;
