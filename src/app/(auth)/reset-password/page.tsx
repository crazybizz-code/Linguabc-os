"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Field, FormError, SubmitButton } from "@/components/auth/fields";
import { updatePassword } from "../actions";

export default function ResetPasswordPage() {
  const [state, action] = useActionState(updatePassword, undefined);
  return (
    <AuthShell title="Choose a new password" subtitle="Use at least 8 characters.">
      <FormError message={state?.error} />
      <form action={action} className="space-y-3.5">
        <Field label="New password" name="password" type="password" icon={Lock} autoFocus autoComplete="new-password" placeholder="••••••••" required />
        <Field label="Confirm" name="confirm" type="password" icon={Lock} autoComplete="new-password" placeholder="••••••••" required />
        <SubmitButton pending="Saving…">Save password</SubmitButton>
      </form>
    </AuthShell>
  );
}
