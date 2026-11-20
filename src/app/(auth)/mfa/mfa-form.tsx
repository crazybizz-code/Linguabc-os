"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Field, FormError, SubmitButton } from "@/components/auth/fields";
import { verifySignInCode } from "@/lib/auth/mfa";

export function MfaForm() {
  const [state, action] = useActionState(verifySignInCode, undefined);
  return (
    <>
      <FormError message={state?.error} />
      <form action={action} className="space-y-3.5">
        <Field label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="123 456" autoFocus required />
        <SubmitButton pending="Checking…">Continue <ArrowRight className="h-4 w-4" strokeWidth={2} /></SubmitButton>
      </form>
    </>
  );
}
