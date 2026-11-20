import { createClient } from "@/lib/supabase/server";

/**
 * Reached by navigator.sendBeacon when the student closes or leaves the
 * exam page, where a server action could be cut off. The database checks
 * the attempt is theirs.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { attempt?: string; reason?: string } | null;
  const attempt = body?.attempt ?? "";
  if (!/^[0-9a-f-]{36}$/.test(attempt)) return new Response(null, { status: 400 });
  const supabase = await createClient();
  await supabase.rpc("leave_mock_module", { p_attempt: attempt, p_reason: body?.reason === "left_fullscreen" ? "left_fullscreen" : "left_page" });
  return new Response(null, { status: 204 });
}
