"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { buttonPrimary } from "@/components/ui/primitives";
import type { ActionState } from "@/app/(staff)/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonPrimary}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {label}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <div role="alert" className="mb-4 rounded-[10px] bg-[#F8E1DE] px-3 py-2.5 text-[12.5px] text-[#B4483D]">{message}</div>;
}

/** A button that opens a dialog containing a server-action form. */
export function FormDialog({
  trigger,
  title,
  description,
  submitLabel,
  action,
  children,
  success,
  width,
}: {
  trigger: string;
  title: string;
  description?: string;
  submitLabel: string;
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children: ReactNode;
  /** Shown instead of the form after success; omit to close on success. */
  success?: (state: NonNullable<ActionState>) => ReactNode;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <button type="button" className={buttonPrimary} onClick={() => { setKey((k) => k + 1); setOpen(true); }}>
        <Plus className="h-4 w-4" /> {trigger}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description} width={width}>
        <Inner key={key} action={action} submitLabel={submitLabel} success={success} onDone={() => setOpen(false)} onCancel={() => setOpen(false)}>
          {children}
        </Inner>
      </Dialog>
    </>
  );
}

function Inner({
  action,
  submitLabel,
  success,
  onDone,
  onCancel,
  children,
}: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  submitLabel: string;
  success?: (state: NonNullable<ActionState>) => ReactNode;
  onDone: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, undefined);
  useEffect(() => {
    if (state?.ok && !success) onDone();
  }, [state, success, onDone]);
  if (state?.ok && success) return <>{success(state)}</>;
  return (
    <form action={formAction}>
      <FormError message={state?.error} />
      <div className="space-y-4">{children}</div>
      <div className="mt-6 flex justify-end gap-2 border-t border-border/60 pt-4">
        <button type="button" onClick={onCancel} className="h-10 rounded-[11px] px-4 text-[13px] text-[#3B4A42] hover:bg-[#EFE6DF]">
          Cancel
        </button>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}
