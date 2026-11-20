"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, X } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { useLocale, useT } from "@/i18n/client";
import { intlLocale } from "@/i18n";
import { createClient } from "@/lib/supabase/client";
import { describe, type Audience, type Note } from "@/components/notifications/describe";

type Inbox = { notes: Note[]; unread: number };

/**
 * In-app notifications for staff, students and parents. New ones arrive
 * live through Supabase Realtime (RLS limits each person to their own
 * inbox) and pop up as a toast; a slower poll and a refresh on returning
 * to the tab cover a dropped connection.
 */
export function NotificationBell({ initial, audience, load, markAll, compact = false }: {
  initial: Inbox; audience: Audience; load: () => Promise<Inbox>; markAll: () => Promise<void>; compact?: boolean;
}) {
  const t = useT();
  const locale = intlLocale(useLocale());
  const [data, setData] = useState(initial);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Note>();
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(initial.notes.map((n) => n.id)));

  const refresh = useCallback(async () => {
    const next = await load();
    const fresh = next.notes.find((n) => !n.read && !seen.current.has(n.id));
    next.notes.forEach((n) => seen.current.add(n.id));
    setData(next);
    if (fresh) setToast(fresh);
  }, [load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`my-notifications-${audience}`)
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
  }, [refresh, audience]);

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
      await markAll();
      setData((d) => ({ unread: 0, notes: d.notes }));
    }
  };

  const item = (n: Note, onGo: () => void) => {
    const x = describe(n, t, locale, audience);
    const inner = (
      <>
        <p className="text-[13px] font-semibold">{x.title}</p>
        {x.who && <p className="text-[13px] font-semibold text-[#8C2F25]">{x.who}</p>}
        {x.body && <p className="mt-0.5 text-[12px] leading-snug text-[#3B4A42]">{x.body}</p>}
      </>
    );
    return { x, inner, link: x.href ? <Link href={x.href} onClick={onGo} className="block">{inner}</Link> : inner };
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={toggle} aria-label={t("Notifications")}
        className={cn("relative flex items-center justify-center rounded-[10px] border border-border/80 bg-[#FCF8F4] hover:bg-white", compact ? "h-8 w-8" : "h-9 w-9")}>
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
              {data.notes.map((n) => (
                <li key={n.id} className={cn("px-4 py-3 hover:bg-white", !n.read && "bg-[#FBEDEB]/60")}>
                  {item(n, () => setOpen(false)).link}
                  <p className="mt-1 text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString(locale, { timeZone: "Asia/Tashkent", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {toast && (() => {
        const { x, inner } = item(toast, () => setToast(undefined));
        return (
          <div role="alert" className="fixed bottom-20 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-[14px] border border-[#12392B]/25 bg-[#FCF8F4] p-4 shadow-[0_8px_30px_rgba(23,33,29,0.18)] lg:bottom-4">
            <div className="flex items-start gap-3">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[#12392B]" />
              <div className="min-w-0 flex-1">
                {inner}
                {x.href && <Link href={x.href} onClick={() => setToast(undefined)} className="mt-2 inline-block text-[12.5px] font-medium underline">{t("Open")}</Link>}
              </div>
              <button type="button" onClick={() => setToast(undefined)} aria-label={t("Close")}><X className="h-4 w-4 text-muted-foreground" /></button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
