import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { finishOnboarding } from "@/lib/auth/workspace";

const TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Target of the links in our branded auth emails
 * (supabase/email-templates). Links stay on app.linguabc.xyz, which keeps
 * the sender and link domains matched — a big factor for inbox placement.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next") ?? (type === "recovery" ? "/reset-password" : "/");
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (!tokenHash || !type || !TYPES.includes(type)) {
    return NextResponse.redirect(new URL("/login?expired=1", url.origin));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?expired=1", url.origin));
  }

  const problem = type === "recovery" ? null : await finishOnboarding(supabase, data.user);
  const target = problem ? `/?notice=${encodeURIComponent(problem)}` : next;
  return NextResponse.redirect(new URL(target, url.origin));
}
