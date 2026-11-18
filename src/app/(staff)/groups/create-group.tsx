"use client";

import { useState } from "react";
import { FieldLabel } from "@/components/ui/dialog";
import { cn, inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { addCourse, createGroup } from "../actions";
import { todayISO } from "@/lib/dates";
import { useT } from "@/i18n/client";

type Opt = { id: string; name: string };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CreateGroup({ courses, branches, mentors }: { courses: Opt[]; branches: Opt[]; mentors: Opt[] }) {
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const t = useT();
  const today = todayISO();
  const missing = !courses.length ? t("Create a course first (Courses tab).") : !branches.length ? t("Add a branch first (Branches page).") : null;
  return (
    <FormDialog trigger={t("Create group")} title={t("Create group")} description={t("A group links one course, one mentor and one weekly rhythm.")} submitLabel={t("Create group")} action={createGroup}>
      {missing && <p className="rounded-[10px] bg-[#FBEEDC] px-3 py-2.5 text-[12.5px] text-[#9A5B1E]">{missing}</p>}
      <FieldLabel label={t("Group name")}><input name="name" required autoFocus placeholder="IELTS Advanced — Group C" className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label={t("Course")}>
          <select name="course_id" required className={inputClass}>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </FieldLabel>
        <FieldLabel label={t("Branch")}>
          <select name="branch_id" required className={inputClass}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </FieldLabel>
        <FieldLabel label={t("Mentor")}>
          <select name="mentor_id" className={inputClass} defaultValue={mentors[0]?.id ?? ""}>
            <option value="">{t("No mentor yet")}</option>
            {mentors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label={t("Room")} hint={t("Created automatically if new")}><input name="room" placeholder="302" className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Capacity")}><input name="capacity" type="number" min={1} defaultValue={18} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Start date")}><input name="start_date" type="date" defaultValue={today} className={inputClass} /></FieldLabel>
      </div>
      <div>
        <span className="mb-1.5 block text-[11.5px] font-medium text-[#3B4A42]">{t("Schedule")}</span>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => {
            const n = i + 1;
            const on = days.includes(n);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDays((xs) => (on ? xs.filter((x) => x !== n) : [...xs, n].sort()))}
                className={cn("h-9 min-w-[48px] rounded-[9px] border px-3 text-[12.5px] font-medium", on ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80 text-[#3B4A42] hover:bg-white")}
              >
                {t(d)}
              </button>
            );
          })}
        </div>
        {days.map((d) => <input key={d} type="hidden" name="weekday" value={d} />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label={t("Starts")}><input name="start_time" type="time" defaultValue="18:00" className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Ends")}><input name="end_time" type="time" defaultValue="20:00" className={inputClass} /></FieldLabel>
      </div>
      <p className="rounded-[10px] bg-[#F5ECE8] px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        {t("The next 12 weeks of lessons are scheduled automatically. If the room or mentor is already booked at that time, nothing is saved and you'll see which day clashes.")}
      </p>
    </FormDialog>
  );
}

export function CreateCourse() {
  const t = useT();
  return (
    <FormDialog trigger={t("Create course")} title={t("Create course")} description={t("A course is the programme a group follows — its level, length and default fee.")} submitLabel={t("Create course")} action={addCourse} width="max-w-[520px]">
      <FieldLabel label={t("Course name")}><input name="name" required autoFocus placeholder="IELTS Advanced" className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldLabel label={t("Level")}>
          <select name="level" className={inputClass} defaultValue="B2">
            <option value="">—</option>
            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l}>{l}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label={t("Weeks")}><input name="duration_weeks" type="number" min={1} placeholder="12" className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Code")} hint={t("Optional")}><input name="code" placeholder="IELTS-ADV" className={inputClass} /></FieldLabel>
      </div>
      <FieldLabel label={t("Monthly fee (UZS)")} hint={t("Default for new enrolments; can be changed per student")}>
        <input name="default_monthly_fee" inputMode="numeric" placeholder="850 000" className={inputClass} />
      </FieldLabel>
    </FormDialog>
  );
}
