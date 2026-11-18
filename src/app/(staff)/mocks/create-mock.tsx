"use client";

import { useState } from "react";
import { FieldLabel } from "@/components/ui/dialog";
import { cn, inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { createMockSession } from "../actions";
import { todayISO } from "@/lib/dates";
import { useT } from "@/i18n/client";

type Group = { id: string; name: string; branch_id: string; mentor_id: string | null; room_id: string | null };
type Opt = { id: string; name: string };
type Room = Opt & { branch_id: string };
const MODULES = ["reading", "listening", "writing", "speaking"] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function CreateMock({ groups, managers, mentors, rooms }: { groups: Group[]; managers: Opt[]; mentors: Opt[]; rooms: Room[] }) {
  const t = useT();
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [modules, setModules] = useState<string[]>([...MODULES]);
  const group = groups.find((g) => g.id === groupId);
  // Examiner: a manager, or this group's own mentor (they already see its students).
  const examiners = [...(group?.mentor_id ? mentors.filter((m) => m.id === group.mentor_id) : []), ...managers];
  const groupRooms = rooms.filter((r) => r.branch_id === group?.branch_id);

  return (
    <FormDialog trigger={t("Create mock session")} title={t("Create mock session")}
      description={t("One session, one set of results everyone is measured against.")} submitLabel={t("Create mock session")} action={createMockSession}>
      {!groups.length && <p className="rounded-[10px] bg-[#FBEEDC] px-3 py-2.5 text-[12.5px] text-[#9A5B1E]">{t("Create a group first (Groups page).")}</p>}
      <FieldLabel label={t("Session name")}><input name="name" required autoFocus placeholder="Saturday Full IELTS Mock" className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label={t("Group")}>
          <select name="group_id" required className={inputClass} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label={t("Mock version")} hint={t("Optional")}><input name="version" placeholder="Cambridge 19 · Test 3" className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Date")}><input name="date" type="date" required defaultValue={todayISO()} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Starts")}><input name="time" type="time" required defaultValue="09:00" className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Examiner")} hint={t("A manager or the group's mentor")}>
          <select key={groupId} name="examiner_id" className={inputClass} defaultValue={examiners[0]?.id ?? ""}>
            <option value="">{t("Not assigned")}</option>
            {examiners.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label={t("Room")}>
          <select key={`r${groupId}`} name="room_id" className={inputClass} defaultValue={group?.room_id ?? ""}>
            <option value="">{t("No room")}</option>
            {groupRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </FieldLabel>
      </div>
      <div>
        <span className="mb-1.5 block text-[11.5px] font-medium text-[#3B4A42]">{t("Modules")}</span>
        <div className="flex flex-wrap gap-2">
          {MODULES.map((m) => {
            const on = modules.includes(m);
            return (
              <button key={m} type="button" onClick={() => setModules((xs) => (on ? xs.filter((x) => x !== m) : [...xs, m]))}
                className={cn("h-9 rounded-[9px] border px-3 text-[12.5px] font-medium", on ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80 text-[#3B4A42] hover:bg-white")}>
                {t(cap(m))}
              </button>
            );
          })}
        </div>
        {modules.map((m) => <input key={m} type="hidden" name="module" value={m} />)}
      </div>
      <p className="rounded-[10px] bg-[#F5ECE8] px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        {t("Everyone currently in the group is added as a participant. Results are entered once on the session page and flow into each student's record and the parent portal.")}
      </p>
    </FormDialog>
  );
}
