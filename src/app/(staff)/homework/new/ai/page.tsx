import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { AiFlow } from "../drafting";

export const metadata = { title: "Create with AI" };
// AI drafting and audio generation can take a minute or two.
export const maxDuration = 180;

export default async function Page() {
  const { t } = await getStaffContext();
  return (
    <div className="space-y-5">
      <Link href="/homework/new" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Create assignment")}</Link>
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.03em]">{t("Create with AI")}</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">{t("Describe the exact sub-skill you want to drill this week.")}</p>
      </div>
      <AiFlow />
    </div>
  );
}
