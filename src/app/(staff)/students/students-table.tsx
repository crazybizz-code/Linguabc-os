"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { Avatar, Badge, EmptyState, cn, inputClass, type Tone } from "@/components/ui/primitives";

const filterClass =
  "h-9 rounded-[10px] border border-border/80 bg-[#FCF8F4] pl-3 pr-8 text-[12.5px] text-[#17211D] focus:border-[#12392B]/35 focus:outline-none focus:ring-2 focus:ring-[#12392B]/10";

export type StudentRow = {
  id: string;
  name: string;
  phone: string | null;
  branch: string;
  course: string;
  group: string;
  groupId: string;
  mentor: string;
  attendance: number | null;
  payment: "Paid" | "Pending" | "Overdue" | "Lead" | null;
  academic: "On track" | "Needs attention" | "At risk" | "New";
  status: string;
  lastActivity: string | null;
};

const PAY_TONE: Record<string, Tone> = { Paid: "green", Pending: "amber", Overdue: "red", Lead: "neutral" };
const ACAD_TONE: Record<string, Tone> = { "On track": "green", "Needs attention": "amber", "At risk": "red", New: "neutral" };

function ago(iso: string | null) {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export function StudentsTable({ rows, showPayment }: { rows: StudentRow[]; showPayment: boolean }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState({ branch: "", group: "", status: "", payment: "" });
  const uniq = (k: keyof StudentRow) => [...new Set(rows.map((r) => String(r[k] ?? "")).filter((x) => x && x !== "—"))].sort();
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!s || r.name.toLowerCase().includes(s) || (r.phone ?? "").replace(/\s/g, "").includes(s.replace(/\s/g, ""))) &&
        (!f.branch || r.branch === f.branch) &&
        (!f.group || r.group === f.group) &&
        (!f.status || r.academic === f.status) &&
        (!f.payment || r.payment === f.payment),
    );
  }, [rows, q, f]);

  const select = (key: keyof typeof f, label: string, options: string[]) =>
    options.length > 0 && (
      <select value={f[key]} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} className={filterClass}>
        <option value="">{label}: All</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    );

  if (!rows.length) {
    return <EmptyState icon={Users} title="No students yet" description="Add your first student. Their attendance, homework, mock results and payments will all live on one record." />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" className={cn(inputClass, "h-9 pl-9 text-[12.5px]")} />
        </div>
        {select("branch", "Branch", uniq("branch"))}
        {select("group", "Group", uniq("group"))}
        {select("status", "Academic", ["On track", "Needs attention", "At risk", "New"])}
        {showPayment && select("payment", "Payment", ["Paid", "Pending", "Overdue", "Lead"])}
        <span className="ml-auto text-[12px] text-muted-foreground">{filtered.length} of {rows.length} students</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left">
          <thead>
            <tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.1em] text-[#5F6B66]">
              {["Student", "Course", "Group", "Mentor", "Attendance", ...(showPayment ? ["Payment"] : []), "Academic", "Last activity"].map((h) => (
                <th key={h} className="px-4 py-3 font-medium first:pl-5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((r) => (
              <tr key={r.id} className="text-[12.5px] hover:bg-white/50">
                <td className="py-3 pl-5 pr-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name} size="sm" />
                    <div>
                      <p className="text-[13px] font-medium text-[#17211D]">{r.name}</p>
                      <p className="text-[11.5px] text-muted-foreground">{[r.branch !== "—" && r.branch, r.phone].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-[#3B4A42]">{r.course}</td>
                <td className="px-4 py-3 text-[#3B4A42]">{r.group}</td>
                <td className="px-4 py-3 text-[#3B4A42]">{r.mentor}</td>
                <td className="px-4 py-3">
                  {r.attendance == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-[#EADFD6]">
                        <div className={cn("h-full", r.attendance < 85 ? "bg-[#C9773A]" : "bg-[#5F6B66]")} style={{ width: `${r.attendance}%` }} />
                      </div>
                      <span>{r.attendance}%</span>
                    </div>
                  )}
                </td>
                {showPayment && <td className="px-4 py-3">{r.payment ? <Badge tone={PAY_TONE[r.payment]}>{r.payment}</Badge> : "—"}</td>}
                <td className="px-4 py-3"><Badge tone={ACAD_TONE[r.academic]}>{r.academic}</Badge></td>
                <td className="px-4 py-3 text-muted-foreground">{ago(r.lastActivity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
