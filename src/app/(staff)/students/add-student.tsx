"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Plus, UserPlus } from "lucide-react";
import { Dialog, FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, buttonSecondary, cn, formatUZS, inputClass } from "@/components/ui/primitives";
import { FormError } from "@/components/workspace/form-dialog";
import { addStudent } from "../actions";
import { useT } from "@/i18n/client";

export type GroupOption = { id: string; name: string; courseName: string; fee: number; seatsLeft: number | null };
const STEPS = ["Personal", "Learning", "Parent", "Payment", "Review"] as const;

export function AddStudent({ groups, branches }: { groups: GroupOption[]; branches: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const t = useT();
  return (
    <>
      <button type="button" className={buttonPrimary} onClick={() => { setKey((k) => k + 1); setOpen(true); }}>
        <Plus className="h-4 w-4" /> {t("Add student")}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("Add student")} description={t("One record, created once — every module reads from it.")}>
        <Wizard key={key} groups={groups} branches={branches} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function Wizard({ groups, branches, onClose }: { groups: GroupOption[]; branches: { id: string; name: string }[]; onClose: () => void }) {
  const [state, action] = useActionState(addStudent, undefined);
  const [step, setStep] = useState(0);
  const t = useT();
  const [v, setV] = useState({
    full_name: "", phone: "", email: "", date_of_birth: "",
    group_id: "", branch_id: "",
    parent_name: "", parent_phone: "", parent_relationship: "mother",
    monthly_fee: "", discount_percent: "0", due_day: "5",
  });
  const formRef = useRef<HTMLFormElement>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const group = groups.find((g) => g.id === v.group_id);
  const fee = Number(v.monthly_fee.replace(/\D/g, "")) || group?.fee || 0;
  const monthly = Math.round((fee * (100 - (Number(v.discount_percent) || 0))) / 100);

  if (state?.ok) {
    return (
      <div className="flex flex-col items-center py-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E7EFE4]"><Check className="h-6 w-6 text-[#3F6B4A]" strokeWidth={2.2} /></div>
        <p className="mt-4 text-[15px] font-semibold">{t("{name} is enrolled", { name: v.full_name })}</p>
        <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">
          {group ? t("Added to {group}. The first invoice of {amount} was created.", { group: group.name, amount: formatUZS(monthly) }) : t("Saved as a lead — add them to a group when they start.")}
        </p>
        <button type="button" onClick={onClose} className={cn(buttonPrimary, "mt-5")}>{t("Done")}</button>
      </div>
    );
  }

  const canNext = step !== 0 || v.full_name.trim().length >= 2;
  return (
    <form ref={formRef} action={action}>
      <ol className="mb-5 grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => (
          <li key={s}>
            <div className={cn("h-[3px] rounded-full", i <= step ? "bg-[#12392B]" : "bg-[#E6DCD3]")} />
            <p className={cn("mt-1.5 text-[11px]", i === step ? "font-medium text-[#17211D]" : "text-muted-foreground")}>{t(s)}</p>
          </li>
        ))}
      </ol>
      <FormError message={state?.error ? t(state.error) : undefined} />
      {Object.entries(v).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}

      {step === 0 && (
        <div className="space-y-4">
          <FieldLabel label={t("Full name")}><input autoFocus value={v.full_name} onChange={set("full_name")} placeholder="Bekzod Karimov" className={inputClass} /></FieldLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label={t("Phone")}><input type="tel" value={v.phone} onChange={set("phone")} placeholder="+998 90 000 00 00" className={inputClass} /></FieldLabel>
            <FieldLabel label={t("Email")} hint={t("Optional")}><input type="email" value={v.email} onChange={set("email")} placeholder="name@mail.uz" className={inputClass} /></FieldLabel>
            <FieldLabel label={t("Date of birth")} hint={t("Optional")}><input type="date" value={v.date_of_birth} onChange={set("date_of_birth")} className={inputClass} /></FieldLabel>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <FieldLabel label={t("Group")} hint={t("Leave empty to save as a lead and enrol later")}>
            <select value={v.group_id} onChange={set("group_id")} className={inputClass}>
              <option value="">{t("No group yet (lead)")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id} disabled={g.seatsLeft === 0}>
                  {g.name} · {g.courseName}{g.seatsLeft === 0 ? ` · ${t("full")}` : g.seatsLeft != null ? ` · ${t("{n} seats left", { n: g.seatsLeft })}` : ""}
                </option>
              ))}
            </select>
          </FieldLabel>
          {!v.group_id && branches.length > 0 && (
            <FieldLabel label={t("Branch")}>
              <select value={v.branch_id} onChange={set("branch_id")} className={inputClass}>
                <option value="">—</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </FieldLabel>
          )}
          {groups.length === 0 && <p className="rounded-[10px] bg-[#FBEEDC] px-3 py-2.5 text-[12.5px] text-[#9A5B1E]">{t("No groups yet — the student will be saved as a lead.")}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <FieldLabel label={t("Parent or guardian name")} hint={t("Optional — needed for the parent portal")}><input value={v.parent_name} onChange={set("parent_name")} placeholder="Karim Karimov" className={inputClass} /></FieldLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label={t("Parent phone")}><input type="tel" value={v.parent_phone} onChange={set("parent_phone")} placeholder="+998 90 000 00 00" className={inputClass} /></FieldLabel>
            <FieldLabel label={t("Relationship")}>
              <select value={v.parent_relationship} onChange={set("parent_relationship")} className={inputClass}>
                {["mother", "father", "guardian", "other"].map((r) => <option key={r} value={r}>{t(r[0].toUpperCase() + r.slice(1))}</option>)}
              </select>
            </FieldLabel>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {!group && <p className="rounded-[10px] bg-[#F5ECE8] px-3 py-2.5 text-[12.5px] text-muted-foreground">{t("Payment terms apply once the student joins a group.")}</p>}
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldLabel label={t("Monthly fee (UZS)")} hint={group ? t("Course default {amount}", { amount: formatUZS(group.fee) }) : undefined}>
              <input inputMode="numeric" value={v.monthly_fee} onChange={set("monthly_fee")} placeholder={group ? group.fee.toLocaleString("en-US") : "0"} disabled={!group} className={inputClass} />
            </FieldLabel>
            <FieldLabel label={t("Discount %")}><input type="number" min={0} max={100} value={v.discount_percent} onChange={set("discount_percent")} disabled={!group} className={inputClass} /></FieldLabel>
            <FieldLabel label={t("Due day")} hint={t("Day of month")}><input type="number" min={1} max={28} value={v.due_day} onChange={set("due_day")} disabled={!group} className={inputClass} /></FieldLabel>
          </div>
          {group && <p className="text-[12.5px] text-[#3B4A42]">{t("Monthly invoice:")} <span className="font-semibold">{formatUZS(monthly)}</span></p>}
        </div>
      )}

      {step === 4 && (
        <dl className="divide-y divide-border/60 rounded-[12px] border border-border/70 text-[12.5px]">
          {[
            [t("Student"), `${v.full_name}${v.phone ? ` · ${v.phone}` : ""}`],
            [t("Group"), group ? `${group.name} · ${group.courseName}` : t("No group (lead)")],
            [t("Parent"), v.parent_name ? `${v.parent_name}${v.parent_phone ? ` · ${v.parent_phone}` : ""} (${t(v.parent_relationship[0].toUpperCase() + v.parent_relationship.slice(1))})` : "—"],
            [t("Payment"), group ? t("{amount} / month · due on day {d}", { amount: formatUZS(monthly), d: v.due_day }) : "—"],
          ].map(([k, val]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{val}</dd></div>
          ))}
        </dl>
      )}

      <div className="mt-6 flex justify-between gap-2 border-t border-border/60 pt-4">
        <button type="button" onClick={() => (step ? setStep(step - 1) : onClose())} className={buttonSecondary}>{step ? t("Back") : t("Cancel")}</button>
        {step < STEPS.length - 1 ? (
          <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)} className={buttonPrimary}>{t("Continue")}</button>
        ) : (
          <SaveButton />
        )}
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button type="submit" disabled={pending} className={buttonPrimary}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t("Add student")}
    </button>
  );
}
