import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { ROLE_LABEL } from "@/lib/auth/workspace";
import { siteUrl } from "@/lib/supabase/config";
import { Avatar, Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CopyLink, InviteStaff } from "./invite-staff";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const { supabase, workspace, isStaff, isAdmin } = await getStaffContext();
  if (!isStaff) redirect("/dashboard");
  const center = workspace.centerId;
  const [members, groups, branches] = await Promise.all([
    supabase.from("memberships").select("id, full_name, email, phone, role, status, invite_code, branch_id").eq("center_id", center)
      .in("role", ["owner", "admin", "academic_manager", "mentor"]).order("created_at"),
    supabase.from("group_overview").select("mentor_id, student_count").eq("center_id", center).eq("status", "active"),
    supabase.from("branches").select("id, name").eq("center_id", center).order("name"),
  ]);
  const branchName = new Map((branches.data ?? []).map((b) => [b.id, b.name]));
  const gr = groups.data ?? [];
  const rows = members.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Team"
        title="Staff"
        description="Who runs the centre, what each role can reach, and which groups they own."
        actions={isAdmin && <InviteStaff isOwner={workspace.role === "owner"} branches={branches.data ?? []} />}
      />
      <Card className="overflow-hidden">
        {rows.length <= 1 && (
          <EmptyState icon={ShieldCheck} title="Only you so far" description="Invite administrators, academic managers and mentors. Each gets a personal link and lands in their own workspace." />
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-border/60 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Branch</th>
                <th className="px-3 py-3 font-medium">Groups</th>
                <th className="px-3 py-3 font-medium">Students</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((m) => {
                const mg = gr.filter((g) => g.mentor_id === m.id);
                const students = mg.reduce((a, g) => a + (g.student_count ?? 0), 0);
                return (
                  <tr key={m.id} className="align-middle">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.full_name} />
                        <div>
                          <p className="text-[13px] font-medium">{m.full_name}</p>
                          <p className="text-[11.5px] text-muted-foreground">{m.email ?? m.phone ?? "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3"><Badge tone="neutral" dot={false}>{ROLE_LABEL[m.role]}</Badge></td>
                    <td className="px-3 py-3 text-[12.5px] text-muted-foreground">{m.branch_id ? branchName.get(m.branch_id) : "All branches"}</td>
                    <td className="px-3 py-3 text-[13px]">{mg.length}</td>
                    <td className="px-3 py-3 text-[13px]">{m.role === "mentor" ? students : "—"}</td>
                    <td className="px-5 py-3">
                      {m.status === "active" && <Badge tone="green">Active</Badge>}
                      {m.status === "suspended" && <Badge tone="red">Suspended</Badge>}
                      {m.status === "invited" && (
                        <div className="max-w-[300px] space-y-1.5">
                          <Badge tone="amber">Invited</Badge>
                          {isAdmin && m.invite_code && <CopyLink link={`${siteUrl()}/join?code=${m.invite_code}`} />}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
