"use client";

import { useState } from "react";
import { FieldLabel } from "@/components/ui/dialog";
import { cn, inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { cancelLesson, moveLesson, updateGroup, updateGroupSchedule } from "../../actions";
import { todayISO } from "@/lib/dates";
import { useT } from "@/i18n/client";

type Opt = { id: string; name: string };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Staff: name, mentor, room, capacity (update_group, 0035). Future lessons follow the mentor and room. */
export function EditGroup({ g, mentors, room }: { g: { id: string; name: string; mentor_id: string | null; capacity: number | null }; mentors: Opt[]; room: string | null }) {
  const t = useT();
  return (
    <FormDialog subtle trigger={t("Edit group")} title={t("Edit group")}
      description={t("Future lessons move to the new mentor and room. A clash with another booking is refused and nothing changes.")}
      submitLabel={t("Save")} action={updateGroup}>
      <input type="hidden" name="group_id" value={g.id} />
      <FieldLabel label={t("Group name")}><input name="name" required minLength={2} defaultValue={g.name} className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldLabel label={t("Mentor")}>
          <select name="mentor_id" defaultValue={g.mentor_id ?? ""} className={inputClass}>
            <option value="">{t("No mentor yet")}</option>
            {mentors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label={t("Room")}><input name="room" defaultValue={room ?? ""} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Capacity")}><input name="capacity" type="number" min={1} defaultValue={g.capacity ?? ""} className={inputClass} /></FieldLabel>
      </div>
    </FormDialog>
  );
}

/** Staff: a new weekly timetable from a date (update_group_schedule, 0035). */
export function EditTimetable({ groupId, days, start, end }: { groupId: string; days: number[]; start: string; end: string }) {
  const t = useT();
  const [on, setOn] = useState<number[]>(days.length ? days : [1, 3, 5]);
  return (
    <FormDialog subtle trigger={t("Change timetable")} title={t("Change timetable")}
      description={t("From the chosen date, lessons without attendance are replaced by the new times for the next 12 weeks. Students and parents are told once.")}
      submitLabel={t("Save timetable")} action={updateGroupSchedule}>
      <input type="hidden" name="group_id" value={groupId} />
      {on.map((d) => <input key={d} type="hidden" name="weekday" value={d} />)}
      <div>
        <span className="mb-1.5 block text-[11.5px] font-medium text-[#3B4A42]">{t("Schedule")}</span>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <button key={d} type="button" onClick={() => setOn((x) => (x.includes(i + 1) ? x.filter((y) => y !== i + 1) : [...x, i + 1].sort()))}
              className={cn("h-9 rounded-[10px] border px-3 text-[12.5px]", on.includes(i + 1) ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80")}>
              {t(d)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldLabel label={t("Starts")}><input name="start_time" type="time" required defaultValue={start} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Ends")}><input name="end_time" type="time" required defaultValue={end} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("From")}><input name="from" type="date" required min={todayISO()} defaultValue={todayISO()} className={inputClass} /></FieldLabel>
      </div>
    </FormDialog>
  );
}

/** Staff: cancel or move one lesson (cancel_lesson / move_lesson, 0035). */
export function LessonActions({ groupId, lessonId, date, start, end }: { groupId: string; lessonId: string; date: string; start: string; end: string }) {
  const t = useT();
  return (
    <span className="flex gap-1.5">
      <FormDialog subtle trigger={t("Move")} title={t("Move lesson")} description={t("Students and parents are told about the new time.")}
        submitLabel={t("Move lesson")} action={moveLesson}>
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="lesson_id" value={lessonId} />
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldLabel label={t("Date")}><input name="date" type="date" required min={todayISO()} defaultValue={date} className={inputClass} /></FieldLabel>
          <FieldLabel label={t("Starts")}><input name="start_time" type="time" required defaultValue={start} className={inputClass} /></FieldLabel>
          <FieldLabel label={t("Ends")}><input name="end_time" type="time" required defaultValue={end} className={inputClass} /></FieldLabel>
        </div>
      </FormDialog>
      <FormDialog subtle trigger={t("Cancel")} title={t("Cancel lesson")} description={t("Students and parents are told the lesson is cancelled.")}
        submitLabel={t("Cancel lesson")} action={cancelLesson}>
        <input type="hidden" name="group_id" value={groupId} />
        <input type="hidden" name="lesson_id" value={lessonId} />
        <FieldLabel label={t("Reason")} hint={t("Optional")}><input name="reason" maxLength={200} className={inputClass} /></FieldLabel>
      </FormDialog>
    </span>
  );
}
