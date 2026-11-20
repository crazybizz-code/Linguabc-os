"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { BookOpen, CalendarCheck, ClipboardList, Home, TrendingUp, User, Wallet, type LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";

const ICONS: Record<string, LucideIcon> = { home: Home, homework: BookOpen, mocks: ClipboardList, progress: TrendingUp, attendance: CalendarCheck, schedule: CalendarCheck, payments: Wallet, profile: User };

/** Mobile-first frame shared by the parent and student portals. */
export function PortalShell({
  title,
  centerName,
  base,
  items,
  bell,
  children,
}: {
  title: string;
  centerName: string;
  base: "/parent" | "/student";
  items: { key: string; href: string; label: string }[];
  bell?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const t = useT();
  const child = search.get("child");
  const withChild = (href: string) => (child ? `${href}?child=${child}` : href);

  return (
    <div className="min-h-screen bg-[#F5ECE8]">
      <div className="mx-auto min-h-screen max-w-[520px] pb-24">
        <header className="flex items-center gap-2.5 px-5 pb-3 pt-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#12392B]">
            <Sparkles className="h-[14px] w-[14px] text-[#E8DCCB]" strokeWidth={1.9} />
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold tracking-[-0.02em] text-[#17211D]">{t(title)}</div>
            <div className="text-[10px] uppercase tracking-[0.09em] text-[#7A8F7F]">{centerName}</div>
          </div>
          <div className="ml-auto">{bell}</div>
        </header>
        <main className="space-y-3 px-4">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border/70 bg-[#FCF8F4]/95 backdrop-blur print:hidden">
        <ul className="mx-auto grid max-w-[520px]" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
          {items.map((i) => {
            const Icon = ICONS[i.key] ?? Home;
            const active = i.href === base ? pathname === base : pathname.startsWith(i.href);
            return (
              <li key={i.key}>
                <Link href={withChild(i.href)} className={cn("flex flex-col items-center gap-1 py-2.5", items.length > 5 ? "text-[10px]" : "text-[11px]", active ? "font-medium text-[#12392B]" : "text-muted-foreground")}>
                  <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.7} />
                  <span className="max-w-full truncate px-0.5">{t(i.label)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

