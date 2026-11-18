import { notFound } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current";
import { ReceiptView } from "@/components/portal/receipt-view";
import { PrintButton } from "./print-button";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: PageProps<"/payments/receipt/[id]">) {
  const { id } = await params;
  const { supabase, workspace, t, locale } = await getStaffContext();
  const { data: p } = await supabase.from("payments").select("*, students(full_name), invoices(period), memberships!payments_received_by_center_id_fkey(full_name)").eq("id", id).maybeSingle();
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-md">
      <ReceiptView p={p} centerName={workspace.centerName} t={t} locale={locale} receivedBy={p.memberships?.full_name ?? null} />
      <div className="mt-4 flex justify-center print:hidden"><PrintButton /></div>
    </div>
  );
}
