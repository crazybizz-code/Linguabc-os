"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { markNotificationsRead } from "../notifications";

export function MarkAllRead() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await markNotificationsRead(); router.refresh(); })}
      className="text-[12px] font-medium text-[#12392B] hover:underline disabled:opacity-60">{t("Mark all as read")}</button>
  );
}
