import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { SUPABASE_URL } from "@/lib/supabase/config";

/**
 * Service-role client. Bypasses RLS — use only for the narrow server-side
 * jobs that need it (phone → email lookup at sign-in). Never import from
 * client code; "server-only" makes that a build error.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
