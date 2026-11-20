"use client";

import { useActionState } from "react";
import { FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, inputClass } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";
import { changePassword } from "../actions";

export function PasswordForm() {
  const t = useT();
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="mt-4 space-y-3">
      <FieldLabel label={t("Current password")}><input name="current" type="password" autoComplete="current-password" required className={inputClass} /></FieldLabel>
      <FieldLabel label={t("New password")}><input name="password" type="password" autoComplete="new-password" minLength={8} required className={inputClass} /></FieldLabel>
      <FieldLabel label={t("Confirm")}><input name="confirm" type="password" autoComplete="new-password" minLength={8} required className={inputClass} /></FieldLabel>
      {state?.error && <p className="text-[12.5px] text-[#B4483D]">{t(state.error)}</p>}
      {state?.ok && <p className="text-[12.5px] text-[#3F6B4A]">{t("Password changed.")}</p>}
      <button disabled={pending} className={buttonPrimary}>{t("Save")}</button>
    </form>
  );
}
