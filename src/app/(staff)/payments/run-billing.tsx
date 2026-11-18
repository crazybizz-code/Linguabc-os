"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, ReceiptText } from "lucide-react";
import { buttonSecondary } from "@/components/ui/primitives";
import { runMonthlyInvoices } from "../actions";
import { useT } from "@/i18n/client";

export function RunBilling({ period, label }: { period: string; label: string }) {
  const [state, action] = useActionState(runMonthlyInvoices, undefined);
  const t = useT();
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="period" value={period} />
      {state?.ok && <span className="text-[12px] text-[#3F6B4A]">{state.link === "0" ? t("Everyone is already billed") : t("{n} invoices created", { n: state.link })}</span>}
      {state?.error && <span className="text-[12px] text-[#B4483D]">{t(state.error)}</span>}
      <Btn label={label} />
    </form>
  );
}

function Btn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button type="submit" disabled={pending} className={buttonSecondary}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" strokeWidth={1.8} />} {t("Bill {month}", { month: label })}
    </button>
  );
}
