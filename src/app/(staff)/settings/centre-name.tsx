"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, inputClass } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";
import { updateCenterSettings, type ActionState } from "../actions";

export type Centre = { name: string; phone: string | null; address: string | null; timezone: string };

/** Owner: name, contact and time zone (update_center_settings, 0038). Others read only. */
export function CentreSettings({ c, canEdit }: { c: Centre; canEdit: boolean }) {
  const t = useT();
  const [state, run] = useActionState(updateCenterSettings, undefined as ActionState);
  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="text-[18px] font-semibold">{c.name}</p>
        <p className="text-[12.5px] text-muted-foreground">{[c.phone, c.address].filter(Boolean).join(" · ") || "—"}</p>
      </div>
    );
  }
  return (
    <form action={run} className="space-y-3">
      <FieldLabel label={t("Centre name")}><input name="name" required minLength={2} maxLength={120} defaultValue={c.name} className={inputClass} /></FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label={t("Phone")} hint={t("Shown to parents in the Telegram bot")}><input name="phone" type="tel" maxLength={32} defaultValue={c.phone ?? ""} placeholder="+998 71 200 00 00" className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Time zone")} hint={t("Uzbekistan, UTC+5")}>
          <select name="timezone" defaultValue={c.timezone} className={inputClass}>
            {["Asia/Tashkent", "Asia/Samarkand"].map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </FieldLabel>
      </div>
      <FieldLabel label={t("Address")} hint={t("Shown to parents in the Telegram bot")}><input name="address" maxLength={300} defaultValue={c.address ?? ""} placeholder="Chilonzor 9, Tashkent" className={inputClass} /></FieldLabel>
      <div className="flex items-center gap-3">
        <Submit label={t("Save")} />
        {state?.error && <p className="text-[12px] text-[#B4483D]">{t(state.error)}</p>}
        {state?.ok && <p className="text-[12px] text-[#3F6B4A]">{t("Saved.")}</p>}
      </div>
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={buttonPrimary}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} {label}</button>;
}
