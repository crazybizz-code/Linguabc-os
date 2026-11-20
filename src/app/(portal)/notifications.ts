"use server";

import { getPortalContext } from "@/lib/portal/context";
import { loadNotes, markRead } from "@/lib/notifications";

export async function studentNotifications() {
  const { supabase, workspace } = await getPortalContext("student");
  return loadNotes(supabase, workspace.centerId);
}
export async function parentNotifications() {
  const { supabase, workspace } = await getPortalContext("parent");
  return loadNotes(supabase, workspace.centerId);
}
export async function markStudentNotificationsRead(): Promise<void> {
  const { supabase, workspace } = await getPortalContext("student");
  await markRead(supabase, workspace.centerId);
}
export async function markParentNotificationsRead(): Promise<void> {
  const { supabase, workspace } = await getPortalContext("parent");
  await markRead(supabase, workspace.centerId);
}
