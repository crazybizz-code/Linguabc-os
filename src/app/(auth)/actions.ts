"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finishOnboarding } from "@/lib/auth/workspace";
import { siteUrl } from "@/lib/supabase/config";

export type FormState = { error?: string; sent?: string } | undefined;

const callbackUrl = (next = "/") => `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;

/** Only allow same-site relative redirects. */
function safeNext(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

function normalizePhone(p: string): string | null {
  const digits = p.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

/** Sign-in address of an account made with a phone only. It is never mailed. */
const phoneOnlyEmail = (phone: string) => `p${phone.replace(/\D/g, "")}@phone.linguabc.xyz`;

const INVALID_LOGIN = "Invalid email/phone or password.";

/** Resolve a phone number to the account email, server-side only. */
async function emailForPhone(phone: string): Promise<string | null> {
  const admin = createAdminClient();
  const normalized = normalizePhone(phone);
  if (!admin || !normalized) return null;
  const { data: profile } = await admin.from("profiles").select("id").eq("phone", normalized).maybeSingle();
  if (!profile) return null;
  const { data } = await admin.auth.admin.getUserById(profile.id);
  return data.user?.email ?? null;
}

// ------------------------------------------------------------------ log in
export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const identifier = String(form.get("identifier") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!identifier || !password) return { error: INVALID_LOGIN };

  const email = identifier.includes("@") ? identifier.toLowerCase() : await emailForPhone(identifier);
  // Same message whether the phone is unknown or the password is wrong,
  // so the form cannot be used to find out who has an account.
  if (!email) return { error: INVALID_LOGIN };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes("email not confirmed")) {
      return { error: "Please confirm your email first — check your inbox for the link." };
    }
    return { error: INVALID_LOGIN };
  }

  const problem = await finishOnboarding(supabase, data.user);
  redirect(problem ? `/?notice=${encodeURIComponent(problem)}` : next);
}

// ---------------------------------------------------------- register centre
const RegisterSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name."),
    center: z.string().trim().min(2, "Enter your centre's name.").max(120),
    phone: z
      .string()
      .trim()
      .refine((v) => v.replace(/\D/g, "").length >= 9, "Enter a valid phone number."),
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    password: z.string().min(8, "Use at least 8 characters for your password."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export async function registerCenter(_: FormState, form: FormData): Promise<FormState> {
  const parsed = RegisterSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const admin = createAdminClient();
  if (admin) {
    const { data: taken } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", normalizePhone(v.phone)!)
      .maybeSingle();
    if (taken) return { error: "This phone number is already linked to an account. Log in instead." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      emailRedirectTo: callbackUrl("/"),
      data: { full_name: v.name, phone: v.phone, pending_center: v.center },
    },
  });
  if (error) return { error: error.message };

  // Email confirmation switched off in Supabase → we already have a session.
  if (data.session && data.user) {
    const problem = await finishOnboarding(supabase, data.user);
    redirect(problem ? `/?notice=${encodeURIComponent(problem)}` : "/");
  }
  return { sent: v.email };
}

// ------------------------------------------------------- join by invitation
const JoinSchema = z
  .object({
    code: z.string().trim().min(12),
    full_name: z.string().trim().min(2, "Enter your full name."),
    phone: z.string().trim().refine((v) => v.replace(/\D/g, "").length >= 9, "Enter a valid phone number."),
    email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email address or leave it empty.")]),
    password: z.string().min(8, "Use at least 8 characters for your password."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export async function joinWithInvite(_: FormState, form: FormData): Promise<FormState> {
  const parsed = JoinSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: preview } = await supabase.rpc("invite_preview", { p_code: v.code });
  if (!preview?.length) return { error: "This invitation is no longer valid. Ask your centre to send a new one." };

  // The phone is how most students and parents sign in, so it must be theirs alone.
  const phone = normalizePhone(v.phone)!;
  const admin = createAdminClient();
  if (admin) {
    const { data: taken } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle();
    if (taken) return { error: "This phone number already has an account. Log in with it, then open the invitation link again." };
  }
  const meta = { full_name: v.full_name, phone, invite_code: v.code.toUpperCase() };

  // No email: the account is created confirmed on the server (the invitation
  // is the proof), under an address that is never mailed, and the person
  // signs in with phone and password.
  if (!v.email) {
    if (!admin) return { error: "Joining without an email isn't available yet. Enter your email, or ask your centre." };
    const { error: createError } = await admin.auth.admin.createUser({
      email: phoneOnlyEmail(phone), password: v.password, email_confirm: true, user_metadata: meta,
    });
    if (createError) {
      return { error: /already|registered|exists/i.test(createError.message) ? "This phone number already has an account. Log in with it, then open the invitation link again." : "We couldn't create your account. Try again." };
    }
    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email: phoneOnlyEmail(phone), password: v.password });
    if (signInError || !signedIn.user) return { error: "Your account was created. Log in with your phone number and password." };
    const problem = await finishOnboarding(supabase, signedIn.user);
    redirect(problem ? `/?notice=${encodeURIComponent(problem)}` : "/");
  }

  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: { emailRedirectTo: callbackUrl("/"), data: meta },
  });
  if (error) return { error: error.message };

  if (data.session && data.user) {
    const problem = await finishOnboarding(supabase, data.user);
    redirect(problem ? `/?notice=${encodeURIComponent(problem)}` : "/");
  }
  return { sent: v.email };
}

/** Someone who already has an account redeems a new invitation. */
export async function acceptInviteSignedIn(_: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get("code") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invite", { p_code: code });
  if (error) return { error: "This invitation is no longer valid. Ask your centre to send a new one." };
  redirect("/");
}

// ---------------------------------------------------------- password reset
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl("/reset-password") });
  // Always the same answer, whether or not the email has an account.
  return { sent: email };
}

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };
  if (password !== confirm) return { error: "Passwords do not match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Your reset link has expired. Request a new one." };
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
