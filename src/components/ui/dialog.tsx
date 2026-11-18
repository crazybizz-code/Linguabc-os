"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Modal built on the native <dialog> element (focus trap + Esc for free). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-[620px]",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] ${width} overflow-hidden text-left rounded-[18px] border border-border/70 bg-[#FCF8F4] p-0 text-[#17211D] shadow-[0_30px_80px_-30px_rgba(23,33,29,0.45)] backdrop:bg-[#17211D]/55`}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border/60 px-6 pb-4 pt-5">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
              {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-[#EFE6DF] hover:text-[#17211D]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-[#F7F0EA] px-6 py-3.5">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function FieldLabel({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1.5 block text-[11.5px] font-medium text-[#3B4A42]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10.5px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
