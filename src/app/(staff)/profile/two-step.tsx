"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Badge, buttonPrimary, buttonSecondary, inputClass } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";
import { confirmMfa, startMfa, stopMfa } from "@/lib/auth/mfa";

/** Turns two-step sign-in (authenticator app) on or off. */
export function TwoStep({ on }: { on: boolean }) {
  const t = useT();
  const router = useRouter();
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (job: () => Promise<{ error?: string }>, after?: () => void) => start(async () => {
    setError(undefined);
    const r = await job();
    if (r.error) setError(t(r.error)); else { after?.(); router.refresh(); }
  });

  if (on) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Badge tone="green">{t("On")}</Badge>
        <span className="flex-1 text-[12.5px] text-muted-foreground">{t("Every sign-in asks for a code from your authenticator app.")}</span>
        <button type="button" disabled={pending} className={buttonSecondary} onClick={() => { if (confirm(t("Turn off two-step sign-in?"))) run(stopMfa); }}>{t("Turn off")}</button>
        {error && <p className="w-full text-[12px] text-[#B4483D]">{error}</p>}
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="mt-3 space-y-2">
        <p className="text-[12.5px] text-muted-foreground">{t("Protect the centre's data: after your password, sign-in also asks for a 6-digit code from an app such as Google Authenticator.")}</p>
        <button type="button" disabled={pending} className={buttonPrimary}
          onClick={() => start(async () => { setError(undefined); const r = await startMfa(); if (r.error || !r.factorId) setError(t(r.error ?? "Something went wrong. Try again.")); else setSetup({ factorId: r.factorId, qr: r.qr!, secret: r.secret! }); })}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {t("Turn on two-step sign-in")}
        </button>
        {error && <p className="text-[12px] text-[#B4483D]">{error}</p>}
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-3">
      <p className="text-[12.5px]">{t("1. Scan this code with your authenticator app (or type the key).")}</p>
      {/* The QR code is an SVG data URL made by Supabase. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt={t("QR code for your authenticator app")} className="h-44 w-44 rounded-[12px] border border-border/70 bg-white p-2" />
      <p className="break-all font-mono text-[11.5px] text-muted-foreground">{setup.secret}</p>
      <p className="text-[12.5px]">{t("2. Enter the 6-digit code the app shows.")}</p>
      <div className="flex flex-wrap gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className={`${inputClass} w-36 font-mono`} />
        <button type="button" disabled={pending || code.length !== 6} className={buttonPrimary} onClick={() => run(() => confirmMfa(setup.factorId, code), () => setSetup(undefined))}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Turn on")}
        </button>
      </div>
      {error && <p className="text-[12px] text-[#B4483D]">{error}</p>}
    </div>
  );
}
