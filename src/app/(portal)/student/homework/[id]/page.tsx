import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Layers } from "lucide-react";
import { getPortalContext } from "@/lib/portal/context";
import { PortalCard } from "@/components/portal/cards";
import { Badge } from "@/components/ui/primitives";
import { MaterialView } from "@/components/library/material";
import { CueCards, type VocabWord } from "@/components/library/cue-cards";
import { QuestionList } from "@/components/questions/question-list";
import { content, type AnswerKey, type Answers, type Marks } from "@/lib/questions";
import { intlLocale } from "@/i18n";
import { audioUrl } from "@/lib/audio";
import { Quiz } from "./quiz";

export const metadata = { title: "Homework" };

export default async function StudentHomeworkPage({ params }: PageProps<"/student/homework/[id]">) {
  const { id } = await params;
  const ctx = await getPortalContext("student");
  const { supabase, t } = ctx;
  const { data: h } = await supabase.from("homework").select("id, due_at, note, assignments(title, content, library_item_id)").eq("id", id).maybeSingle();
  if (!h) notFound();
  const me = ctx.children[0];
  const [{ data: item }, { data: sub }, { data: result }] = await Promise.all([
    h.assignments?.library_item_id
      ? supabase.from("library_items").select("kind, title, body_html, body_format, audio_url, transcript, author, source_name, licence, source_url, vocabulary").eq("id", h.assignments.library_item_id).maybeSingle()
      : Promise.resolve({ data: null }),
    me ? supabase.from("submissions").select("status, answers").eq("homework_id", id).eq("student_id", me.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("my_homework_result", { p_homework: id }),
  ]);
  const body = content(h.assignments?.content);
  const questions = body.questions ?? [];
  const res = result as { status: string; score: number | null; feedback: string | null; answers: Answers; key: AnswerKey | null; marks: Marks; transcript?: string } | null;
  const audio = body.audio_url ?? (await audioUrl(supabase, body.audio_path));
  const vocab = (Array.isArray(item?.vocabulary) ? item.vocabulary : []) as VocabWord[];
  const due = new Date(h.due_at);
  const late = due.getTime() < Date.parse(new Date().toISOString());

  return (
    <>
      <Link href="/student/homework" className="inline-flex items-center gap-1 px-1 text-[12.5px] text-muted-foreground"><ChevronLeft className="h-4 w-4" /> {t("Homework")}</Link>
      <PortalCard>
        <h1 className="text-[19px] font-semibold leading-snug tracking-[-0.02em]">{h.assignments?.title}</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {t("Due {date}", { date: due.toLocaleString(intlLocale(ctx.locale), { timeZone: "Asia/Tashkent", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
          {late && !res && <span className="ml-1.5 text-[#B4483D]">· {t("past due")}</span>}
        </p>
        {h.note && <p className="mt-3 rounded-[11px] bg-[#F5ECE8]/80 px-3 py-2.5 text-[13px]"><span className="font-medium">{t("From your mentor:")}</span> {h.note}</p>}
      </PortalCard>

      {res && (
        <PortalCard title={t("Your result")} action={res.status === "reviewed" ? <Badge tone="green">{t("Reviewed")}</Badge> : <Badge tone="blue">{t("Submitted")}</Badge>}>
          <p className="text-[30px] font-semibold tracking-[-0.03em]">{res.score != null ? `${Math.round(Number(res.score))}%` : "—"}</p>
          {res.feedback && <p className="mt-2 rounded-[11px] bg-[#F5ECE8]/80 px-3 py-2.5 text-[13px]"><span className="font-medium">{t("Mentor feedback:")}</span> {res.feedback}</p>}
        </PortalCard>
      )}

      {item && <PortalCard><MaterialView item={item} t={t} /></PortalCard>}
      {!item && audio && <PortalCard><audio controls preload="none" src={audio} className="w-full" /></PortalCard>}
      {!item && body.audio_path && !audio && <PortalCard><p className="text-[13px] text-[#B4483D]">{t("The recording could not be loaded. Refresh the page or tell your mentor.")}</p></PortalCard>}
      {!item && body.passage && <PortalCard><div className="library-prose whitespace-pre-line">{body.passage}</div></PortalCard>}
      {!item && res?.transcript && <PortalCard title={t("Script")}><div className="library-prose whitespace-pre-line">{res.transcript}</div></PortalCard>}

      {res ? (
        <>
          {vocab.length > 0 && (
            <PortalCard icon={Layers} title={t("Words from this text")}>
              <CueCards deckId={String(h.assignments?.library_item_id)} words={vocab} />
            </PortalCard>
          )}
          <PortalCard title={t("Answers")}>
            <QuestionList questions={questions} groups={body.groups} answers={res.answers}
              answerKey={res.key ?? {}} marks={res.marks} t={t} showMine />
          </PortalCard>
        </>
      ) : (
        <Quiz homeworkId={h.id} questions={questions} groups={body.groups} initial={(sub?.answers ?? {}) as Answers} />
      )}
    </>
  );
}
