"use client";

import Link from "next/link";
import { FieldLabel } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { assignLibraryItem } from "../../../actions";
import { useT } from "@/i18n/client";

export function AssignDialog({ itemId, groups, defaultDue }: { itemId: string; groups: { id: string; name: string }[]; defaultDue: string }) {
  const t = useT();
  return (
    <FormDialog trigger={t("Assign to a group")} title={t("Assign to a group")} submitLabel={t("Assign")} action={assignLibraryItem} width="max-w-[520px]"
      description={t("Everyone in the group gets it straight away in their student portal.")}
      success={(s) => (
        <div className="space-y-3 text-[13px]">
          <p className="rounded-[10px] bg-[#E7EFE4] px-3.5 py-3 text-[#3F6B4A]">{t("Assigned. Students can start now.")}</p>
          {s.id && <Link href={`/homework/${s.id}`} className="font-medium text-[#12392B] underline">{t("Track submissions")}</Link>}
        </div>
      )}>
      <input type="hidden" name="item_id" value={itemId} />
      {!groups.length && <p className="rounded-[10px] bg-[#FBEEDC] px-3 py-2.5 text-[12.5px] text-[#9A5B1E]">{t("You don't have any active groups yet.")}</p>}
      <FieldLabel label={t("Group")}>
        <select name="group_id" required className={inputClass}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
      </FieldLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label={t("Due date")}><input name="due_date" type="date" required defaultValue={defaultDue} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Due time")}><input name="due_time" type="time" defaultValue="23:59" className={inputClass} /></FieldLabel>
      </div>
      <FieldLabel label={t("Note for students")} hint={t("Optional")}>
        <textarea name="note" rows={3} maxLength={2000} placeholder={t("e.g. Read it twice before answering.")} className={`${inputClass} h-auto py-2`} />
      </FieldLabel>
    </FormDialog>
  );
}
