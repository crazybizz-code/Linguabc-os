import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { Card } from "@/components/ui/primitives";
import { AttendanceSheet } from "./sheet";

export const metadata = { title: "Mark attendance" };
const TZ = "Asia/Tashkent";

export default async function LessonAttendancePage({ params }: PageProps<"/attendance/[lessonId]">) {
  const { lessonId } = await params;
  const { supabase } = await getStaffContext();
  const { data: lesson } = await supabase.from("lessons").select("id, group_id, starts_at, ends_at, groups(name)").eq("id", lessonId).maybeSingle();
  if (!lesson) notFound();

  const lessonDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(lesson.starts_at));
  const [enrollments, records] = await Promise.all([
    supabase.from("enrollments").select("student_id, start_date, students(full_name)").eq("group_id", lesson.group_id).eq("status", "active").lte("start_date", lessonDay),
    supabase.from("attendance_records").select("student_id, status").eq("lesson_id", lessonId),
  ]);
  const students = (enrollments.data ?? [])
    .map((e) => ({ id: e.student_id, name: e.students?.full_name ?? "—" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const initial = Object.fromEntries((records.data ?? []).map((r) => [r.student_id, r.status]));
  const when = new Date(lesson.starts_at).toLocaleString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/attendance" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-[#17211D]"><ChevronLeft className="h-4 w-4" /> Attendance</Link>
      <div>
        <h1 className="text-[24px] font-semibold tracking-[-0.03em]">{lesson.groups?.name}</h1>
        <p className="text-[13px] text-muted-foreground">{when}</p>
      </div>
      <Card className="overflow-hidden">
        <AttendanceSheet lessonId={lessonId} students={students} initial={initial} />
      </Card>
    </div>
  );
}
