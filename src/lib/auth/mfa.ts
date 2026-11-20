"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Two-step sign-in with an authenticator app (TOTP, Supabase Auth MFA).
 * Turning it on happens on the staff Profile page; once on, every sign-in
 * asks for the 6-digit code at /mfa before any workspace opens.
 */

const CODE = /^\d{6}$/;

/** Starts turning MFA on: a QR code and secret for the authenticator app. */
export async function startMfa(): Promise<{ factorId?: string; qr?: string; secret?: string; error?: string }> {
  const supabase = await createClient();
  const { data: list } = await supabase.auth.mfa.listFactors();
  // A half-finished earlier attempt would block a new one.
  for (const f of list?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { error: "Two-step sign-in could not be started. Try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirms the first code from the app, which turns MFA on. */
export async function confirmMfa(factorId: string, code: string): Promise<{ error?: string }> {
  if (!CODE.test(code.trim())) return { error: "Enter the 6-digit code from your app." };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) return { error: "That code is not right. Check the time on your phone and try again." };
  return {};
}

/** Turns MFA off (needs a session that already passed the code). */
export async function stopMfa(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return { error: "Sign in with your code first." };
  const { data: list } = await supabase.auth.mfa.listFactors();
  for (const f of list?.all ?? []) await supabase.auth.mfa.unenroll({ factorId: f.id });
  return {};
}

/** The sign-in step: checks the code and continues to the workspace. */
export async function verifySignInCode(_: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!CODE.test(code)) return { error: "Enter the 6-digit code from your app." };
  const supabase = await createClient();
  const { data: list } = await supabase.auth.mfa.listFactors();
  const factor = list?.totp?.[0];
  if (!factor) redirect("/");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "That code is not right. Check the time on your phone and try again." };
  redirect("/");
}
