import { notFound } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current";
import { formatUZS } from "@/components/ui/primitives";
import { PrintButton } from "./print-button";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Receipt" };
const METHOD: Record<string, string> = { cash: "Cash", card: "Card", bank_transfer: "Bank transfer", click: "Click", payme: "Payme", uzum: "Uzum" };

export default async function ReceiptPage({ params }: PageProps<"/payments/receipt/[id]">) {
  const { id } = await params;
  const { supabase, workspace, t, locale } = await getStaffContext();
  const { data: p } = await supabase.from("payments").select("*, students(full_name), invoices(period), memberships!payments_received_by_center_id_fkey(full_name)").eq("id", id).maybeSingle();
  if (!p) notFound();
  const rows: [string, string][] = [
    [t("Receipt"), p.receipt_no],
    [t("Date"), new Date(p.paid_at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" })],
    [t("Student"), p.students?.full_name ?? "—"],
    [t("For"), p.invoices?.period ? t("{month} tuition", { month: new Date(`${p.invoices.period}T00:00:00Z`).toLocaleString(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" }) }) : t("Tuition")],
    [t("Method"), t(METHOD[p.method] ?? p.method)],
    [t("Received by"), p.memberships?.full_name ?? "—"],
  ];
  if (p.note) rows.push([t("Note"), p.note]);
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-[18px] border border-border/70 bg-white p-8 print:border-0 print:p-0">
        <p className="text-[12px] font-semibold tracking-[-0.01em] text-[#12392B]">{workspace.centerName}</p>
        <h1 className="mt-4 text-[13px] uppercase tracking-[0.12em] text-[#5F6B66]">{p.kind === "refund" ? t("Refund receipt") : t("Payment receipt")}</h1>
        <p className="mt-1 text-[30px] font-semibold tracking-[-0.03em]">{p.kind === "refund" ? "−" : ""}{formatUZS(p.amount)}</p>
        <dl className="mt-6 divide-y divide-border/60 border-y border-border/60 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-6 text-[11px] text-muted-foreground">{t("Issued by LinguABC")} · app.linguabc.xyz</p>
      </div>
      <div className="mt-4 flex justify-center print:hidden"><PrintButton /></div>
    </div>
  );
}
