import { notFound } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current";
import { Card } from "@/components/ui/primitives";
import { QuestionList } from "@/components/questions/question-list";
import { audioUrl, LIBRARY_AUDIO } from "@/lib/audio";
import type { Question, QuestionGroup } from "@/lib/questions";

export const metadata = { title: "Test preview" };
type Section = { id: string; title?: string; passage?: string; audio_path?: string; groups?: QuestionGroup[]; questions?: Question[] };

/** A published LinguABC test as staff choose it for a mock: content only, never the key. */
export default async function TestPreviewPage({ params }: PageProps<"/mocks/tests/[id]">) {
  const { id } = await params;
  const { supabase, t } = await getStaffContext();
  const { data: test } = await supabase.from("library_tests").select("title, skill, level, sections").eq("id", id).maybeSingle();
  if (!test) notFound();
  const sections = (Array.isArray(test.sections) ? test.sections : []) as Section[];
  const urls = await Promise.all(sections.map((s) => audioUrl(supabase, s.audio_path, LIBRARY_AUDIO)));
  const starts = sections.map((_, i) => 1 + sections.slice(0, i).reduce((a, x) => a + (x.questions?.length ?? 0), 0));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[12px] text-muted-foreground">{t(test.skill === "listening" ? "Listening" : "Reading")}{test.level ? ` · ${test.level}` : ""} · {t("Answers are hidden: marking happens on the server.")}</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.03em]">{test.title}</h1>
      </div>
      {sections.map((s, i) => {
        const qs = s.questions ?? [];
        const from = starts[i];
        return (
          <Card key={s.id} className="space-y-4 p-6">
            <h2 className="text-[16px] font-semibold">
              {s.title} <span className="ml-1 text-[12.5px] font-normal text-muted-foreground">{t("Questions {a}–{b}", { a: String(from), b: String(from + qs.length - 1) })}</span>
            </h2>
            {urls[i] && <audio controls preload="none" src={urls[i]!} className="w-full" />}
            {s.passage && <div className="library-prose max-h-[480px] overflow-y-auto whitespace-pre-line rounded-[12px] bg-white/60 p-4">{s.passage}</div>}
            <QuestionList questions={qs} groups={s.groups} answerKey={{}} t={t} start={from} />
          </Card>
        );
      })}
    </div>
  );
}
