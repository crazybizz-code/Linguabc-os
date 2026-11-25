"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Link2, Loader2, Send, Unlink, UserPlus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Badge, buttonSecondary } from "@/components/ui/primitives";
import { CopyLink } from "../staff/invite-staff";
import { attachGuardianToParent, issueTelegramLink, revokeTelegramLink, type ActionState } from "../actions";
import { useT } from "@/i18n/client";

export type TelegramStatus = "linked" | "blocked" | "none";

/**
 * Telegram for one family: status, a one-time link (24 hours, single use),
 * disconnect, and adding another child to the same parent account. The
 * database decides who may do this (owner and admin of the centre).
 */
export function TelegramCell({ guardianId, membershipId, status, linkedAt, attachable, botReady }: {
  guardianId: string;
  membershipId: string | null;
  status: TelegramStatus;
  linkedAt: string | null;
  attachable: { guardianId: string; child: string }[];
  botReady: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      {status === "none" ? (
        botReady ? <IssueLink guardianId={guardianId} label={t("Telegram link")} /> : <Badge tone="neutral">{t("Telegram bot not set up")}</Badge>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status === "blocked" ? "amber" : "green"}>{t(status === "blocked" ? "Telegram: bot blocked" : "Telegram connected")}</Badge>
          {linkedAt && <span className="text-[11px] text-muted-foreground">{new Date(linkedAt).toLocaleDateString("en-GB")}</span>}
          {membershipId && <Revoke membershipId={membershipId} />}
          {botReady && <IssueLink guardianId={guardianId} label={t("New link")} small />}
        </div>
      )}
      {membershipId && attachable.map((a) => <Attach key={a.guardianId} guardianId={a.guardianId} membershipId={membershipId} child={a.child} />)}
    </div>
  );
}

function IssueLink({ guardianId, label, small }: { guardianId: string; label: string; small?: boolean }) {
  const [state, run] = useActionState(issueTelegramLink, undefined);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const t = useT();
  return (
    <>
      <form action={run} onSubmit={() => setOpen(true)}>
        <input type="hidden" name="guardian_id" value={guardianId} />
        <Submit icon={small ? Link2 : Send} label={label} small={small} />
      </form>
      <Dialog open={open && !!state} onClose={() => { setOpen(false); router.refresh(); }}
        title={state?.error ? t("Couldn't create the link") : t("Telegram link ready")} width="max-w-[480px]">
        {state?.error ? <p className="text-[13px] text-[#B4483D]">{t(state.error)}</p> : (
          <>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {t("Give this link to the parent in person or by SMS. It opens the LinguABC bot on their phone and works once, for 24 hours. A new link cancels the old one.")}
            </p>
            <div className="mt-4"><CopyLink link={state?.link ?? ""} /></div>
          </>
        )}
      </Dialog>
    </>
  );
}

function Revoke({ membershipId }: { membershipId: string }) {
  const [state, run] = useActionState(revokeTelegramLink, undefined as ActionState);
  const t = useT();
  return (
    <form action={run} onSubmit={(e) => { if (!confirm(t("Disconnect this parent's Telegram? They will need a new link to connect again."))) e.preventDefault(); }}>
      <input type="hidden" name="membership_id" value={membershipId} />
      <Submit icon={Unlink} label={t("Disconnect")} small />
      {state?.error && <p className="mt-1 text-[11.5px] text-[#B4483D]">{t(state.error)}</p>}
    </form>
  );
}

function Attach({ guardianId, membershipId, child }: { guardianId: string; membershipId: string; child: string }) {
  const [state, run] = useActionState(attachGuardianToParent, undefined as ActionState);
  const t = useT();
  if (state?.ok) return null;
  return (
    <form action={run} onSubmit={(e) => { if (!confirm(t("Add {child} to this parent's account? The parent will see this child in Telegram.", { child }))) e.preventDefault(); }}>
      <input type="hidden" name="guardian_id" value={guardianId} />
      <input type="hidden" name="membership_id" value={membershipId} />
      <Submit icon={UserPlus} label={t("Add {child} to this account", { child })} small />
      {state?.error && <p className="mt-1 text-[11.5px] text-[#B4483D]">{t(state.error)}</p>}
    </form>
  );
}

function Submit({ icon: Icon, label, small }: { icon: typeof Send; label: string; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`${buttonSecondary} ${small ? "h-7 px-2.5 text-[11.5px]" : "h-9 text-[12.5px]"}`}>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />} {label}
    </button>
  );
}
