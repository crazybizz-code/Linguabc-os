"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { Field, FormError, SubmitButton } from "@/components/auth/fields";
import { signIn } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, undefined);
  return (
    <>
      <FormError message={state?.error} />
      <form action={action} className="space-y-3.5">
        <input type="hidden" name="next" value={next} />
        <Field
          label="Email or phone"
          name="identifier"
          icon={Mail}
          autoFocus
          autoComplete="username"
          placeholder="you@centre.uz or +998 90 000 00 00"
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          icon={Lock}
          autoComplete="current-password"
          placeholder="••••••••"
          required
          action={
            <Link href="/forgot-password" className="text-[11px] text-[#12392B] hover:underline">
              Forgot?
            </Link>
          }
        />
        <SubmitButton pending="Signing in…">
          Log in <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </SubmitButton>
      </form>
      <p className="mt-4 border-t border-border/60 pt-3 text-center text-[10.5px] leading-relaxed text-muted-foreground">
        Roles are assigned by your centre. You can&apos;t choose one here — you&apos;ll land in the workspace your
        account is linked to.
      </p>
    </>
  );
}
