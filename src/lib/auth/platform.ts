import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getStaffContext } from "./current";

/** Whether the signed-in user is a LinguABC platform admin (the database decides). */
export const isPlatformAdmin = cache(async () => {
  const { supabase } = await getStaffContext();
  const { data } = await supabase.rpc("am_platform_admin");
  return data === true;
});

/** Staff context for LinguABC admin pages; anyone else gets a 404. */
export async function getPlatformContext() {
  const ctx = await getStaffContext();
  if (!(await isPlatformAdmin())) notFound();
  return ctx;
}
