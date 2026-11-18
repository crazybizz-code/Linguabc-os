"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { Avatar, Badge, EmptyState, formatUZS, type Tone } from "@/components/ui/primitives";
import { RecordPayment } from "./record-payment";

export type InvoiceRow = {
  id: string;
  studentId: string;
  student: string;
  group: string;
  amount: number;
  balance: number;
  dueDate: string;
  status: "paid" | "partial" | "pending" | "overdue" | "void";
  lastPayment: string | null;
  lastPaymentId: string | null;
  parent: string;
};

const TONE: Record<string, Tone> = { paid: "green", partial: "amber", pending: "amber", overdue: "red", void: "neutral" };
const filterClass = "h-9 rounded-[10px] border border-border/80 bg-[#FCF8F4] pl-3 pr-8 text-[12.5px] text-[#17211D] focus:outline-none";

export function PaymentsTable({ rows, periodLabel }: { rows: InvoiceRow[]; periodLabel: string }) {
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState("");
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  const filtered = useMemo(() => rows.filter((r) => (!group || r.group === group) && (!status || r.status === status)), [rows, group, status]);

  if (!rows.length) {
    return <EmptyState icon={Wallet} title={`No invoices for ${periodLabel}`} description="Invoices are created when a student is enrolled, and for every active student when you run the monthly billing." />;
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4">
        <select value={group} onChange={(e) => setGroup(e.target.value)} className={filterClass}>
          <option value="">Group: All</option>
          {groups.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={filterClass}>
          <option value="">Status: All</option>
          {["paid", "partial", "pending", "overdue"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <span className="ml-auto text-[12px] text-muted-foreground">{filtered.length} records</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left">
          <thead>
            <tr className="border-b border-border/60 text-[10.5px] uppercase tracking-[0.1em] text-[#5F6B66]">
              {["Student", "Group", "Monthly fee", "Due date", "Status", "Outstanding", "Last payment", "Parent", ""].map((h, i) => (
                <th key={i} className="px-4 py-3 font-medium first:pl-5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50 text-[12.5px]">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-white/50">
                <td className="py-3 pl-5 pr-4">
                  <Link href={`/students/${r.studentId}?tab=payments`} className="flex items-center gap-3 hover:underline">
                    <Avatar name={r.student} size="sm" />
                    <span className="text-[13px] font-medium text-[#17211D]">{r.student}</span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-[#3B4A42]">{r.group}</td>
                <td className="px-4 py-3">{formatUZS(r.amount)}</td>
                <td className="px-4 py-3 text-[#3B4A42]">{r.dueDate}</td>
                <td className="px-4 py-3"><Badge tone={TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge></td>
                <td className="px-4 py-3">{r.balance > 0 ? formatUZS(r.balance) : "—"}</td>
                <td className="px-4 py-3 text-[#3B4A42]">
                  {r.lastPayment ? <Link href={`/payments/receipt/${r.lastPaymentId}`} target="_blank" className="hover:underline">{r.lastPayment}</Link> : "—"}
                </td>
                <td className="px-4 py-3 text-[#3B4A42]">{r.parent}</td>
                <td className="px-4 py-3 text-right">
                  {r.balance > 0 && r.status !== "void" && <RecordPayment compact invoiceId={r.id} student={r.student} balance={r.balance} period={r.dueDate.slice(0, 7)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
