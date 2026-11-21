"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { buttonPrimary, inputClass } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";
import { renameCentre } from "../actions";

export function CentreName({ name, canEdit }: { name: string; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [msg, setMsg] = useState<{ ok?: boolean; error?: string }>();
  const [pending, start] = useTransition();
  if (!canEdit) return <p className="text-[18px] font-semibold">{name}</p>;
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await renameCentre(value); setMsg(r.error ? r : { ok: true }); if (!r.error) router.refresh(); }); }}>
      <input value={value} onChange={(e) => setValue(e.target.value)} minLength={2} maxLength={120} className={`${inputClass} min-w-[220px] flex-1`} aria-label={t("Centre name")} />
      <button disabled={pending || value.trim() === name || value.trim().length < 2} className={buttonPrimary}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save")}</button>
      {msg?.error && <p className="w-full text-[12px] text-[#B4483D]">{t(msg.error)}</p>}
      {msg?.ok && <p className="w-full text-[12px] text-[#3F6B4A]">{t("Saved.")}</p>}
    </form>
  );
}
