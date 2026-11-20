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
  Library,
  Mic,
  Home,
  CalendarDays,
  GraduationCap,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { Avatar, cn } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";

// Each role gets its own menu, as in the Base44 prototype. Pages that are
// not built yet show as "Soon".
type Item = { href: string; label: string; icon: LucideIcon };
type Section = { title: string; items: Item[] };
type StaffRole = "owner" | "admin" | "academic_manager" | "mentor";

const SOON = new Set<string>([]);

const I = {
  overview: { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  today: { href: "/dashboard", label: "Today", icon: Home },
  branches: { href: "/branches", label: "Branches", icon: Building2 },
  groups: { href: "/groups", label: "Groups", icon: Layers },
  myGroups: { href: "/groups", label: "My groups", icon: Layers },
  students: { href: "/students", label: "Students", icon: Users },
  myStudents: { href: "/students", label: "My students", icon: Users },
  schedule: { href: "/schedule", label: "Schedule", icon: CalendarDays },
  attendance: { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
  homework: { href: "/homework", label: "Homework", icon: BookOpen },
  mocks: { href: "/mocks", label: "Mocks", icon: ClipboardList },
  progress: { href: "/progress", label: "Progress", icon: TrendingUp },
  analytics: { href: "/analytics", label: "Analytics", icon: BarChart3 },
  payments: { href: "/payments", label: "Payments", icon: Wallet },
  parents: { href: "/parents", label: "Parents", icon: HeartHandshake },
  reports: { href: "/reports", label: "Reports", icon: BarChart3 },
  staff: { href: "/staff", label: "Staff", icon: ShieldCheck },
  staffMentors: { href: "/staff", label: "Staff & mentors", icon: ShieldCheck },
  mentors: { href: "/mentors", label: "Mentors", icon: GraduationCap },
  notifications: { href: "/notifications", label: "Notifications", icon: Bell },
} satisfies Record<string, Item>;

const NAV: Record<StaffRole, { sections: Section[]; mobile: Item[] }> = {
  owner: {
    sections: [
      { title: "Centre", items: [I.overview, I.branches, I.groups] },
      { title: "Operations", items: [I.payments, I.parents] },
      { title: "Performance", items: [I.progress, I.reports, I.staffMentors] },
    ],
    mobile: [I.overview, I.branches, I.groups, I.payments, I.reports],
  },
  admin: {
    sections: [
      { title: "Today", items: [I.overview, I.schedule, I.attendance] },
      { title: "Manage", items: [I.students, I.groups, I.staff, I.parents] },
      { title: "Money & inbox", items: [I.payments, I.notifications] },
    ],
    mobile: [I.overview, I.students, I.attendance, I.payments, I.notifications],
  },
  academic_manager: {
    sections: [
      { title: "Academic", items: [I.overview, I.groups, I.mentors, I.students] },
      { title: "Learning", items: [I.homework, I.mocks, I.progress, I.analytics] },
    ],
    mobile: [I.overview, I.groups, I.homework, I.mocks, I.analytics],
  },
  mentor: {
    sections: [
      { title: "My teaching", items: [I.today, I.myGroups, I.myStudents, I.schedule] },
      { title: "Classwork", items: [I.attendance, I.homework, I.mocks, I.progress] },
    ],
    mobile: [I.today, I.myGroups, I.myStudents, I.attendance, I.homework],
  },
};

const PLATFORM: Section = {
  title: "LinguABC",
  items: [
    { href: "/admin/tests", label: "LinguABC tests", icon: Library },
    { href: "/admin/podcasts", label: "LinguABC podcasts", icon: Mic },
  ],
};

const menuFor = (role: string, platform: boolean) => {
  const nav = NAV[(role in NAV ? role : "mentor") as StaffRole];
  return { sections: platform ? [...nav.sections, PLATFORM] : nav.sections, mobile: nav.mobile };
};
const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

export function Sidebar({ name, role, roleLabel, isPlatformAdmin = false }: {
  name: string; role: string; roleLabel: string; isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const t = useT();
  const { sections } = menuFor(role, isPlatformAdmin);

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
        {sections.map((s) => {
          const items = s.items;
          return (
            <div key={s.title}>
              <p className="px-3 pb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#7E9A8B]">{t(s.title)}</p>
              <ul className="space-y-0.5">
                {items.map((i) => {
                  const soon = SOON.has(i.href);
                  const active = isActive(pathname, i.href);
                  const Icon = i.icon;
                  const inner = (
                    <>
                      <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.7} />
                      <span className="flex-1">{t(i.label)}</span>
                      {soon && <span className="rounded-full bg-[#FCF8F4]/[0.08] px-1.5 py-0.5 text-[9.5px] text-[#8FAA9C]">{t("Soon")}</span>}
                    </>
                  );
                  const cls = cn(
                    "flex h-10 items-center gap-3 rounded-[11px] px-3 text-[13.5px] transition-colors",
                    active ? "bg-[#FCF8F4] font-medium text-[#12392B]" : "text-[#C9DACF] hover:bg-[#FCF8F4]/[0.07]",
                    soon && "cursor-default opacity-60 hover:bg-transparent",
                  );
                  return (
                    <li key={i.href + i.label}>
                      {soon ? <span className={cls}>{inner}</span> : <Link href={i.href} className={cls}>{inner}</Link>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[#FCF8F4]/[0.1] pt-3">
        {role !== "mentor" && (SOON.has("/settings") ? (
          <span className="flex h-10 cursor-default items-center gap-3 rounded-[11px] px-3 text-[13.5px] text-[#C9DACF] opacity-60">
            <Settings className="h-[17px] w-[17px]" strokeWidth={1.7} /> {t("Settings")}
            <span className="ml-auto rounded-full bg-[#FCF8F4]/[0.08] px-2 py-0.5 text-[10px] text-[#7E9A8B]">{t("Soon")}</span>
          </span>
        ) : (
          <Link href="/settings" className={cn("flex h-10 items-center gap-3 rounded-[11px] px-3 text-[13.5px]",
            isActive(pathname, "/settings") ? "bg-[#FCF8F4] font-medium text-[#12392B]" : "text-[#C9DACF] hover:bg-[#FCF8F4]/[0.07]")}>
            <Settings className="h-[17px] w-[17px]" strokeWidth={1.7} /> {t("Settings")}
          </Link>
        ))}
        <Link href="/profile" className="mt-2 flex items-center gap-2.5 rounded-[12px] bg-[#FCF8F4]/[0.07] px-2.5 py-2 hover:bg-[#FCF8F4]/[0.12]">
          <Avatar name={name} size="sm" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12.5px] font-medium">{name}</div>
            <div className="text-[10.5px] text-[#8FAA9C]">{roleLabel}</div>
          </div>
        </Link>
      </div>
    </aside>
  );
}

/** Compact nav for phones and tablets. */
export function MobileNav({ role, isPlatformAdmin = false }: { role: string; isPlatformAdmin?: boolean }) {
  const pathname = usePathname();
  const t = useT();
  const { mobile } = menuFor(role, isPlatformAdmin);
  const items = [...mobile, ...(isPlatformAdmin ? PLATFORM.items : [])].filter((i) => !SOON.has(i.href));
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:hidden">
      {items.map((i) => (
        <Link key={i.href + i.label} href={i.href}
          className={cn("whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px]", isActive(pathname, i.href) ? "bg-[#12392B] text-[#FAF5EF]" : "bg-[#FCF8F4] text-[#3B4A42]")}>
          {t(i.label)}
        </Link>
      ))}
    </nav>
  );
}
