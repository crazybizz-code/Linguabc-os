import { redirect } from "next/navigation";
import { Building2, GraduationCap, Layers, Users } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Card, EmptyState, PageHeader, Progress, StatCard, inputClass } from "@/components/ui/primitives";
import { FieldLabel } from "@/components/ui/dialog";
import { FormDialog } from "@/components/workspace/form-dialog";
import { addBranch } from "../actions";

export const metadata = { title: "Branches" };

export default async function BranchesPage() {
  const { supabase, workspace, isStaff, isAdmin } = await getStaffContext();
  if (!isStaff) redirect("/dashboard");
  const center = workspace.centerId;
  const [branches, students, groups] = await Promise.all([
    supabase.from("branches").select("id, name, address, phone").eq("center_id", center).eq("status", "active").order("name"),
    supabase.from("student_overview").select("branch_id, status, attendance_pct").eq("center_id", center),
    supabase.from("group_overview").select("branch_id, mentor_id").eq("center_id", center).eq("status", "active"),
  ]);
  const br = branches.data ?? [];
  const st = students.data ?? [];
  const gr = groups.data ?? [];

  const addButton = isAdmin && (
    <FormDialog trigger="Add branch" title="Add branch" description="A branch is a location with its own rooms, groups and students." submitLabel="Add branch" action={addBranch} width="max-w-[480px]">
      <FieldLabel label="Branch name"><input name="name" required autoFocus placeholder="Chilonzor" className={inputClass} /></FieldLabel>
      <FieldLabel label="Address" hint="Optional"><input name="address" placeholder="Chilonzor 9, Tashkent" className={inputClass} /></FieldLabel>
      <FieldLabel label="Phone" hint="Optional"><input name="phone" type="tel" placeholder="+998 71 000 00 00" className={inputClass} /></FieldLabel>
    </FormDialog>
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Centre structure" title="Branches" description="Every branch as a business unit — its groups, mentors and students." actions={addButton} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Branches" value={br.length} hint="open locations" icon={Building2} />
        <StatCard label="Students" value={st.length} hint="across all branches" icon={Users} />
        <StatCard label="Mentors" value={new Set(gr.map((g) => g.mentor_id).filter(Boolean)).size} hint="teaching groups" icon={GraduationCap} />
        <StatCard label="Groups" value={gr.length} hint="classes running" icon={Layers} />
      </div>
      {br.length === 0 ? (
        <Card><EmptyState icon={Building2} title="No branches yet" description="Add your first location. Groups, rooms and students are organised by branch." action={addButton} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {br.map((b) => {
            const bs = st.filter((s) => s.branch_id === b.id);
            const bg = gr.filter((g) => g.branch_id === b.id);
            const atts = bs.map((s) => s.attendance_pct).filter((x): x is number => x != null);
            const att = atts.length ? Math.round(atts.reduce((a, x) => a + x, 0) / atts.length) : null;
            return (
              <Card key={b.id} className="p-5">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">Branch</p>
                <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.02em]">{b.name}</h3>
                {b.address && <p className="mt-0.5 text-[12px] text-muted-foreground">{b.address}</p>}
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="text-[30px] font-semibold leading-none tracking-[-0.03em]">{bs.length}</p>
                    <p className="mt-1.5 text-[12px] text-muted-foreground">students</p>
                  </div>
                  <div className="text-right text-[12px] text-muted-foreground">
                    <p><span className="text-[#17211D]">{new Set(bg.map((g) => g.mentor_id).filter(Boolean)).size}</span> mentors</p>
                    <p><span className="text-[#17211D]">{bg.length}</span> groups</p>
                  </div>
                </div>
                <div className="mt-5 flex justify-between text-[12px]">
                  <span className="text-muted-foreground">Attendance</span>
                  <span className="font-medium">{att == null ? "—" : `${att}%`}</span>
                </div>
                <div className="mt-2"><Progress value={att} /></div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
