import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";
import { MOCK_LABEL, MOCK_TONE } from "../labels";
import { ResultsSheet } from "./results-sheet";

export const metadata = { title: "Mock session" };
const TZ = "Asia/Tashkent";
const ORDER = ["reading", "listening", "writing", "speaking"] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default async function MockSessionPage({ params }: PageProps<"/mocks/[id]">) {
  const { id } = await params;
  const { supabase, workspace, isStaff, t, locale } = await getStaffContext();
  const { data: s } = await supabase.from("mock_sessions")
    .select("id, name, version, status, scheduled_at, modules, examiner_id, group_id, groups(name), rooms(name)").eq("id", id).maybeSingle();
  if (!s) notFound();

  const [results, examiner] = await Promise.all([
    supabase.from("mock_result_scores").select("student_id, status, reading_band, listening_band, writing_band, speaking_band, overall_band, students(full_name)").eq("mock_session_id", id),
    s.examiner_id ? supabase.from("memberships").select("full_name").eq("id", s.examiner_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const modules = ORDER.filter((m) => s.modules.includes(m));
  const num = (v: unknown) => (v == null ? null : Number(v));
  const rows = (results.data ?? [])
    .map((r) => ({
      student_id: r.student_id!, name: r.students?.full_name ?? "—", absent: r.status === "absent",
      reading: num(r.reading_band), listening: num(r.listening_band), writing: num(r.writing_band), speaking: num(r.speaking_band),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const overalls = (results.data ?? []).map((r) => num(r.overall_band)).filter((v): v is number => v != null);
  const avg = overalls.length ? (overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(1) : null;
  const canEdit = s.status !== "cancelled" && (isStaff || s.examiner_id === workspace.membershipId);

  const L = intlLocale(locale);
  const when = new Date(s.scheduled_at);
  const detail: [string, string][] = [
    [t("Date"), when.toLocaleDateString(L, { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" })],
    [t("Time"), when.toLocaleTimeString(L, { timeZone: TZ, hour: "2-digit", minute: "2-digit" })],
    [t("Group"), s.groups?.name ?? "—"],
    [t("Version"), s.version ?? "—"],
    [t("Examiner"), examiner.data?.full_name ?? t("Not assigned")],
    [t("Room"), s.rooms?.name ?? "—"],
    [t("Modules"), modules.map((m) => t(cap(m))).join(", ")],
  ];

  return (
    <div className="space-y-5">
      <Link href="/mocks" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Mocks")}</Link>
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[26px] font-semibold tracking-[-0.03em]">{s.name}</h1>
          <Badge tone={MOCK_TONE[s.status]}>{t(MOCK_LABEL[s.status])}</Badge>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {[s.groups?.name, when.toLocaleDateString(L, { timeZone: TZ, day: "numeric", month: "short" }), s.version, t("{n} participants", { n: rows.length })].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="px-5 pb-1 pt-4">
            <h2 className="text-[15px] font-semibold">{t("Results")}</h2>
            <p className="text-[12px] text-muted-foreground">{canEdit ? t("Enter each band as it is marked. Save as often as you like — families see a result once every module is in.") : t("Only managers and the session's examiner can enter results.")}</p>
          </div>
          <ResultsSheet sessionId={s.id} modules={[...modules]} initial={rows} canEdit={canEdit} />
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-2 text-[15px] font-semibold">{t("Session detail")}</h2>
            <dl className="divide-y divide-border/60 text-[13px]">
              {detail.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
          </Card>
          {avg && (
            <Card className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{t("Group average")}</p>
              <p className="mt-1 text-[28px] font-semibold tracking-[-0.03em]">{avg}</p>
              <p className="text-[12px] text-muted-foreground">{t("Overall band across {n} completed results", { n: overalls.length })}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
