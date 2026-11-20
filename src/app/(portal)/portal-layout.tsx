import { Suspense, type ReactNode } from "react";
import { I18nProvider } from "@/i18n/client";
import { PortalShell } from "@/components/portal/shell";
import { getPortalContext, type PortalKind } from "@/lib/portal/context";

const NAV: Record<PortalKind, { key: string; href: string; label: string }[]> = {
  parent: [
    { key: "home", href: "/parent", label: "Home" },
    { key: "progress", href: "/parent/progress", label: "Progress" },
    { key: "attendance", href: "/parent/attendance", label: "Attendance" },
    { key: "payments", href: "/parent/payments", label: "Payments" },
    { key: "profile", href: "/parent/profile", label: "Profile" },
  ],
  student: [
    { key: "home", href: "/student", label: "Home" },
    { key: "homework", href: "/student/homework", label: "Homework" },
    { key: "mocks", href: "/student/mocks", label: "Mocks" },
    { key: "progress", href: "/student/progress", label: "Progress" },
    { key: "schedule", href: "/student/schedule", label: "Schedule" },
    { key: "payments", href: "/student/payments", label: "Payments" },
    { key: "profile", href: "/student/profile", label: "Profile" },
  ],
};

export async function PortalLayout({ kind, children }: { kind: PortalKind; children: ReactNode }) {
  const ctx = await getPortalContext(kind);
  return (
    <I18nProvider locale={ctx.locale}>
      <Suspense>
        <PortalShell title={kind === "parent" ? "LinguABC for parents" : "LinguABC"} centerName={ctx.workspace.centerName}
          base={kind === "parent" ? "/parent" : "/student"} items={NAV[kind]}>
          {children}
        </PortalShell>
      </Suspense>
    </I18nProvider>
  );
}
