"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, MailCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const inputBase =
  "h-11 w-full rounded-[10px] border border-border/80 bg-[#FCF8F4] text-[13px] text-[#17211D] placeholder:text-muted-foreground/60 focus:border-[#12392B]/35 focus:outline-none focus:ring-2 focus:ring-[#12392B]/8 transition";

export function Field({
  label,
  hint,
  action,
  icon: Icon,
  ...input
}: { label: string; hint?: string; action?: ReactNode; icon?: LucideIcon } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[11.5px] font-medium text-muted-foreground">
        {label}
        {action}
      </span>
      <span className="relative block">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70"
            strokeWidth={1.8}
          />
        )}
        <input className={`${inputBase} ${Icon ? "pl-10 pr-3" : "px-3"}`} {...input} />
      </span>
      {hint && <span className="mt-1 block text-[10.5px] text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ children, pending }: { children: ReactNode; pending: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={isPending}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-[#12392B] text-[13px] font-medium text-[#FAF5EF] transition-colors hover:bg-[#0D3024] disabled:opacity-60"
    >
      {isPending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {pending}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-[12px] leading-relaxed text-destructive">
      {message}
    </div>
  );
}

export function CheckEmail({ email, what }: { email: string; what: string }) {
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E7EFE4]">
        <MailCheck className="h-6 w-6 text-[#3F6B4A]" strokeWidth={2} />
      </div>
      <p className="mt-4 text-[13px] font-medium text-[#17211D]">Check your inbox</p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        We sent a link to <span className="font-medium text-[#17211D]">{email}</span>. Open it to {what}.
      </p>
    </div>
  );
}
