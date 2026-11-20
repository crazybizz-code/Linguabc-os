import "server-only";
import { getPlatformContext } from "@/lib/auth/platform";
import { AiUnavailable } from "./gemini";

const friendly = (m: string) => (/forbidden|permission/i.test(m) ? "You don't have permission to do that." : m);

function aiError(e: unknown) {
  if (e instanceof AiUnavailable) return e.message;
  console.error(e);
  return "Something went wrong. Try again.";
}

/** Runs one AI or voice job for a LinguABC admin, recorded as their usage (no centre). */
export async function withAdminAi<T>(kind: "test" | "audio", run: () => Promise<{ value: T; model: string; prompt: number; completion: number; cost: number }>): Promise<{ value?: T; error?: string }> {
  const { supabase } = await getPlatformContext();
  const { data: id, error } = await supabase.rpc("claim_admin_ai_request", { p_kind: kind });
  if (error || id == null) return { error: error ? friendly(error.message) : "You don't have permission to do that." };
  try {
    const r = await run();
    await supabase.rpc("finish_ai_request", { p_id: id, p_model: r.model, p_prompt: r.prompt, p_completion: r.completion, p_cost: r.cost, p_ok: true });
    return { value: r.value };
  } catch (e) {
    await supabase.rpc("finish_ai_request", { p_id: id, p_model: "", p_prompt: 0, p_completion: 0, p_cost: 0, p_ok: false });
    return { error: aiError(e) };
  }
}
