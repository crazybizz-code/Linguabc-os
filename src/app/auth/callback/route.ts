import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { finishOnboarding } from "@/lib/auth/workspace";

/**
 * Landing point for links in Supabase auth emails (sign-up confirmation,
 * password reset). Exchanges the one-time code for a session, then
 * finishes any pending centre creation or invitation.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (!code) return NextResponse.redirect(new URL("/login", url.origin));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?expired=1", url.origin));
  }

  const problem = await finishOnboarding(supabase, data.user);
  const target = problem ? `/?notice=${encodeURIComponent(problem)}` : next;
  return NextResponse.redirect(new URL(target, url.origin));
}
