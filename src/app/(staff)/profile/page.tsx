import { getStaffContext } from "@/lib/auth/current";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ROLE_LABEL } from "@/lib/auth/workspace";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Profile" };

/** Who you are in this centre, and your password. */
export default async function ProfilePage() {
  const { supabase, workspace, userId, t } = await getStaffContext();
  const [{ data: profile }, { data: user }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle(),
    supabase.auth.getUser(),
  ]);
  const email = user.user?.email ?? "";
  const rows: [string, string][] = [
    [t("Name"), workspace.fullName || profile?.full_name || "—"],
    [t("Role"), t(ROLE_LABEL[workspace.role])],
    [t("Centre"), workspace.centerName],
    [t("Phone"), profile?.phone ?? "—"],
    [t("Email"), email.endsWith("@phone.linguabc.xyz") ? "—" : email || "—"],
  ];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Account")} title={t("Profile")} description={t("Who you are in this centre, and how you sign in.")} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="divide-y divide-border/60">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <span className="text-[12.5px] text-muted-foreground">{k}</span>
              <span className="text-[13.5px] font-medium">{v}</span>
            </div>
          ))}
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">{t("Change password")}</h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{t("Use at least 8 characters.")}</p>
          <PasswordForm />
        </Card>
      </div>
    </div>
  );
}
