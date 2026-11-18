import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-[18px] border border-border/70 bg-[#FCF8F4] shadow-[0_1px_2px_rgba(23,33,29,0.03)]", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#5F6B66]">{eyebrow}</p>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-[#17211D]">{title}</h1>
        {description && <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/70" strokeWidth={1.7} />}
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em] text-[#17211D]">{value}</p>
      {hint && <p className="mt-2 text-[11.5px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

const TONES = {
  green: "bg-[#E7EFE4] text-[#3F6B4A]",
  amber: "bg-[#FBEEDC] text-[#9A5B1E]",
  red: "bg-[#F8E1DE] text-[#B4483D]",
  neutral: "bg-[#EFE6DF] text-[#5F6B66]",
  blue: "bg-[#E4ECF1] text-[#3E6378]",
  dark: "bg-[#12392B] text-[#FAF5EF]",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", dot = true, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium", TONES[tone])}>
      {dot && <span className="h-1 w-1 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-[#EBDDCB] font-semibold text-[#3B4A42]",
        size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-[11px]",
      )}
    >
      {initials || "?"}
    </span>
  );
}

export function Progress({ value, tone = "green" }: { value: number | null; tone?: "green" | "amber" }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#EADFD6]">
      <div className={cn("h-full rounded-full", tone === "amber" ? "bg-[#C9773A]" : "bg-[#12392B]")} style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[#EFE6DF]">
        <Icon className="h-5 w-5 text-[#12392B]" strokeWidth={1.8} />
      </div>
      <p className="mt-4 text-[14px] font-semibold text-[#17211D]">{title}</p>
      <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const buttonPrimary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[11px] bg-[#12392B] px-4 text-[13px] font-medium text-[#FAF5EF] transition-colors hover:bg-[#0D3024] disabled:opacity-50";
export const buttonSecondary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[11px] border border-border/80 bg-[#FCF8F4] px-4 text-[13px] font-medium text-[#17211D] transition-colors hover:bg-white disabled:opacity-50";
export const inputClass =
  "h-10 w-full rounded-[10px] border border-border/80 bg-[#FCF8F4] px-3 text-[13px] text-[#17211D] placeholder:text-muted-foreground/60 focus:border-[#12392B]/35 focus:outline-none focus:ring-2 focus:ring-[#12392B]/10 transition";

export function formatUZS(amount: number | null | undefined) {
  if (amount == null) return "—";
  return `${Math.round(amount).toLocaleString("en-US")} UZS`;
}

/** Adds thousands separators to long numbers in free text ("500000 UZS" → "500,000 UZS"). */
export function prettyNumbers(text: string | null | undefined) {
  return (text ?? "").replace(/\b\d{4,}\b/g, (n) => Number(n).toLocaleString("en-US"));
}
