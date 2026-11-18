"use client";

import { Printer } from "lucide-react";
import { buttonPrimary } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";

export function PrintButton() {
  const t = useT();
  return <button type="button" onClick={() => window.print()} className={buttonPrimary}><Printer className="h-4 w-4" /> {t("Print")}</button>;
}
