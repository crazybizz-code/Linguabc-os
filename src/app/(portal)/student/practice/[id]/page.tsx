import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getPortalContext } from "@/lib/portal/context";
import { PortalCard } from "@/components/portal/cards";
import { MaterialView } from "@/components/library/material";
import { questionsOf } from "@/lib/questions";
import { PracticeQuiz } from "./practice-quiz";

export const metadata = { title: "Practice" };

export default async function PracticeItemPage({ params }: PageProps<"/student/practice/[id]">) {
  const { id } = await params;
  const { supabase, t } = await getPortalContext("student");
  const [{ data: item }, { data: blocked }] = await Promise.all([
    supabase.from("library_items").select("id, kind, title, body_html, body_format, audio_url, transcript, author, source_name, licence, source_url, questions, level_min, level_max").eq("id", id).eq("status", "published").maybeSingle(),
    supabase.rpc("my_practice_blocked"),
  ]);
  if (!item) notFound();
  const off = ((blocked ?? []) as string[]).includes(id);
  return (
    <>
      <Link href="/student/practice" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground"><ChevronLeft className="h-4 w-4" /> {t("Practice")}</Link>
      <PortalCard title={item.title}><MaterialView item={item} t={t} /></PortalCard>
      {off ? <PortalCard><p className="text-[13px] text-muted-foreground">{t("Your centre set this as homework, so it is not open for practice.")}</p></PortalCard>
        : <PracticeQuiz itemId={item.id} questions={questionsOf(item.questions)} />}
    </>
  );
}
