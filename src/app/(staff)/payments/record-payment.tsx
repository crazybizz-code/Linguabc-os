"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Printer } from "lucide-react";
import { Dialog, FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, buttonSecondary, cn, formatUZS, inputClass } from "@/components/ui/primitives";
import { FormError } from "@/components/workspace/form-dialog";
import { recordPayment } from "../actions";
import { useT } from "@/i18n/client";

// Online providers (Click, Payme) arrive in V2 — shown, but not selectable yet.
const METHODS = [
  ["cash", "Cash", false],
  ["card", "Card", false],
  ["bank_transfer", "Bank transfer", false],
  ["uzum", "Uzum", false],
  ["click", "Click", true],
  ["payme", "Payme", true],
] as const;

export function RecordPayment({ invoiceId, student, balance, period, compact }: { invoiceId: string; student: string; balance: number; period: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const t = useT();
  return (
    <>
      <button
        type="button"
        onClick={() => { setKey((k) => k + 1); setOpen(true); }}
        className={compact ? "h-7 rounded-[8px] bg-[#12392B] px-2.5 text-[11.5px] font-medium text-[#FAF5EF] hover:bg-[#0D3024]" : buttonPrimary}
      >
        {compact ? t("Record") : t("Record payment")}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("Record payment")} description={`${student} · ${period}`} width="max-w-[460px]">
        <Form key={key} invoiceId={invoiceId} balance={balance} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function Form({ invoiceId, balance, onClose }: { invoiceId: string; balance: number; onClose: () => void }) {
  const [state, action] = useActionState(recordPayment, undefined);
  const [method, setMethod] = useState("cash");
  const t = useT();
  if (state?.ok) {
    return (
      <div className="flex flex-col items-center py-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E7EFE4]"><Check className="h-6 w-6 text-[#3F6B4A]" strokeWidth={2.2} /></div>
        <p className="mt-4 text-[15px] font-semibold">{t("Payment recorded")}</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{t("Receipt")} <span className="font-mono font-medium text-[#17211D]">{state.link}</span></p>
        <div className="mt-5 flex gap-2">
          <Link href={`/payments/receipt/${state.id}`} target="_blank" className={buttonSecondary}><Printer className="h-4 w-4" /> {t("Print receipt")}</Link>
          <button type="button" onClick={onClose} className={buttonPrimary}>{t("Done")}</button>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <FormError message={state?.error ? t(state.error) : undefined} />
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="method" value={method} />
      <FieldLabel label={t("Amount received (UZS)")} hint={t("Outstanding: {amount}", { amount: formatUZS(balance) })}>
        <input name="amount" inputMode="numeric" autoFocus defaultValue={balance.toLocaleString("en-US")} className={inputClass} />
      </FieldLabel>
      <div>
        <span className="mb-1.5 block text-[11.5px] font-medium text-[#3B4A42]">{t("Method")}</span>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map(([v, label, soon]) => (
            <button key={v} type="button" disabled={soon} onClick={() => setMethod(v)} title={soon ? t("Online payments are coming soon") : undefined}
              className={cn("relative h-9 rounded-[9px] border text-[12.5px] font-medium",
                soon ? "cursor-not-allowed border-dashed border-border/80 text-muted-foreground/60"
                  : method === v ? "border-[#12392B] bg-[#12392B] text-[#FAF5EF]" : "border-border/80 text-[#3B4A42] hover:bg-white")}>
              {t(label)}
              {soon && <span className="ml-1 text-[9.5px] font-normal">· {t("Soon")}</span>}
            </button>
          ))}
        </div>
      </div>
      <FieldLabel label={t("Note")} hint={t("Optional")}><input name="note" placeholder={t("e.g. paid by father")} className={inputClass} /></FieldLabel>
      <p className="rounded-[10px] bg-[#F5ECE8] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
        {t("Payments can't be edited or deleted once recorded — mistakes are corrected with a refund by the owner. A numbered receipt is issued automatically.")}
      </p>
      <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
        <button type="button" onClick={onClose} className="h-10 rounded-[11px] px-4 text-[13px] text-[#3B4A42] hover:bg-[#EFE6DF]">{t("Cancel")}</button>
        <Save />
      </div>
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  const t = useT();
  return <button type="submit" disabled={pending} className={buttonPrimary}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Record payment")}</button>;
}
