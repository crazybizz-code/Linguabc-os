"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Avatar, buttonPrimary, cn } from "@/components/ui/primitives";
import { saveMockResults, type MockRow } from "../../actions";
import { useT } from "@/i18n/client";

type Module = "reading" | "listening" | "writing" | "speaking";
type Row = { student_id: string; name: string; absent: boolean } & Record<Module, number | null>;
const BANDS = Array.from({ length: 19 }, (_, i) => i / 2);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** IELTS overall: mean of the four bands, rounded to the nearest half (x.25 → x.5, x.75 → x+1). */
function overall(r: Row) {
  const v = [r.reading, r.listening, r.writing, r.speaking];
  if (v.some((b) => b == null)) return null;
  return Math.floor(((v as number[]).reduce((a, b) => a + b, 0) / 4) * 2 + 0.5) / 2;
}

export function ResultsSheet({ sessionId, modules, initial, canEdit }: { sessionId: string; modules: Module[]; initial: Row[]; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const full = modules.length === 4;
  const done = rows.filter((r) => r.absent || modules.every((m) => r[m] != null)).length;
  const update = (id: string, patch: Partial<Row>) => { setSaved(false); setRows((rs) => rs.map((r) => (r.student_id === id ? { ...r, ...patch } : r))); };

  if (!rows.length) return <p className="p-6 text-[13px] text-muted-foreground">{t("Nobody was in this group when the session was created.")}</p>;

  return (
    <>
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <span className="text-[12.5px] text-muted-foreground">{t("{a} of {b} results entered", { a: done, b: rows.length })}</span>
        <span className="text-[11.5px] text-muted-foreground">{t("Bands 0–9 in steps of 0.5")}</span>
      </div>
      <ul className="divide-y divide-border/50">
        {rows.map((r) => {
          const o = full ? overall(r) : null;
          return (
            <li key={r.student_id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-3", r.absent && "bg-[#F7F0EA]/60")}>
              <div className="flex min-w-[180px] flex-1 items-center gap-3">
                <Avatar name={r.name} size="sm" />
                <span className="text-[13.5px] font-medium">{r.name}</span>
              </div>
              <div className="flex flex-wrap items-end gap-1.5 sm:gap-2">
                {modules.map((m) => (
                  <label key={m} className="flex flex-col">
                    <span className="mb-1 text-[10px] font-medium uppercase tracking-[0.06em] text-[#5F6B66]">{t(cap(m))}</span>
                    <select
                      aria-label={`${r.name} ${t(cap(m))}`}
                      disabled={!canEdit || r.absent}
                      value={r[m] ?? ""}
                      onChange={(e) => update(r.student_id, { [m]: e.target.value === "" ? null : Number(e.target.value) })}
                      className="h-9 w-[62px] rounded-[9px] sm:w-[74px] border border-border/80 bg-[#FCF8F4] px-2 text-[13px] tabular-nums disabled:opacity-50"
                    >
                      <option value="">—</option>
                      {BANDS.map((b) => <option key={b} value={b}>{b.toFixed(1)}</option>)}
                    </select>
                  </label>
                ))}
                {full && (
                  <div className="flex w-[64px] flex-col">
                    <span className="mb-1 text-[10px] font-medium uppercase tracking-[0.06em] text-[#5F6B66]">{t("Overall")}</span>
                    <span className="flex h-9 items-center text-[15px] font-semibold tabular-nums">{r.absent ? "—" : o?.toFixed(1) ?? "—"}</span>
                  </div>
                )}
                <button type="button" disabled={!canEdit} onClick={() => update(r.student_id, { absent: !r.absent })}
                  className={cn("h-9 rounded-[9px] border px-3 text-[12px] font-medium disabled:opacity-50",
                    r.absent ? "border-[#B4483D] bg-[#B4483D] text-white" : "border-border/80 text-[#3B4A42] hover:bg-white")}>
                  {t("Absent")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="flex items-center justify-end gap-3 border-t border-border/60 bg-[#F7F0EA] px-5 py-3.5">
          {error && <span className="text-[12.5px] text-[#B4483D]">{error}</span>}
          {saved && <span className="flex items-center gap-1 text-[12.5px] text-[#3F6B4A]"><Check className="h-4 w-4" /> {t("Saved")}</span>}
          <button type="button" disabled={pending} className={buttonPrimary}
            onClick={() => start(async () => {
              setError(undefined);
              const payload: MockRow[] = rows.map(({ student_id, absent, reading, listening, writing, speaking }) => ({ student_id, absent, reading, listening, writing, speaking }));
              const res = await saveMockResults(sessionId, payload);
              if (res?.error) setError(t(res.error));
              else { setSaved(true); router.refresh(); }
            })}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save results")}
          </button>
        </div>
      )}
    </>
  );
}
