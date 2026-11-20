"use client";

import { useState, useTransition } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { remindPayment } from "../actions";

/** Sends the family an in-app reminder about this fee (once a day at most). */
export function RemindButton({ invoiceId, remindedAt }: { invoiceId: string; remindedAt: string | null }) {
  const t = useT();
  const [sentAt, setSentAt] = useState(remindedAt);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  // eslint-disable-next-line react-hooks/purity -- "today" is checked at render time on purpose
  const today = sentAt != null && Date.now() - new Date(sentAt).getTime() < 86_400_000;
  const when = sentAt ? new Date(sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Tashkent" }) : null;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button type="button" disabled={pending || today} title={error ? t(error) : undefined}
        onClick={() => start(async () => {
          setError(undefined);
          const r = await remindPayment(invoiceId);
          if (r.error) setError(r.error);
          else setSentAt(new Date().toISOString());
        })}
        className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-border/80 bg-[#FCF8F4] px-2.5 text-[12px] font-medium text-[#17211D] hover:bg-white disabled:opacity-60">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : today ? <Check className="h-3.5 w-3.5" /> : <BellRing className="h-3.5 w-3.5" />}
        {today ? t("Reminded") : t("Remind")}
      </button>
      {when && <span className="text-[10.5px] text-muted-foreground">{t("Last reminder {date}", { date: when })}</span>}
      {error && <span className="max-w-[160px] text-right text-[10.5px] text-[#B4483D]">{t(error)}</span>}
    </span>
  );
}
