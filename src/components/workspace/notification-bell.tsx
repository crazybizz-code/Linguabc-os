"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";
import { markNotificationsRead, myNotifications, type Note } from "@/app/(staff)/notifications";

/**
 * In-app notifications for staff. New ones arrive live through Supabase
 * Realtime (RLS limits each person to their own inbox) and pop up as a
 * toast; a slower poll and a refresh on returning to the tab cover a
 * dropped connection.
 */
export function NotificationBell({ initial }: { initial: { notes: Note[]; unread: number } }) {
  const t = useT();
  const [data, setData] = useState(initial);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Note>();
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(initial.notes.map((n) => n.id)));

  const refresh = useCallback(async () => {
    const next = await myNotifications();
    const fresh = next.notes.find((n) => !n.read && !seen.current.has(n.id));
    next.notes.forEach((n) => seen.current.add(n.id));
    setData(next);
    if (fresh) setToast(fresh);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel("my-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => { void refresh(); })
      .subscribe();
    const id = setInterval(() => { void refresh(); }, 30_000);
    const onBack = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(undefined), 10_000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && data.unread > 0) {
      await markNotificationsRead();
      setData((d) => ({ unread: 0, notes: d.notes }));
    }
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={toggle} aria-label={t("Notifications")}
        className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-border/80 bg-[#FCF8F4] hover:bg-white">
        <Bell className="h-4 w-4" strokeWidth={1.9} />
        {data.unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#B4483D] px-1 text-[10.5px] font-semibold text-white">
            {data.unread > 9 ? "9+" : data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[340px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[14px] border border-border/80 bg-[#FCF8F4] shadow-[0_8px_30px_rgba(23,33,29,0.12)]">
          <p className="border-b border-border/60 px-4 py-2.5 text-[12.5px] font-semibold">{t("Notifications")}</p>
          {data.notes.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">{t("Nothing new.")}</p>
          ) : (
            <ul className="max-h-[380px] divide-y divide-border/50 overflow-y-auto">
              {data.notes.map((n) => {
                const inner = (
                  <div className={cn("px-4 py-3", !n.read && "bg-[#FBEDEB]/60")}>
                    <p className="text-[13px] font-medium">{t(n.title)}</p>
                    {n.who && <p className="text-[13px] font-semibold text-[#8C2F25]">{n.who}</p>}
                    {n.body && <p className="mt-0.5 text-[12px] leading-snug text-[#3B4A42]">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString(undefined, { timeZone: "Asia/Tashkent", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                );
                return <li key={n.id}>{n.href ? <Link href={n.href} onClick={() => setOpen(false)} className="block hover:bg-white">{inner}</Link> : inner}</li>;
              })}
            </ul>
          )}
        </div>
      )}
      {toast && (
        <div role="alert" className="fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-[14px] border border-[#B4483D]/40 bg-[#FCF8F4] p-4 shadow-[0_8px_30px_rgba(23,33,29,0.18)]">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[#B4483D]" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{t(toast.title)}</p>
              {toast.who && <p className="text-[13px] font-semibold text-[#8C2F25]">{toast.who}</p>}
              {toast.body && <p className="mt-0.5 text-[12px] leading-snug text-[#3B4A42]">{toast.body}</p>}
              {toast.href && <Link href={toast.href} onClick={() => setToast(undefined)} className="mt-2 inline-block text-[12.5px] font-medium underline">{t("Open the mock")}</Link>}
            </div>
            <button type="button" onClick={() => setToast(undefined)} aria-label={t("Close")}><X className="h-4 w-4 text-muted-foreground" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
