import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getPlatformContext } from "@/lib/auth/platform";
import { voiceOptions } from "@/lib/ai/fish";
import { SPECS, type SectionDraft, type TestSkill } from "@/lib/ai/test-draft";
import { toDraftQuestion } from "@/lib/ai/draft-store";
import { audioUrl, LIBRARY_AUDIO } from "@/lib/audio";
import type { Level } from "@/lib/ai/draft";
import type { AnswerKey, QuestionGroup, Question } from "@/lib/questions";
import { TestEditor } from "./test-editor";

export const metadata = { title: "LinguABC test" };
// Drafting a section and recording it can take a minute or two.
export const maxDuration = 300;

type StoredSection = { id: string; title?: string; passage?: string; audio_path?: string; groups?: QuestionGroup[]; questions?: Question[] };

export default async function LibraryTestPage({ params }: PageProps<"/admin/tests/[id]">) {
  const { id } = await params;
  const { supabase, t } = await getPlatformContext();
  const [{ data: test }, { data: key }] = await Promise.all([
    supabase.from("library_tests").select("id, title, skill, level, status, sections").eq("id", id).maybeSingle(),
    supabase.from("library_test_keys").select("answers, transcripts").eq("test_id", id).maybeSingle(),
  ]);
  if (!test) notFound();
  const skill = test.skill as TestSkill;
  const answers = (key?.answers ?? {}) as AnswerKey;
  const transcripts = (key?.transcripts ?? {}) as Record<string, string>;
  const stored = (Array.isArray(test.sections) ? test.sections : []) as StoredSection[];

  // Always show the full IELTS shape: 4 listening parts or 3 reading passages.
  const sections: SectionDraft[] = SPECS[skill].map((spec, i) => {
    const s = stored[i];
    return {
      title: s?.title ?? spec.title,
      passage: (skill === "listening" ? transcripts[s?.id ?? ""] : s?.passage) ?? "",
      audio_path: s?.audio_path,
      groups: (s?.groups ?? []).map((g) => ({ id: g.id, instructions: g.instructions ?? "", options: g.options ?? [] })),
      questions: (s?.questions ?? []).map((q) => toDraftQuestion(q, answers[q.id])),
    };
  });
  const urls = await Promise.all(sections.map((s) => audioUrl(supabase, s.audio_path, LIBRARY_AUDIO)));

  return (
    <div className="space-y-5">
      <Link href="/admin/tests" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("LinguABC tests")}</Link>
      <TestEditor id={test.id} status={test.status} voices={skill === "listening" ? await voiceOptions() : []}
        initial={{ title: test.title, skill, level: (test.level ?? "B2") as Level, sections }} audioUrls={urls.map((u) => u ?? undefined)} />
    </div>
  );
}
