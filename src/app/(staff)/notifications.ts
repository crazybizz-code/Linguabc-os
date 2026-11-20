"use server";

import { getStaffContext } from "@/lib/auth/current";

export type Note = { id: string; title: string; body: string | null; created_at: string; read: boolean; href: string | null };

/** The signed-in staff member's latest in-app notifications (RLS: own inbox only). */
export async function myNotifications(): Promise<{ notes: Note[]; unread: number }> {
  const { supabase, workspace } = await getStaffContext();
  const { data } = await supabase.from("notifications")
    .select("id, title, body, created_at, read_at, data")
    .eq("center_id", workspace.centerId).eq("channel", "in_app")
    .order("created_at", { ascending: false }).limit(20);
  const notes = (data ?? []).map((n) => {
    const d = (n.data ?? {}) as { session_id?: string };
    return { id: n.id, title: n.title, body: n.body, created_at: n.created_at, read: n.read_at != null,
             href: d.session_id ? `/mocks/${d.session_id}` : null };
  });
  return { notes, unread: notes.filter((n) => !n.read).length };
}

export async function markNotificationsRead(): Promise<void> {
  const { supabase, workspace } = await getStaffContext();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("center_id", workspace.centerId).is("read_at", null);
}
