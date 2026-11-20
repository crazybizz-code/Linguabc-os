import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Note } from "@/components/notifications/describe";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The signed-in user's latest in-app notifications in one centre (RLS: own inbox only). */
export async function loadNotes(supabase: Client, centerId: string): Promise<{ notes: Note[]; unread: number }> {
  const { data } = await supabase.from("notifications")
    .select("id, title, body, created_at, read_at, data")
    .eq("center_id", centerId).eq("channel", "in_app")
    .order("created_at", { ascending: false }).limit(25);
  const notes: Note[] = (data ?? []).map((n) => ({
    id: n.id, title: n.title, body: n.body, created_at: n.created_at, read: n.read_at != null,
    data: (n.data ?? {}) as Record<string, unknown>,
  }));
  return { notes, unread: notes.filter((n) => !n.read).length };
}

export async function markRead(supabase: Client, centerId: string) {
  await supabase.rpc("mark_my_notifications_read", { p_center: centerId });
}
