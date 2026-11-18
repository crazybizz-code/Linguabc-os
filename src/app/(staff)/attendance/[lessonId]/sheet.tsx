"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Avatar, buttonPrimary, cn } from "@/components/ui/primitives";
import { saveAttendance } from "../../actions";
import { useT } from "@/i18n/client";

const OPTIONS = [
  ["present", "Present", "bg-[#3F6B4A] text-white border-[#3F6B4A]"],
  ["late", "Late", "bg-[#C9773A] text-white border-[#C9773A]"],
  ["absent", "Absent", "bg-[#B4483D] text-white border-[#B4483D]"],
  ["excused", "Excused", "bg-[#5F6B66] text-white border-[#5F6B66]"],
] as const;

export function AttendanceSheet({ lessonId, students, initial }: { lessonId: string; students: { id: string; name: string }[]; initial: Record<string, string> }) {
  const [marks, setMarks] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const t = useT();
  const unmarked = students.filter((s) => !marks[s.id]).length;

  if (!students.length) return <p className="p-6 text-[13px] text-muted-foreground">{t("No students were enrolled in this group on that day.")}</p>;

  return (
    <>
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <span className="text-[12.5px] text-muted-foreground">{t("{a} of {b} marked", { a: students.length - unmarked, b: students.length })}</span>
        <button type="button" onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, marks[s.id] ?? "present"])))}
          className="text-[12.5px] font-medium text-[#12392B] hover:underline">{t("Mark the rest present")}</button>
      </div>
      <ul className="divide-y divide-border/50">
        {students.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <Avatar name={s.name} size="sm" />
            <span className="min-w-[140px] flex-1 text-[13.5px] font-medium">{s.name}</span>
            <div className="flex gap-1.5">
              {OPTIONS.map(([v, label, on]) => (
                <button key={v} type="button" onClick={() => { setSaved(false); setMarks((m) => ({ ...m, [s.id]: v })); }}
                  className={cn("h-8 rounded-[8px] border px-2.5 text-[12px] font-medium transition-colors", marks[s.id] === v ? on : "border-border/80 text-[#3B4A42] hover:bg-white")}>
                  {t(label)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-3 border-t border-border/60 bg-[#F7F0EA] px-5 py-3.5">
        {error && <span className="text-[12.5px] text-[#B4483D]">{error}</span>}
        {saved && <span className="flex items-center gap-1 text-[12.5px] text-[#3F6B4A]"><Check className="h-4 w-4" /> {t("Saved")}</span>}
        <button type="button" disabled={pending || unmarked === students.length} className={buttonPrimary}
          onClick={() => start(async () => {
            setError(undefined);
            const r = await saveAttendance(lessonId, marks);
            if (r?.error) setError(t(r.error));
            else { setSaved(true); router.refresh(); }
          })}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save attendance")}
        </button>
      </div>
    </>
  );
}
