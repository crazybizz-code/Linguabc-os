"use client";

import { Printer } from "lucide-react";
import { buttonPrimary } from "@/components/ui/primitives";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={buttonPrimary}><Printer className="h-4 w-4" /> Print</button>;
}
