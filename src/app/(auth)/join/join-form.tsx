"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { CheckEmail, Field, FormError, SubmitButton } from "@/components/auth/fields";
import { acceptInviteSignedIn, joinWithInvite } from "../actions";

export function JoinForm({ code, defaultName, defaultEmail }: { code: string; defaultName: string; defaultEmail: string }) {
  const [state, action] = useActionState(joinWithInvite, undefined);
  if (state?.sent) return <CheckEmail email={state.sent} what="confirm your account and join your centre" />;
  return (
    <>
      <FormError message={state?.error} />
      <form action={action} className="space-y-3.5">
        <input type="hidden" name="code" value={code} />
        <Field label="Your full name" name="full_name" defaultValue={defaultName} autoComplete="name" placeholder="Dilshod Karimov" required />
        <Field label="Phone number" name="phone" type="tel" autoComplete="tel" placeholder="+998 90 123 45 67" required />
        <Field label="Email (optional)" name="email" type="email" defaultValue={defaultEmail} autoComplete="email" placeholder="you@mail.uz" />
        <p className="-mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">You will log in with your phone number and password. Add an email only if you want to reset your password by email.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" name="password" type="password" autoComplete="new-password" placeholder="••••••••" required />
          <Field label="Confirm" name="confirm" type="password" autoComplete="new-password" placeholder="••••••••" required />
        </div>
        <SubmitButton pending="Creating your account…">
          Continue <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </SubmitButton>
      </form>
    </>
  );
}

export function AcceptSignedIn({ code }: { code: string }) {
  const [state, action] = useActionState(acceptInviteSignedIn, undefined);
  return (
    <>
      <FormError message={state?.error} />
      <form action={action}>
        <input type="hidden" name="code" value={code} />
        <SubmitButton pending="Joining…">
          Join with my current account <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </SubmitButton>
      </form>
    </>
  );
}
