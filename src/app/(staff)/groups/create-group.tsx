"use client";

import { useState } from "react";
import { FieldLabel } from "@/components/ui/dialog";
import { cn, inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { addCourse, createGroup } from "../actions";
import { todayISO } from "@/lib/dates";

type Opt = { id: string; name: string };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CreateGroup({ courses, branches, mentors }: { courses: Opt[]; branches: Opt[]; mentors: Opt[] }) {
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const today = todayISO();
  const missing = !courses.length ? "Create a course first (Courses tab)." : !branches.length ? "Add a branch first (Branches page)." : null;
  return (
    <FormDialog trigger="Create group" title="Create group" description="A group links one course, one mentor and one weekly rhythm." submitLabel="Create group" action={createGroup}>
      {missing && <p className="rounded-[10px] bg-[#FBEEDC] px-3 py-2.5 text-[12.5px] text-[#9A5B1E]">{missing}</p>}
      <FieldLabel label="Group name"><input name="name" required autoFocus placeholder="IELTS Advanced — Group C" className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label="Course">
          <select name="course_id" required className={inputClass}>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </FieldLabel>
        <FieldLabel label="Branch">
          <select name="branch_id" required className={inputClass}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </FieldLabel>
        <FieldLabel label="Mentor">
          <select name="mentor_id" className={inputClass} defaultValue={mentors[0]?.id ?? ""}>
            <option value="">No mentor yet</option>
            {mentors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Room" hint="Created automatically if new"><input name="room" placeholder="302" className={inputClass} /></FieldLabel>
        <FieldLabel label="Capacity"><input name="capacity" type="number" min={1} defaultValue={18} className={inputClass} /></FieldLabel>
        <FieldLabel label="Start date"><input name="start_date" type="date" defaultValue={today} className={inputClass} /></FieldLabel>
      </div>
      <div>
        <span className="mb-1.5 block text-[11.5px] font-medium text-[#3B4A42]">Schedule</span>
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
                {d}
              </button>
            );
          })}
        </div>
        {days.map((d) => <input key={d} type="hidden" name="weekday" value={d} />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label="Starts"><input name="start_time" type="time" defaultValue="18:00" className={inputClass} /></FieldLabel>
        <FieldLabel label="Ends"><input name="end_time" type="time" defaultValue="20:00" className={inputClass} /></FieldLabel>
      </div>
      <p className="rounded-[10px] bg-[#F5ECE8] px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        The next 12 weeks of lessons are scheduled automatically. If the room or mentor is already booked at that time,
        nothing is saved and you&apos;ll see which day clashes.
      </p>
    </FormDialog>
  );
}

export function CreateCourse() {
  return (
    <FormDialog trigger="Create course" title="Create course" description="A course is the programme a group follows — its level, length and default fee." submitLabel="Create course" action={addCourse} width="max-w-[520px]">
      <FieldLabel label="Course name"><input name="name" required autoFocus placeholder="IELTS Advanced" className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldLabel label="Level">
          <select name="level" className={inputClass} defaultValue="B2">
            <option value="">—</option>
            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l}>{l}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Weeks"><input name="duration_weeks" type="number" min={1} placeholder="12" className={inputClass} /></FieldLabel>
        <FieldLabel label="Code" hint="Optional"><input name="code" placeholder="IELTS-ADV" className={inputClass} /></FieldLabel>
      </div>
      <FieldLabel label="Monthly fee (UZS)" hint="Default for new enrolments; can be changed per student">
        <input name="default_monthly_fee" inputMode="numeric" placeholder="850 000" className={inputClass} />
      </FieldLabel>
    </FormDialog>
  );
}
