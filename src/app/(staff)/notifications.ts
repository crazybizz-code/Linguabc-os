"use server";

import { getStaffContext } from "@/lib/auth/current";
import { loadNotes, markRead } from "@/lib/notifications";

export async function myNotifications() {
  const { supabase, workspace } = await getStaffContext();
  return loadNotes(supabase, workspace.centerId);
}

export async function markNotificationsRead(): Promise<void> {
  const { supabase, workspace } = await getStaffContext();
  await markRead(supabase, workspace.centerId);
}
