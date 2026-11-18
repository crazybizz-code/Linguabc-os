"use client";

import { useActionState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { CheckEmail, Field, FormError, SubmitButton } from "@/components/auth/fields";
import { registerCenter } from "../actions";

export function RegisterForm() {
  const [state, action] = useActionState(registerCenter, undefined);
  if (state?.sent) return <CheckEmail email={state.sent} what="confirm your account and open your centre" />;
  return (
    <>
      <FormError message={state?.error} />
      <form action={action} className="space-y-3.5">
        <Field label="Your name" name="name" autoFocus autoComplete="name" placeholder="Yodgorbek Rasulov" required />
        <Field label="Centre name" name="center" autoComplete="organization" placeholder="Nova Learning Center" required />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+998 90 123 45 67"
          hint="Used to sign in later, together with your password"
          required
        />
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="owner@centre.uz" required />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" name="password" type="password" autoComplete="new-password" placeholder="••••••••" required />
          <Field label="Confirm" name="confirm" type="password" autoComplete="new-password" placeholder="••••••••" required />
        </div>
        <SubmitButton pending="Creating your centre…">
          Create my centre <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </SubmitButton>
      </form>
      <p className="mt-4 flex gap-2 border-t border-border/60 pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        You&apos;ll be the Owner of this centre. Every other account — administrators, academic managers, mentors,
        students and parents — is invited by the centre and cannot choose its own role.
      </p>
    </>
  );
}
