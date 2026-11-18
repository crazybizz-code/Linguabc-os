"use client";

import { useTransition } from "react";
import { Globe } from "lucide-react";
import { LOCALES, type Locale } from "@/i18n";
import { cn } from "@/components/ui/primitives";

export function LanguageSwitch({ locale, onChange }: { locale: Locale; onChange: (l: string) => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <div className={cn("flex items-center gap-1 rounded-[12px] border border-border/70 bg-[#FCF8F4] p-1", pending && "opacity-60")}>
      <Globe className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
      {LOCALES.map((l) => (
        <button
          key={l.code}
          type="button"
          title={l.label}
          onClick={() => start(() => onChange(l.code))}
          className={cn(
            "rounded-[8px] px-2 py-1 text-[11.5px] font-medium uppercase",
            locale === l.code ? "bg-[#12392B] text-[#FAF5EF]" : "text-[#3B4A42] hover:bg-[#EFE6DF]",
          )}
        >
          {l.code}
        </button>
      ))}
    </div>
  );
}
