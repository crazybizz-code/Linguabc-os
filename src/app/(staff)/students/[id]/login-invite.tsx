"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Loader2, UserPlus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { buttonSecondary } from "@/components/ui/primitives";
import { CopyLink } from "../../staff/invite-staff";
import type { ActionState } from "../../actions";
import { useT } from "@/i18n/client";

/** Creates a student or parent login and shows the personal join link. */
export function LoginInvite({ label, field, value, action, who }: {
  label: string;
  field: "student_id" | "guardian_id";
  value: string;
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  who: string;
}) {
  const [state, run] = useActionState(action, undefined);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const t = useT();
  const close = () => {
    setOpen(false);
    if (state?.ok) router.refresh();
  };
  return (
    <>
      <form action={run} onSubmit={() => setOpen(true)}>
        <input type="hidden" name={field} value={value} />
        <Btn label={label} />
      </form>
      <Dialog open={open && !!state} onClose={close} title={state?.error ? t("Couldn't create the invitation") : t("Invitation ready")} width="max-w-[480px]">
        {state?.error ? (
          <p className="text-[13px] text-[#B4483D]">{t(state.error)}</p>
        ) : (
          <>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {t("Send this personal link to {who} by Telegram or SMS. It works once — they create a password and land straight in their own view.", { who })}
            </p>
            <div className="mt-4"><CopyLink link={state?.link ?? ""} /></div>
          </>
        )}
      </Dialog>
    </>
  );
}

function Btn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${buttonSecondary} h-9 text-[12.5px]`}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" strokeWidth={1.8} />} {label}
    </button>
  );
}
