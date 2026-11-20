"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { CheckEmail, Field, FormError, SubmitButton } from "@/components/auth/fields";
import { requestPasswordReset } from "../actions";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState(requestPasswordReset, undefined);
  return (
    <AuthShell
      title="Reset password"
      subtitle="We'll send you a link to reset it"
      footer={
        <Link href="/login" className="inline-flex items-center gap-1 font-medium text-[#12392B] hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to log in
        </Link>
      }
    >
      {state?.sent ? (
        <CheckEmail email={state.sent} what="choose a new password" />
      ) : (
        <>
          <FormError message={state?.error} />
          <form action={action} className="space-y-3.5">
            <Field label="Email address" name="email" type="email" icon={Mail} autoFocus autoComplete="email" placeholder="you@example.com" required />
            <SubmitButton pending="Sending…">Send reset link</SubmitButton>
          </form>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">Joined with a phone number and no email? Ask your centre to help you set a new password.</p>
        </>
      )}
    </AuthShell>
  );
}
