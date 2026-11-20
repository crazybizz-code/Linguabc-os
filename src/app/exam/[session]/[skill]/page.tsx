import { notFound } from "next/navigation";
import { getPortalContext } from "@/lib/portal/context";
import { ExamApp } from "./exam-app";

export const metadata = { title: "IELTS mock" };

/** The exam screen: full screen, outside the portal's navigation. */
export default async function ExamPage({ params }: PageProps<"/exam/[session]/[skill]">) {
  const { session, skill } = await params;
  if (skill !== "reading" && skill !== "listening") notFound();
  const ctx = await getPortalContext("student");
  const { data: s } = await ctx.supabase.from("mock_sessions").select("id, name").eq("id", session).maybeSingle();
  if (!s) notFound();
  return <ExamApp sessionId={s.id} sessionName={s.name} skill={skill} candidate={ctx.profile?.full_name ?? ctx.children[0]?.full_name ?? ""} />;
}
