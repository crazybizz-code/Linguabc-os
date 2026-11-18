import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Avatar, Badge, Card, type Tone } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Homework" };
const TZ = "Asia/Tashkent";
const TONE: Record<string, Tone> = { not_started: "neutral", in_progress: "amber", submitted: "blue", reviewed: "green" };
const LABEL: Record<string, string> = { not_started: "Not started", in_progress: "In progress", submitted: "Submitted", reviewed: "Reviewed" };

export default async function HomeworkDetailPage({ params }: PageProps<"/homework/[id]">) {
  const { id } = await params;
  const { supabase, t, locale } = await getStaffContext();
  const L = intlLocale(locale);
  const { data: h } = await supabase.from("homework")
    .select("id, due_at, assigned_at, note, group_id, groups(name), assignments(title, skill, level, library_item_id, content)").eq("id", id).maybeSingle();
  if (!h) notFound();
  const { data: subs } = await supabase.from("submissions")
    .select("id, status, score, submitted_at, students(full_name)").eq("homework_id", id);
  const rows = (subs ?? []).sort((a, b) => (a.students?.full_name ?? "").localeCompare(b.students?.full_name ?? ""));
  const done = rows.filter((r) => r.status === "submitted" || r.status === "reviewed").length;
  const scores = rows.map((r) => r.score).filter((s): s is number => s != null).map(Number);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const overdue = new Date(h.due_at).getTime() < Date.parse(new Date().toISOString());
  const fmt = (iso: string) => new Date(iso).toLocaleString(L, { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const nq = ((h.assignments?.content as { questions?: unknown[] } | null)?.questions ?? []).length;

  return (
    <div className="space-y-5">
      <Link href="/homework" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Homework")}</Link>
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.03em]">{h.assignments?.title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {[h.groups?.name, h.assignments?.level, t("{n} questions", { n: nq }), t("due {date}", { date: fmt(h.due_at) })].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">{t("Students")}</h2>
            <span className="text-[12.5px] text-muted-foreground">{t("{a}/{b} submitted", { a: done, b: rows.length })}</span>
          </div>
          {rows.length === 0 ? <p className="p-6 text-[13px] text-muted-foreground">{t("Nobody was in this group when the work was set.")}</p> : (
            <ul className="divide-y divide-border/50">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={r.students?.full_name ?? "?"} size="sm" />
                  <span className="flex-1 text-[13.5px] font-medium">{r.students?.full_name}</span>
                  {r.submitted_at && <span className="hidden text-[11.5px] text-muted-foreground sm:block">{fmt(r.submitted_at)}</span>}
                  {r.score != null && <span className="w-12 text-right text-[13px] font-semibold tabular-nums">{Math.round(Number(r.score))}%</span>}
                  <Badge tone={r.status === "not_started" && overdue ? "red" : TONE[r.status]}>{t(r.status === "not_started" && overdue ? "Missed" : LABEL[r.status])}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <dl className="divide-y divide-border/60 text-[13px]">
              {[[t("Set"), fmt(h.assigned_at)], [t("Due"), fmt(h.due_at)], [t("Submitted"), `${done}/${rows.length}`], [t("Average score"), avg != null ? `${avg}%` : "—"]].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>
              ))}
            </dl>
            {h.assignments?.library_item_id && (
              <Link href={`/homework/library/${h.assignments.library_item_id}`} className="mt-3 block text-[12.5px] font-medium text-[#12392B] underline">{t("Open the material")}</Link>
            )}
          </Card>
          {h.note && (
            <Card className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{t("Note for students")}</p>
              <p className="mt-2 whitespace-pre-line text-[13px]">{h.note}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
