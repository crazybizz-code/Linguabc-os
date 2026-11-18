import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/ui/primitives";

export function PortalCard({ icon: Icon, title, action, children, className }: { icon?: LucideIcon; title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[18px] border border-border/70 bg-[#FCF8F4] p-4 shadow-[0_1px_2px_rgba(23,33,29,0.03)]", className)}>
      {title && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">
            {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />}
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-border/70 bg-white/50 p-3">
      <p className="text-[11.5px] font-medium leading-tight text-[#5F6B66]">{label}</p>
      <p className={cn("mt-1 text-[20px] font-semibold tracking-[-0.02em]", warn && "text-[#9A5B1E]")}>{value}</p>
    </div>
  );
}
