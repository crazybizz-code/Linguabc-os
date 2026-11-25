"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Dialog, FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { recordExpense, voidExpense, type ActionState } from "../actions";
import { CATEGORY_LABEL, EXPENSE_CATEGORIES } from "./categories";
import { useT } from "@/i18n/client";

type Expense = { id: string; spent_on: string; category: string; amount: number; description: string };

/** Record an expense, or (with `corrects`) the corrected version of one. */
export function AddExpense({ today, corrects }: { today: string; corrects?: Expense }) {
  const t = useT();
  return (
    <FormDialog subtle={!!corrects} trigger={corrects ? t("Correct") : t("Record expense")}
      title={corrects ? t("Correct an expense") : t("Record expense")}
      description={corrects
        ? t("The corrected entry replaces the old one. The old one stays in the list as void, so the history is kept.")
        : t("Money the centre paid out: rent, salaries, bills. Expenses are never edited or deleted; a mistake is voided or corrected.")}
      submitLabel={t("Save")} action={recordExpense}>
      {corrects && <input type="hidden" name="corrects" value={corrects.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label={t("Date paid")}><input type="date" name="spent_on" required max={today} defaultValue={corrects?.spent_on ?? today} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Category")}>
          <select name="category" required defaultValue={corrects?.category ?? "rent"} className={inputClass}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_LABEL[c])}</option>)}
          </select>
        </FieldLabel>
      </div>
      <FieldLabel label={t("Amount (UZS)")}><input name="amount" required inputMode="numeric" defaultValue={corrects?.amount ?? ""} placeholder="5 000 000" className={inputClass} /></FieldLabel>
      <FieldLabel label={t("Description")}><input name="description" required minLength={2} maxLength={500} defaultValue={corrects?.description ?? ""} placeholder={t("e.g. December rent, Chilonzor branch")} className={inputClass} /></FieldLabel>
    </FormDialog>
  );
}

export function VoidExpense({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, run] = useActionState(voidExpense, undefined as ActionState);
  const t = useT();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="h-8 rounded-[9px] border border-border/80 px-3 text-[12px] font-medium hover:bg-white">{t("Void")}</button>
      <Dialog open={open && !state?.ok} onClose={() => setOpen(false)} title={t("Void this expense?")} description={label}>
        <form action={run} className="space-y-4">
          <input type="hidden" name="expense_id" value={id} />
          <FieldLabel label={t("Reason")}><input name="reason" required minLength={3} maxLength={300} autoFocus placeholder={t("e.g. entered twice")} className={inputClass} /></FieldLabel>
          {state?.error && <p className="text-[12.5px] text-[#B4483D]">{t(state.error)}</p>}
          <p className="text-[12px] text-muted-foreground">{t("A voided expense stays visible with its reason and no longer counts in the result.")}</p>
          <Submit label={t("Void expense")} />
        </form>
      </Dialog>
    </>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={buttonPrimary}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{label}</button>;
}
