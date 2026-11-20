"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, Card, inputClass } from "@/components/ui/primitives";
import { FormError } from "@/components/workspace/form-dialog";
import { useT } from "@/i18n/client";
import { createTest } from "./actions";

export function NewTestForm() {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <Card className="p-5">
      <form action={(f) => start(async () => {
        setError(undefined);
        const r = await createTest(f);
        if (r.error || !r.id) setError(t(r.error ?? "Something went wrong. Try again."));
        else router.push(`/admin/tests/${r.id}`);
      })} className="space-y-3">
        <FormError message={error} />
        <div className="grid items-end gap-4 sm:grid-cols-[1fr_160px_120px_auto]">
        <FieldLabel label={t("Title")}><input name="title" required minLength={3} maxLength={200} placeholder={t("e.g. Listening Test 1")} className={inputClass} /></FieldLabel>
        <FieldLabel label={t("Skill")}>
          <select name="skill" className={inputClass}><option value="listening">{t("Listening")}</option><option value="reading">{t("Reading")}</option></select>
        </FieldLabel>
        <FieldLabel label={t("Level")}>
          <select name="level" defaultValue="B2" className={inputClass}>{["B1", "B2", "C1"].map((l) => <option key={l}>{l}</option>)}</select>
        </FieldLabel>
        <button disabled={pending} className={buttonPrimary}>{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t("New test")}</button>
        </div>
      </form>
    </Card>
  );
}
