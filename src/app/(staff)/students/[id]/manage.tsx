"use client";

import { FieldLabel } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { endEnrollment, saveGuardian, transferStudent, updateStudent } from "../../actions";
import { todayISO } from "@/lib/dates";
import { useT } from "@/i18n/client";

type Student = { id: string; full_name: string; phone: string | null; email: string | null; date_of_birth: string | null; branch_id: string | null; notes: string | null };
type Guardian = { id: string; full_name: string; phone: string | null; relationship: string | null; is_primary: boolean };
type Opt = { id: string; name: string };

/** Owner/admin: edit the student's own details (update_student, 0035). */
export function EditStudent({ s, branches }: { s: Student; branches: Opt[] }) {
  const t = useT();
  return (
    <FormDialog subtle trigger={t("Edit details")} title={t("Edit student")} submitLabel={t("Save")} action={updateStudent}>
      <input type="hidden" name="student_id" value={s.id} />
      <FieldLabel label={t("Full name")}><input name="full_name" required minLength={2} defaultValue={s.full_name} className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label={t("Phone")}><input name="phone" type="tel" defaultValue={s.phone ?? ""} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Email")} hint={t("Optional")}><input name="email" type="email" defaultValue={s.email ?? ""} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Date of birth")} hint={t("Optional")}><input name="date_of_birth" type="date" defaultValue={s.date_of_birth ?? ""} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Branch")}>
          <select name="branch_id" defaultValue={s.branch_id ?? ""} className={inputClass}>
            <option value="">—</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FieldLabel>
      </div>
      <FieldLabel label={t("Notes")} hint={t("Optional")}><textarea name="notes" rows={2} maxLength={1000} defaultValue={s.notes ?? ""} className={inputClass} /></FieldLabel>
    </FormDialog>
  );
}

/** Owner/admin: add a parent (no `g`) or edit one (save_guardian, 0035). */
export function GuardianForm({ studentId, g }: { studentId: string; g?: Guardian }) {
  const t = useT();
  return (
    <FormDialog subtle trigger={g ? t("Edit") : t("Add parent")} title={g ? t("Edit parent") : t("Add parent")} submitLabel={t("Save")} action={saveGuardian}>
      <input type="hidden" name="student_id" value={studentId} />
      {g && <input type="hidden" name="guardian_id" value={g.id} />}
      <FieldLabel label={t("Parent or guardian name")}><input name="full_name" required minLength={2} defaultValue={g?.full_name ?? ""} className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label={t("Parent phone")}><input name="phone" type="tel" defaultValue={g?.phone ?? ""} placeholder="+998 90 000 00 00" className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Relationship")}>
          <select name="relationship" defaultValue={g?.relationship ?? "mother"} className={inputClass}>
            {["mother", "father", "guardian", "other"].map((r) => <option key={r} value={r}>{t(r[0].toUpperCase() + r.slice(1))}</option>)}
          </select>
        </FieldLabel>
      </div>
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" name="is_primary" defaultChecked={g?.is_primary ?? false} className="accent-[#12392B]" /> {t("Main contact")}</label>
    </FormDialog>
  );
}

/** Owner/admin: move to another group in one step (transfer_student, 0035). */
export function MoveGroup({ studentId, enrollmentId, groups }: { studentId: string; enrollmentId: string; groups: Opt[] }) {
  const t = useT();
  return (
    <FormDialog subtle trigger={t("Move to another group")} title={t("Move to another group")}
      description={t("The current group ends on this date and the new one starts. A month already billed is not billed again.")}
      submitLabel={t("Move")} action={transferStudent}>
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="enrollment_id" value={enrollmentId} />
      <FieldLabel label={t("New group")}>
        <select name="to_group" required className={inputClass} defaultValue="">
          <option value="" disabled>{t("Choose a group")}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </FieldLabel>
      <FieldLabel label={t("Date of the move")} hint={t("Today or an earlier day; a move cannot be scheduled ahead.")}><input name="date" type="date" required max={todayISO()} defaultValue={todayISO()} className={inputClass} /></FieldLabel>
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" name="keep_fee" defaultChecked className="accent-[#12392B]" /> {t("Keep the current monthly fee and discount")}</label>
    </FormDialog>
  );
}

/** Owner/admin: take the student out of the group (end_enrollment, 0035). */
export function LeaveGroup({ studentId, enrollmentId, group }: { studentId: string; enrollmentId: string; group: string }) {
  const t = useT();
  return (
    <FormDialog subtle trigger={t("Remove from group")} title={t("Remove from {group}", { group })}
      description={t("Invoices already issued stay; void one on the Payments page if it should not be paid. No new invoices are issued for this group.")}
      submitLabel={t("Remove")} action={endEnrollment}>
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="enrollment_id" value={enrollmentId} />
      <FieldLabel label={t("Why")}>
        <select name="status" defaultValue="dropped" className={inputClass}>
          <option value="dropped">{t("Left the centre")}</option>
          <option value="completed">{t("Finished the course")}</option>
          <option value="paused">{t("Taking a break")}</option>
        </select>
      </FieldLabel>
      <FieldLabel label={t("Last day")}><input name="end_date" type="date" required defaultValue={todayISO()} className={inputClass} /></FieldLabel>
      <FieldLabel label={t("Note")} hint={t("Optional")}><input name="reason" maxLength={300} className={inputClass} /></FieldLabel>
    </FormDialog>
  );
}
