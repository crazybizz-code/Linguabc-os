import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getPlatformContext } from "@/lib/auth/platform";
import { voiceOptions } from "@/lib/ai/voice";
import { studioEngines } from "@/lib/ai/engines";
import { toDraftQuestion } from "@/lib/ai/draft-store";
import { transcriptToScript, type VocabWord } from "@/lib/ai/podcast";
import type { Level } from "@/lib/ai/draft";
import type { AnswerKey, Question } from "@/lib/questions";
import { PodcastEditor } from "../podcast-editor";
import type { PodcastSave } from "../actions";

export const metadata = { title: "LinguABC podcast" };
// Drafting an episode and recording it can take a minute or two.
export const maxDuration = 300;

const EMPTY: PodcastSave = { title: "", description: "", topics: [], script: "", questions: [], vocabulary: [], levelMin: "A1", levelMax: "A1" };

export default async function LibraryPodcastPage({ params }: PageProps<"/admin/podcasts/[id]">) {
  const { id } = await params;
  const { supabase, t } = await getPlatformContext();
  const voices = await voiceOptions();
  // Engine choice is for LinguABC admins only: this page is platform-only (getPlatformContext).
  const engines = await studioEngines();
  const back = <Link href="/admin/podcasts" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("LinguABC podcasts")}</Link>;

  if (id === "new") {
    return <div className="space-y-5">{back}<PodcastEditor id={null} status="draft" initial={EMPTY} voices={voices} engines={engines} /></div>;
  }

  const [{ data: item }, { data: key }] = await Promise.all([
    supabase.from("library_items").select("id, kind, title, description, level_min, level_max, topics, status, transcript, questions, vocabulary, audio_path, audio_url, duration_seconds").eq("id", id).maybeSingle(),
    supabase.from("library_answer_keys").select("answers").eq("item_id", id).maybeSingle(),
  ]);
  if (!item || item.kind !== "podcast") notFound();
  const answers = (key?.answers ?? {}) as AnswerKey;
  const vocab = (Array.isArray(item.vocabulary) ? item.vocabulary : []) as Partial<VocabWord>[];
  const initial: PodcastSave = {
    title: item.title,
    description: item.description ?? "",
    topics: item.topics ?? [],
    script: transcriptToScript((Array.isArray(item.transcript) ? item.transcript : []) as { speaker?: string; text?: string }[]),
    questions: ((Array.isArray(item.questions) ? item.questions : []) as Question[]).map((q) => toDraftQuestion(q, answers[q.id])),
    vocabulary: vocab.map((v) => ({ word: v.word ?? "", pos: v.pos ?? "", definition: v.definition ?? "", example: v.example ?? "" })),
    levelMin: (item.level_min ?? "A1") as Level,
    levelMax: (item.level_max ?? item.level_min ?? "A1") as Level,
    audioPath: item.audio_path ?? undefined,
    seconds: item.duration_seconds ?? undefined,
  };

  return (
    <div className="space-y-5">
      {back}
      <PodcastEditor id={item.id} status={item.status} initial={initial} voices={voices} audioUrl={item.audio_url ?? undefined} engines={engines} />
    </div>
  );
}
