"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { buttonPrimary } from "@/components/ui/primitives";
import { approveAssignment } from "../../../actions";
import { useT } from "@/i18n/client";

export function ApproveButton({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-[12.5px] text-[#B4483D]">{error}</span>}
      <button type="button" disabled={pending} className={buttonPrimary}
        onClick={() => start(async () => { const r = await approveAssignment(id); if (r?.error) setError(t(r.error)); else router.refresh(); })}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("Approve")}
      </button>
    </div>
  );
}
