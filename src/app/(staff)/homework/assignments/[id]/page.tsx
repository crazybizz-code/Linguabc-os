import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Badge, Card, type Tone } from "@/components/ui/primitives";
import { QuestionList } from "@/components/questions/question-list";
import { content as parseContent, type AnswerKey } from "@/lib/questions";
import { todayISO } from "@/lib/dates";
import { audioUrl } from "@/lib/audio";
import { AssignDialog } from "../../library/[id]/assign";
import { assignAssignment } from "../../../actions";
import { ApproveButton } from "./approve";

export const metadata = { title: "Assignment" };
const TONE: Record<string, Tone> = { draft: "neutral", pending_approval: "amber", approved: "green", archived: "neutral" };
const LABEL: Record<string, string> = { draft: "Draft", pending_approval: "Waiting for approval", approved: "Approved", archived: "Archived" };
const SOURCE: Record<string, string> = { upload: "Uploaded worksheet", ai: "Created with AI", library: "LinguABC library" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default async function AssignmentPage({ params }: PageProps<"/homework/assignments/[id]">) {
  const { id } = await params;
  const { supabase, workspace, isStaff, t } = await getStaffContext();
  const [{ data: a }, { data: key }, { data: groups }] = await Promise.all([
    supabase.from("assignments").select("id, title, skill, level, source, status, content, library_item_id").eq("id", id).eq("center_id", workspace.centerId).maybeSingle(),
    supabase.from("assignment_keys").select("answers, transcript").eq("assignment_id", id).maybeSingle(),
    supabase.from("groups").select("id, name").eq("center_id", workspace.centerId).eq("status", "active").order("name"),
  ]);
  if (!a) notFound();
  const body = parseContent(a.content);
  const answers = (key?.answers ?? {}) as AnswerKey;
  const audio = body.audio_url ?? (await audioUrl(supabase, body.audio_path));
  const text = body.passage ?? key?.transcript;
  const due = new Date(`${todayISO()}T12:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 3);

  return (
    <div className="space-y-5">
      <Link href="/homework?tab=assignments" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> {t("Assignments")}</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <Badge tone={TONE[a.status]}>{t(LABEL[a.status])}</Badge>
            {[t(SOURCE[a.source]), t(cap(a.skill)), a.level].filter(Boolean).join(" · ")}
          </div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.03em]">{a.title}</h1>
        </div>
        {a.status === "approved" && <AssignDialog itemId={a.id} field="assignment_id" action={assignAssignment} groups={groups ?? []} defaultDue={due.toISOString().slice(0, 10)} />}
        {a.status === "pending_approval" && isStaff && <ApproveButton id={a.id} />}
      </div>
      {a.status === "pending_approval" && !isStaff && (
        <p className="rounded-[12px] bg-[#FBEEDC] px-4 py-3 text-[13px] text-[#9A5B1E]">{t("A manager will review this assignment. Once approved you can set it for your groups.")}</p>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card className="p-6">
          {audio && <audio controls preload="none" src={audio} className="mb-4 w-full" />}
          {body.audio_path && !audio && <p className="mb-4 text-[13px] text-[#B4483D]">{t("The recording could not be loaded.")}</p>}
          {key?.transcript && <p className="mb-2 text-[12px] text-muted-foreground">{t("Script — students see it only after they submit.")}</p>}
          {text ? <div className="library-prose whitespace-pre-line">{text}</div>
            : !audio && <p className="text-[13px] text-muted-foreground">{t("No text — questions only.")}</p>}
        </Card>
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">{t("Questions")}</h2>
          <p className="mb-3 text-[12px] text-muted-foreground">{t("Correct answers are shown to staff only.")}</p>
          <QuestionList questions={body.questions ?? []} groups={body.groups} answerKey={answers} t={t} />
        </Card>
      </div>
    </div>
  );
}
