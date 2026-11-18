"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ClipboardList,
  BarChart3,
  ClipboardCheck,
  Building2,
  HeartHandshake,
  LayoutGrid,
  Layers,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Avatar, cn } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";

type Item = { href: string; label: string; icon: LucideIcon; soon?: boolean; adminOnly?: boolean; staffOnly?: boolean };
const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: "Centre",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutGrid },
      { href: "/branches", label: "Branches", icon: Building2, staffOnly: true },
      { href: "/groups", label: "Groups", icon: Layers },
      { href: "/students", label: "Students", icon: Users },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
      { href: "/homework", label: "Homework", icon: BookOpen },
      { href: "/mocks", label: "Mocks", icon: ClipboardList },
      { href: "/payments", label: "Payments", icon: Wallet, adminOnly: true },
      { href: "/parents", label: "Parents", icon: HeartHandshake, soon: true, staffOnly: true },
    ],
  },
  {
    title: "Performance",
    items: [
      { href: "/progress", label: "Progress", icon: TrendingUp, soon: true },
      { href: "/reports", label: "Reports", icon: BarChart3, soon: true, staffOnly: true },
      { href: "/staff", label: "Staff & mentors", icon: ShieldCheck, staffOnly: true },
    ],
  },
];

export function Sidebar({
  name,
  roleLabel,
  isAdmin,
  isStaff,
}: {
  name: string;
  roleLabel: string;
  isAdmin: boolean;
  isStaff: boolean;
}) {
  const pathname = usePathname();
  const t = useT();
  const visible = (i: Item) => (!i.adminOnly || isAdmin) && (!i.staffOnly || isStaff);

  return (
    <aside className="sticky top-4 hidden print:!hidden h-[calc(100vh-2rem)] w-[248px] shrink-0 flex-col rounded-[22px] bg-[#12392B] px-3.5 py-5 text-[#FAF5EF] lg:flex">
      <div className="px-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#FCF8F4]/[0.12]">
            <Sparkles className="h-4 w-4 text-[#E8DCCB]" strokeWidth={1.8} />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-[-0.02em]">LinguABC</div>
            <div className="text-[10px] tracking-[0.09em] text-[#7E9A8B]">ACADEMIC OS</div>
          </div>
        </div>
        <span className="mt-3 inline-block rounded-full bg-[#FCF8F4]/[0.1] px-2.5 py-1 text-[10.5px] text-[#C9DACF]">
          {t("{role} workspace", { role: roleLabel })}
        </span>
      </div>

      <nav className="mt-4 flex-1 space-y-4 overflow-y-auto">
        {SECTIONS.map((s) => {
          const items = s.items.filter(visible);
          if (!items.length) return null;
          return (
            <div key={s.title}>
              <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#7E9A8B]">{t(s.title)}</p>
              <ul className="space-y-0.5">
                {items.map((i) => {
                  const active = pathname === i.href || pathname.startsWith(i.href + "/");
                  const Icon = i.icon;
                  const inner = (
                    <>
                      <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.7} />
                      <span className="flex-1">{t(i.label)}</span>
                      {i.soon && <span className="rounded-full bg-[#FCF8F4]/[0.08] px-1.5 py-0.5 text-[9.5px] text-[#8FAA9C]">{t("Soon")}</span>}
                    </>
                  );
                  const cls = cn(
                    "flex h-10 items-center gap-3 rounded-[11px] px-3 text-[13.5px] transition-colors",
                    active ? "bg-[#FCF8F4] font-medium text-[#12392B]" : "text-[#C9DACF] hover:bg-[#FCF8F4]/[0.07]",
                    i.soon && "cursor-default opacity-60 hover:bg-transparent",
                  );
                  return (
                    <li key={i.href}>
                      {i.soon ? <span className={cls}>{inner}</span> : <Link href={i.href} className={cls}>{inner}</Link>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[#FCF8F4]/[0.1] pt-3">
        <span className="flex h-10 cursor-default items-center gap-3 rounded-[11px] px-3 text-[13.5px] text-[#C9DACF] opacity-60">
          <Settings className="h-[17px] w-[17px]" strokeWidth={1.7} /> {t("Settings")}
        </span>
        <div className="mt-2 flex items-center gap-2.5 rounded-[12px] bg-[#FCF8F4]/[0.07] px-2.5 py-2">
          <Avatar name={name} size="sm" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12.5px] font-medium">{name}</div>
            <div className="text-[10.5px] text-[#8FAA9C]">{roleLabel}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Compact nav for phones and tablets. */
export function MobileNav({ isStaff }: { isStaff: boolean }) {
  const pathname = usePathname();
  const t = useT();
  const items = SECTIONS.flatMap((s) => s.items).filter((i) => !i.soon && (!i.staffOnly || isStaff));
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:hidden">
      {items.map((i) => {
        const active = pathname === i.href || pathname.startsWith(i.href + "/");
        return (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px]",
              active ? "bg-[#12392B] text-[#FAF5EF]" : "bg-[#FCF8F4] text-[#3B4A42]",
            )}
          >
            {t(i.label)}
          </Link>
        );
      })}
    </nav>
  );
}
