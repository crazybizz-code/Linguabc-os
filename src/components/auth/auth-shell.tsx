import type { ReactNode } from "react";
import { Layers, ShieldCheck, Sparkles } from "lucide-react";

/** Two-column auth layout from the approved Base44 design. */
export function AuthShell({
  title,
  subtitle,
  eyebrow,
  footer,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F5ECE8] lg:grid lg:grid-cols-[1.02fr_1fr]">
      <aside className="relative hidden flex-col justify-between bg-[#12392B] px-12 py-11 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#FCF8F4]/[0.12]">
            <Sparkles className="h-4 w-4 text-[#E8DCCB]" strokeWidth={1.8} />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-[-0.02em] text-[#FAF5EF]">LinguABC</div>
            <div className="text-[10px] tracking-[0.09em] text-[#7E9A8B]">ACADEMIC OS</div>
          </div>
        </div>
        <div className="max-w-[380px]">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8FAA9C]">One centre, one record</p>
          <h2 className="mt-3 text-[30px] font-semibold leading-[1.15] tracking-[-0.035em] text-[#FAF5EF]">
            The operating system behind a well-run learning centre.
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-[#A9C0B4]">
            Administration, academics and family communication share a single student record — so every role sees
            the same truth.
          </p>
          <div className="mt-7 space-y-2.5">
            {[
              { icon: ShieldCheck, text: "Your role is assigned by your centre" },
              { icon: Layers, text: "Owner, staff, student and parent — one dataset" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2.5 text-[12px] text-[#C9DACF]">
                <Icon className="h-3.5 w-3.5 shrink-0 text-[#8FAA9C]" strokeWidth={1.9} />
                {text}
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10.5px] leading-relaxed text-[#6E8B7C]">linguabc.xyz</p>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[404px]">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#12392B]">
              <Sparkles className="h-[14px] w-[14px] text-[#E8DCCB]" strokeWidth={1.9} />
            </div>
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#17211D]">LinguABC</span>
          </div>
          {eyebrow && (
            <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#7A8F7F]">{eyebrow}</p>
          )}
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-[#17211D]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{subtitle}</p>}
          <div className="mt-6 rounded-[18px] border border-border/70 bg-[#FCF8F4] p-6 shadow-[0_1px_2px_rgba(23,33,29,0.03),0_18px_40px_-28px_rgba(23,33,29,0.28)]">
            {children}
          </div>
          {footer && <div className="mt-5 text-center text-[12px] text-muted-foreground">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
