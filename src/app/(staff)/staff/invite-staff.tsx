"use client";

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { cn, inputClass } from "@/components/ui/primitives";
import { FormDialog } from "@/components/workspace/form-dialog";
import { inviteStaff } from "../actions";
import { useT } from "@/i18n/client";

const ROLES = [
  { value: "admin", label: "Administrator", hint: "Students, payments, staff — everything except ownership", ownerOnly: true },
  { value: "academic_manager", label: "Academic Manager", hint: "Groups, homework, mocks and progress — no payments" },
  { value: "mentor", label: "Mentor", hint: "Only the groups they teach and those students" },
];

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-border/80 bg-white/70 p-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[#3B4A42]">{link}</span>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] bg-[#12392B] px-3 text-[12px] font-medium text-[#FAF5EF]"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t("Copied") : t("Copy")}
      </button>
    </div>
  );
}

export function InviteStaff({ isOwner, branches }: { isOwner: boolean; branches: { id: string; name: string }[] }) {
  const [role, setRole] = useState("mentor");
  const t = useT();
  return (
    <FormDialog
      trigger={t("Invite staff")}
      title={t("Invite staff")}
      description={t("The role is assigned here. The person cannot choose or change it when they join.")}
      submitLabel={t("Create invitation")}
      action={inviteStaff}
      width="max-w-[500px]"
      success={(s) => (
        <div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E7EFE4]">
            <Send className="h-5 w-5 text-[#3F6B4A]" strokeWidth={1.8} />
          </div>
          <p className="mt-4 text-[15px] font-semibold">{t("Invitation ready")}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {t("Send this personal link by Telegram, SMS or email. It works once — the person creates a password and lands in their workspace with the role you chose.")}
          </p>
          <div className="mt-4"><CopyLink link={s.link!} /></div>
        </div>
      )}
    >
      <FieldLabel label={t("Full name")}><input name="full_name" required autoFocus placeholder="Nilufar Yusupova" className={inputClass} /></FieldLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label={t("Email")} hint={t("Optional — pre-fills their sign-up")}><input name="email" type="email" placeholder="name@centre.uz" className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Phone")} hint={t("Optional")}><input name="phone" type="tel" placeholder="+998 90 000 00 00" className={inputClass} /></FieldLabel>
      </div>
      {branches.length > 1 && (
        <FieldLabel label={t("Branch")} hint={t("Optional")}>
          <select name="branch_id" className={inputClass} defaultValue="">
            <option value="">{t("All branches")}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </FieldLabel>
      )}
      <div>
        <span className="mb-1.5 block text-[11.5px] font-medium text-[#3B4A42]">{t("Role")}</span>
        <input type="hidden" name="role" value={role} />
        <div className="space-y-2">
          {ROLES.filter((r) => isOwner || !r.ownerOnly).map((r) => (
            <button
              type="button"
              key={r.value}
              onClick={() => setRole(r.value)}
              className={cn(
                "flex w-full items-center justify-between rounded-[10px] border px-3.5 py-2.5 text-left transition-colors",
                role === r.value ? "border-[#12392B] bg-[#F5ECE8]" : "border-border/80 hover:bg-white",
              )}
            >
              <span>
                <span className="block text-[13px] font-medium">{t(r.label)}</span>
                <span className="block text-[11.5px] text-muted-foreground">{t(r.hint)}</span>
              </span>
              {role === r.value && <Check className="h-4 w-4 text-[#12392B]" />}
            </button>
          ))}
        </div>
      </div>
    </FormDialog>
  );
}
