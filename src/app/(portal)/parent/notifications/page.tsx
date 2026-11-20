import Link from "next/link";
import { getPortalContext } from "@/lib/portal/context";
import { PortalCard } from "@/components/portal/cards";
import { describe, type Note } from "@/components/notifications/describe";
import { intlLocale } from "@/i18n";
import { ReadAll } from "./read-all";

export const metadata = { title: "Notifications" };

/** Everything the centre told this parent, newest first. */
export default async function ParentNotificationsPage() {
  const ctx = await getPortalContext("parent");
  const { supabase, t } = ctx;
  const L = intlLocale(ctx.locale);
  const { data } = await supabase.from("notifications").select("id, title, body, created_at, read_at, data")
    .eq("center_id", ctx.workspace.centerId).eq("channel", "in_app").order("created_at", { ascending: false }).limit(100);
  const notes: Note[] = (data ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, created_at: n.created_at, read: n.read_at != null, data: (n.data ?? {}) as Record<string, unknown> }));
  const unread = notes.filter((n) => !n.read).length;
  return (
    <PortalCard title={t("Notifications")}>
      {unread > 0 && <div className="mb-2 flex justify-end"><ReadAll /></div>}
      {notes.length === 0 ? <p className="text-[13px] text-muted-foreground">{t("No notifications yet")}</p> : (
        <ul className="divide-y divide-border/60">
          {notes.map((n) => {
            const d = describe(n, t, L, "parent");
            const body = (
              <div className="py-2.5">
                <p className="flex items-center gap-2 text-[13.5px] font-medium">{!n.read && <span className="h-1.5 w-1.5 rounded-full bg-[#B4483D]" />}{d.title}</p>
                <p className="text-[12.5px] text-muted-foreground">{d.body}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString(L, { timeZone: "Asia/Tashkent", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            );
            return <li key={n.id}>{d.href ? <Link href={d.href}>{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </PortalCard>
  );
}
