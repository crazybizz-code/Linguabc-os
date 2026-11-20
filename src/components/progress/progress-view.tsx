import { Badge, cn, type Tone } from "@/components/ui/primitives";
import type { T } from "@/i18n";
import type { Progress } from "@/lib/progress";
import { Columns, DataTable, Line } from "./charts";

/**
 * One learner's progress, shared by Student 360, the student portal and
 * the parent portal. Basic trends only: attendance by month, homework
 * scores by month, and bands across mocks.
 */
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const STATUS_TONE: Record<string, Tone> = { reviewed: "green", submitted: "blue", missed: "red", in_progress: "amber", not_started: "neutral" };
const STATUS_LABEL: Record<string, string> = { reviewed: "Reviewed", submitted: "Submitted", missed: "Missed", in_progress: "In progress", not_started: "Not started" };

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-[14px] border border-border/70 bg-[#FCF8F4] p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#5F6B66]">{label}</p>
      <p className="mt-1 text-[24px] font-semibold tracking-[-0.02em] tabular-nums">{value}</p>
      {hint && <p className={cn("text-[12px]", tone === "good" ? "text-[#2F5A3B]" : tone === "bad" ? "text-[#B4483D]" : "text-muted-foreground")}>{hint}</p>}
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] border border-border/70 bg-[#FCF8F4] p-4">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {sub && <p className="text-[12px] text-muted-foreground">{sub}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function ProgressView({ p, t, locale, familyView = false }: { p: Progress; t: T; locale: string; familyView?: boolean }) {
  const month = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString(locale, { month: "short" });
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { timeZone: "Asia/Tashkent", day: "numeric", month: "short", year: "numeric" });
  const band = (v: number | null) => (v == null ? "—" : v.toFixed(1));
  const change = p.bandChange;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={t("Attendance")} value={p.attendancePct == null ? "—" : `${p.attendancePct}%`}
          hint={p.attendancePct == null ? t("No lessons marked yet") : p.attendancePct < 75 ? t("Below 75% — at risk") : p.attendancePct < 85 ? t("Needs attention") : t("On track")}
          tone={p.attendancePct == null ? undefined : p.attendancePct < 75 ? "bad" : p.attendancePct >= 85 ? "good" : undefined} />
        <Tile label={t("Homework done")} value={p.homeworkDue ? `${p.homeworkDone}/${p.homeworkDue}` : "—"}
          hint={p.homeworkOnTimePct == null ? undefined : t("{n}% on time", { n: p.homeworkOnTimePct })} />
        <Tile label={t("Homework average")} value={p.homeworkAvg == null ? "—" : `${p.homeworkAvg}%`} hint={p.homeworkAvg == null ? t("No marked work yet") : undefined} />
        <Tile label={t("Latest mock")} value={band(p.latestBand)}
          hint={change == null ? (p.latestBand == null ? (familyView ? t("No results sent yet") : t("No completed mock yet")) : undefined)
            : change === 0 ? t("Same as the last mock") : t(change > 0 ? "+{n} since the last mock" : "{n} since the last mock", { n: change.toFixed(1) })}
          tone={change == null || change === 0 ? undefined : change > 0 ? "good" : "bad"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Attendance by month")} sub={t("Share of marked lessons attended (late counts as attended)")}>
          <Columns ariaLabel={t("Attendance by month")}
            points={p.attendanceByMonth.map((m) => ({ label: month(m.month), value: m.value, tip: m.value == null ? `${month(m.month)}: —` : `${month(m.month)}: ${m.value}% (${m.detail})` }))} />
          <DataTable summary={t("Show as table")} head={[t("Month"), t("Attended"), "%"]}
            rows={p.attendanceByMonth.map((m) => [month(m.month), m.detail || "—", m.value == null ? "—" : `${m.value}%`])} />
        </Panel>
        <Panel title={t("Homework score by month")} sub={t("Average auto-marked or reviewed score")}>
          <Line ariaLabel={t("Homework score by month")} max={100} ticks={[0, 50, 100]} unit="%"
            points={p.homeworkByMonth.map((m) => ({ label: month(m.month), value: m.value, tip: m.value == null ? `${month(m.month)}: —` : `${month(m.month)}: ${m.value}% (${t("{n} marked", { n: m.detail })})` }))} />
          <DataTable summary={t("Show as table")} head={[t("Month"), t("Marked"), t("Average")]}
            rows={p.homeworkByMonth.map((m) => [month(m.month), m.detail || "0", m.value == null ? "—" : `${m.value}%`])} />
        </Panel>
      </div>

      <Panel title={t("Mock results")} sub={familyView ? t("Results your mentor has sent") : t("Completed mocks, oldest first")}>
        {p.mocks.length === 0 ? (
          <p className="py-3 text-[13px] text-muted-foreground">{familyView ? t("No mock results have been sent yet.") : t("No completed mock yet.")}</p>
        ) : (
          <>
            {p.mocks.length > 1 && (
              <Line ariaLabel={t("Overall band by mock")} min={0} max={9} ticks={[0, 3, 6, 9]} decimals={1}
                points={p.mocks.map((m) => ({ label: date(m.date).replace(/,? \d{4}$/, ""), value: m.overall, tip: `${m.name}: ${t("Overall")} ${band(m.overall)}` }))} />
            )}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-[12.5px] tabular-nums">
                <thead><tr className="text-muted-foreground">{[t("Mock"), t("Date"), "L", "R", "W", "S", t("Overall")].map((h) => <th key={h} className="py-1.5 pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {[...p.mocks].reverse().map((m, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1.5 pr-3 font-medium">{m.name}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{m.date ? date(m.date) : "—"}</td>
                      <td className="py-1.5 pr-3">{band(m.listening)}</td>
                      <td className="py-1.5 pr-3">{band(m.reading)}</td>
                      <td className="py-1.5 pr-3">{band(m.writing)}</td>
                      <td className="py-1.5 pr-3">{band(m.speaking)}</td>
                      <td className="py-1.5 pr-3 font-semibold">{band(m.overall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Panel title={t("Homework history")} sub={t("Most recent first")}>
          {p.homework.length === 0 ? <p className="py-3 text-[13px] text-muted-foreground">{t("No homework set yet.")}</p> : (
            <ul className="divide-y divide-border/50">
              {p.homework.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{h.title}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {[h.skill ? t(cap(h.skill)) : null, t("Due {date}", { date: date(h.due_at) }), h.onTime === false ? t("late") : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {h.score != null && <span className="text-[13px] font-semibold tabular-nums">{Math.round(h.score)}%</span>}
                  <Badge tone={STATUS_TONE[h.status] ?? "neutral"}>{t(STATUS_LABEL[h.status] ?? cap(h.status))}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("Homework by skill")} sub={t("Average score")}>
          {p.bySkill.length === 0 ? <p className="py-3 text-[13px] text-muted-foreground">{t("No marked work yet")}</p> : (
            <ul className="space-y-2.5">
              {p.bySkill.map((s) => (
                <li key={s.skill}>
                  <div className="flex justify-between text-[12.5px]"><span>{t(cap(s.skill))} <span className="text-muted-foreground">· {s.count}</span></span><span className="font-semibold tabular-nums">{s.avg}%</span></div>
                  <div className="mt-1 h-2 rounded-full bg-[#EDE5DE]"><div className="h-2 rounded-full bg-[#2E7D4F]" style={{ width: `${s.avg ?? 0}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
