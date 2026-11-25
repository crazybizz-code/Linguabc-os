import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, BookOpen, ShieldCheck, ChevronRight, Check, Minus } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Card, PageHeader } from "@/components/ui/primitives";
import { CentreSettings } from "./centre-name";

export const metadata = { title: "Settings" };

const ROLES = ["Owner", "Administrator", "Academic manager", "Mentor"] as const;
// What each role can do; enforced in the database (RLS and checked functions), shown here for reference.
const ACCESS: [string, boolean[]][] = [
  ["Centre settings and owners", [true, false, false, false]],
  ["Invite administrators", [true, false, false, false]],
  ["Invite mentors, students and parents", [true, true, false, false]],
  ["Payments, invoices and reports", [true, true, false, false]],
  ["Add and edit students and parents", [true, true, false, false]],
  ["Groups, courses and schedules", [true, true, true, false]],
  ["Homework, mocks and progress — all groups", [true, true, true, false]],
  ["Student records, homework and attendance — own groups", [true, true, true, true]],
];

/** Centre identity, roles and the defaults every module inherits. */
export default async function SettingsPage() {
  const { supabase, workspace, isStaff, t } = await getStaffContext();
  if (!isStaff) redirect("/dashboard");
  const { data: centre } = await supabase.from("centers").select("name, slug, timezone, currency, created_at, phone, address").eq("id", workspace.centerId).single();
  const owner = workspace.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Configuration")} title={t("Settings")} description={t("Centre identity, branches, roles and the defaults every module inherits.")} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">{t("Centre")}</h2>
          <div className="mt-3"><CentreSettings canEdit={owner} c={{ name: centre?.name ?? workspace.centerName, phone: centre?.phone ?? null, address: centre?.address ?? null, timezone: centre?.timezone ?? "Asia/Tashkent" }} /></div>
          <dl className="mt-4 divide-y divide-border/60 text-[12.5px]">
            {[[t("Centre code"), centre?.slug ?? "—"], [t("Time zone"), centre?.timezone ?? "Asia/Tashkent"], [t("Currency"), centre?.currency ?? "UZS"],
              [t("On LinguABC since"), centre ? new Date(centre.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"]].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">{t("Structure")}</h2>
          <ul className="mt-2 divide-y divide-border/60">
            {[["/branches", Building2, t("Branches and rooms"), t("Locations, their rooms and capacity")],
              ["/groups?tab=courses", BookOpen, t("Courses"), t("Programmes, levels and default monthly fees")],
              ["/staff", ShieldCheck, t("Staff and roles"), t("Invite people and choose what they can reach")]].map(([href, Icon, title, hint]) => {
              const I = Icon as typeof Building2;
              return (
                <li key={href as string}><Link href={href as string} className="flex items-center gap-3 py-3 hover:underline">
                  <I className="h-4 w-4 text-[#3B4A42]" /><span className="flex-1"><span className="block text-[13px] font-medium">{title as string}</span><span className="text-[11.5px] text-muted-foreground">{hint as string}</span></span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link></li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-5 py-4">
          <h2 className="text-[15px] font-semibold">{t("Roles and access")}</h2>
          <p className="text-[12px] text-muted-foreground">{t("The database enforces these rules; hiding a page does not grant or remove access.")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead><tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.1em] text-[#5F6B66]">
              <th className="px-5 py-3 font-medium" />{ROLES.map((r) => <th key={r} className="px-4 py-3 text-center font-medium">{t(r)}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border/50">
              {ACCESS.map(([what, can]) => (
                <tr key={what}><td className="px-5 py-2.5">{t(what)}</td>
                  {can.map((c, i) => <td key={i} className="px-4 py-2.5 text-center">{c ? <Check className="mx-auto h-4 w-4 text-[#3F6B4A]" /> : <Minus className="mx-auto h-4 w-4 text-muted-foreground/50" />}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">{t("Automatic messages")}</h2>
        <ul className="mt-2 space-y-1.5 text-[12.5px] text-[#3B4A42]">
          <li>· {t("Payment reminders: 3 days before a fee is due, then weekly while it is overdue, at 09:00 Tashkent time.")}</li>
          <li>· {t("Families hear about new invoices, payments, absences, new homework, mock results and lesson changes as they happen.")}</li>
          <li>· {t("Invitation links work for 14 days; staff can send a new link at any time.")}</li>
        </ul>
      </Card>
    </div>
  );
}
