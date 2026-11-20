import Link from "next/link";
import { redirect } from "next/navigation";
import { HeartHandshake } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { siteUrl } from "@/lib/supabase/config";
import { Avatar, Badge, Card, EmptyState, formatUZS, PageHeader, cn } from "@/components/ui/primitives";
import { InviteLink } from "../staff/invite-staff";
import { LoginInvite } from "../students/[id]/login-invite";
import { inviteParentLogin } from "../actions";

export const metadata = { title: "Parents" };

type Row = {
  key: string; name: string; phone: string | null; relationship: string | null;
  guardianId: string; membership: { id: string; status: string; invite_code: string | null; invite_expires_at: string | null } | null;
  children: { id: string; name: string; balance: number; overdue: number }[];
};

/** Every family in one place: who the parent is, their children, portal access and money owed. Owner and admin only. */
export default async function ParentsPage({ searchParams }: PageProps<"/parents">) {
  const { supabase, workspace, isAdmin, t } = await getStaffContext();
  if (!isAdmin) redirect("/dashboard");
  const { q, portal } = await searchParams;
  const center = workspace.centerId;
  const [guardians, students] = await Promise.all([
    supabase.from("guardians").select("id, student_id, full_name, phone, relationship, is_primary, membership_id, memberships!guardians_membership_id_center_id_fkey(id, status, invite_code, invite_expires_at)")
      .eq("center_id", center).order("full_name"),
    supabase.from("student_overview").select("id, full_name, status, open_balance, overdue_count").eq("center_id", center),
  ]);
  const student = new Map((students.data ?? []).map((s) => [s.id, s]));

  // One row per parent: the same login, or else the same phone (or name), across children.
  const rows = new Map<string, Row>();
  for (const g of guardians.data ?? []) {
    const key = g.membership_id ?? (g.phone ? `p:${g.phone.replace(/\D/g, "")}` : `n:${g.full_name.toLowerCase()}`);
    const row = rows.get(key) ?? { key, name: g.full_name, phone: g.phone, relationship: g.relationship, guardianId: g.id, membership: null, children: [] };
    const m = g.memberships as Row["membership"];
    if (m && (!row.membership || m.status === "active")) { row.membership = m; row.guardianId = g.id; }
    const s = student.get(g.student_id);
    if (s && !row.children.some((c) => c.id === s.id)) row.children.push({ id: s.id!, name: s.full_name ?? "—", balance: Number(s.open_balance ?? 0), overdue: Number(s.overdue_count ?? 0) });
    rows.set(key, row);
  }
  const all = [...rows.values()];
  const query = typeof q === "string" ? q.trim().toLowerCase() : "";
  const status = (r: Row) => (r.membership?.status === "active" ? "active" : r.membership?.status === "invited" ? "invited" : "none");
  const shown = all.filter((r) => (!query || r.name.toLowerCase().includes(query) || (r.phone ?? "").includes(query) || r.children.some((c) => c.name.toLowerCase().includes(query)))
    && (typeof portal !== "string" || !portal || status(r) === portal));
  const count = (s: string) => all.filter((r) => status(r) === s).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Parent experience")} title={t("Parents")}
        description={t("One row per family, connected to the student records their children's progress lives on.")} />
      <Card className="grid grid-cols-2 divide-border/60 md:grid-cols-4 md:divide-x">
        {[[t("Families"), all.length], [t("Portal active"), count("active")], [t("Invited"), count("invited")], [t("No portal access"), count("none")]].map(([k, v]) => (
          <div key={String(k)} className="p-5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{k}</p>
            <p className="mt-2 text-[24px] font-semibold tracking-[-0.03em]">{v}</p>
          </div>
        ))}
      </Card>
      <Card className="overflow-hidden">
        <form className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4">
          <input name="q" defaultValue={query} placeholder={t("Search a parent, phone or child")} className="h-9 min-w-[240px] flex-1 rounded-[10px] border border-border/80 bg-[#FCF8F4] px-3 text-[12.5px]" />
          <select name="portal" defaultValue={typeof portal === "string" ? portal : ""} className="h-9 rounded-[10px] border border-border/80 bg-[#FCF8F4] px-3 text-[12.5px]">
            <option value="">{t("Portal: all")}</option>
            <option value="active">{t("Portal active")}</option>
            <option value="invited">{t("Invited")}</option>
            <option value="none">{t("No portal access")}</option>
          </select>
          <button className="h-9 rounded-[10px] bg-[#12392B] px-4 text-[12.5px] font-medium text-[#FAF5EF]">{t("Filter")}</button>
        </form>
        {shown.length === 0 ? (
          <EmptyState icon={HeartHandshake} title={t("No parents yet")} description={t("Parents are added with each student. Open a student to add a parent or guardian.")} />
        ) : (
          <ul className="divide-y divide-border/50">
            {shown.map((r) => {
              const owed = r.children.reduce((n, c) => n + c.balance, 0);
              const late = r.children.some((c) => c.overdue > 0);
              return (
                <li key={r.key} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="flex min-w-[240px] items-center gap-3">
                    <Avatar name={r.name} />
                    <div>
                      <p className="text-[13.5px] font-medium">{r.name}</p>
                      <p className="text-[12px] text-muted-foreground">{[r.relationship && t(r.relationship[0].toUpperCase() + r.relationship.slice(1)), r.phone].filter(Boolean).join(" · ") || "—"}</p>
                      <p className="mt-0.5 text-[12px]">
                        {r.children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/students/${c.id}`} className="text-[#12392B] hover:underline">{c.name}</Link></span>)}
                      </p>
                    </div>
                  </div>
                  <div className={cn("text-[12.5px]", late ? "font-medium text-[#B4483D]" : "text-muted-foreground")}>
                    {owed > 0 ? `${formatUZS(owed)} ${t(late ? "overdue" : "to pay")}` : t("Nothing owed")}
                  </div>
                  <div className="min-w-[260px]">
                    {r.membership?.status === "active" ? <Badge tone="green">{t("Parent portal active")}</Badge>
                      : r.membership?.status === "invited" && r.membership.invite_code
                        ? <InviteLink membershipId={r.membership.id} link={`${siteUrl()}/join?code=${r.membership.invite_code}`} expiresAt={r.membership.invite_expires_at} canReissue />
                        : <LoginInvite label={t("Invite to parent portal")} field="guardian_id" value={r.guardianId} action={inviteParentLogin} who={r.name} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
