"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getStaffContext } from "@/lib/auth/current";
import { siteUrl } from "@/lib/supabase/config";

export type ActionState = { error?: string; ok?: boolean; link?: string; id?: string } | undefined;

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const optional = (v: FormDataEntryValue | null) => str(v) || null;
const money = (v: FormDataEntryValue | null) => {
  const digits = str(v).replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
};

/** Turn database errors into something a centre admin can act on. */
function friendly(message: string): string {
  if (/forbidden|row-level security|permission/i.test(message)) return "You don't have permission to do that.";
  if (/schedule conflict/i.test(message)) return message.replace(/^.*schedule conflict/i, "Schedule conflict");
  if (/duplicate key.*(name|code)/i.test(message)) return "That name is already used in this centre.";
  if (/group is full/i.test(message)) return message.replace(/^.*group is full/i, "This group is full");
  return message;
}

// ------------------------------------------------------------------ branches
export async function addBranch(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await getStaffContext();
  const name = str(form.get("name"));
  if (name.length < 2) return { error: "Enter a branch name." };
  const { error } = await supabase.from("branches").insert({
    center_id: workspace.centerId,
    name,
    address: optional(form.get("address")),
    phone: optional(form.get("phone")),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true };
}

// ------------------------------------------------------------------- courses
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export async function addCourse(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await getStaffContext();
  const name = str(form.get("name"));
  if (name.length < 2) return { error: "Enter a course name." };
  const level = str(form.get("level"));
  const weeks = Number(str(form.get("duration_weeks"))) || null;
  const code = (str(form.get("code")) || name).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  const { error } = await supabase.from("courses").insert({
    center_id: workspace.centerId,
    name,
    code,
    level: (CEFR as readonly string[]).includes(level) ? (level as (typeof CEFR)[number]) : null,
    duration_weeks: weeks,
    default_monthly_fee: money(form.get("default_monthly_fee")) ?? 0,
    description: optional(form.get("description")),
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true };
}

// -------------------------------------------------------------------- groups
export async function createGroup(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await getStaffContext();
  const weekdays = form.getAll("weekday").map((d) => Number(d)).filter((d) => d >= 1 && d <= 7);
  const { data, error } = await supabase.rpc("create_group", {
    p_center: workspace.centerId,
    p_name: str(form.get("name")),
    p_course: str(form.get("course_id")),
    p_branch: str(form.get("branch_id")),
    p_mentor: optional(form.get("mentor_id")) ?? undefined,
    p_room_name: optional(form.get("room")) ?? undefined,
    p_capacity: Number(str(form.get("capacity"))) || undefined,
    p_start_date: optional(form.get("start_date")) ?? undefined,
    p_weekdays: weekdays,
    p_start_time: optional(form.get("start_time")) ?? undefined,
    p_end_time: optional(form.get("end_time")) ?? undefined,
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, id: data ?? undefined };
}

// ------------------------------------------------------------------ students
const StudentSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the student's full name."),
  phone: z.string().trim().optional(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email or leave it empty.")]).optional(),
});

export async function addStudent(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await getStaffContext();
  const parsed = StudentSchema.safeParse({
    full_name: str(form.get("full_name")),
    phone: str(form.get("phone")),
    email: str(form.get("email")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const due = Number(str(form.get("due_day")));
  const { data, error } = await supabase.rpc("create_student", {
    p_center: workspace.centerId,
    p_full_name: parsed.data.full_name,
    p_phone: parsed.data.phone || undefined,
    p_email: parsed.data.email || undefined,
    p_date_of_birth: optional(form.get("date_of_birth")) ?? undefined,
    p_branch: optional(form.get("branch_id")) ?? undefined,
    p_group: optional(form.get("group_id")) ?? undefined,
    p_monthly_fee: money(form.get("monthly_fee")) ?? undefined,
    p_discount_percent: Number(str(form.get("discount_percent"))) || 0,
    p_due_day: due >= 1 && due <= 28 ? due : 5,
    p_parent_name: optional(form.get("parent_name")) ?? undefined,
    p_parent_phone: optional(form.get("parent_phone")) ?? undefined,
    p_parent_relationship: optional(form.get("parent_relationship")) ?? undefined,
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, id: data ?? undefined };
}

// --------------------------------------------------------------------- staff
const STAFF_INVITE_ROLES = ["admin", "academic_manager", "mentor"] as const;

export async function inviteStaff(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await getStaffContext();
  const fullName = str(form.get("full_name"));
  const role = str(form.get("role"));
  if (fullName.length < 2) return { error: "Enter the person's full name." };
  if (!(STAFF_INVITE_ROLES as readonly string[]).includes(role)) return { error: "Choose a role." };
  const email = str(form.get("email"));
  if (email && !z.string().email().safeParse(email).success) return { error: "Enter a valid email or leave it empty." };

  const { data, error } = await supabase.rpc("invite_member", {
    p_center: workspace.centerId,
    p_role: role as (typeof STAFF_INVITE_ROLES)[number],
    p_full_name: fullName,
    p_email: email || undefined,
    p_phone: optional(form.get("phone")) ?? undefined,
    p_branch: optional(form.get("branch_id")) ?? undefined,
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/staff");
  return { ok: true, link: `${siteUrl()}/join?code=${data?.[0]?.invite_code}` };
}

// ---------------------------------------------------------- student logins
export async function inviteStudentLogin(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await getStaffContext();
  const studentId = str(form.get("student_id"));
  const { data: s } = await supabase.from("students").select("full_name, email, phone").eq("id", studentId).single();
  if (!s) return { error: "Student not found." };
  const { data, error } = await supabase.rpc("invite_member", {
    p_center: workspace.centerId, p_role: "student", p_full_name: s.full_name,
    p_email: s.email ?? undefined, p_phone: s.phone ?? undefined, p_student: studentId,
  });
  if (error) return { error: friendly(error.message) };
  // No revalidate here: the page refreshes when the link dialog is closed.
  return { ok: true, link: `${siteUrl()}/join?code=${data?.[0]?.invite_code}` };
}

export async function inviteParentLogin(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await getStaffContext();
  const guardianId = str(form.get("guardian_id"));
  const { data: g } = await supabase.from("guardians").select("full_name, phone, student_id").eq("id", guardianId).single();
  if (!g) return { error: "Parent not found." };
  const { data, error } = await supabase.rpc("invite_member", {
    p_center: workspace.centerId, p_role: "parent", p_full_name: g.full_name,
    p_phone: g.phone ?? undefined, p_guardian: guardianId,
  });
  if (error) return { error: friendly(error.message) };
  return { ok: true, link: `${siteUrl()}/join?code=${data?.[0]?.invite_code}` };
}

// -------------------------------------------------------------- attendance
const ATT = ["present", "late", "absent", "excused"] as const;

export async function saveAttendance(lessonId: string, marks: Record<string, string>): Promise<ActionState> {
  const { supabase } = await getStaffContext();
  const records = Object.entries(marks)
    .filter(([, status]) => (ATT as readonly string[]).includes(status))
    .map(([student_id, status]) => ({ student_id, status }));
  if (!records.length) return { error: "Mark at least one student." };
  const { error } = await supabase.rpc("mark_attendance", { p_lesson: lessonId, p_records: records });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/attendance");
  revalidatePath("/students", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------- payments
// Click and Payme are V2 (online payments); they cannot be recorded yet.
const METHODS = ["cash", "card", "bank_transfer", "uzum"] as const;

export async function recordPayment(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await getStaffContext();
  const amount = money(form.get("amount"));
  const method = str(form.get("method"));
  if (!amount || amount <= 0) return { error: "Enter the amount received." };
  if (!(METHODS as readonly string[]).includes(method)) return { error: "Choose how it was paid." };
  const { data, error } = await supabase.rpc("record_payment", {
    p_invoice: str(form.get("invoice_id")),
    p_amount: amount,
    p_method: method as (typeof METHODS)[number],
    p_note: optional(form.get("note")) ?? undefined,
  });
  if (error) {
    if (/exceeds the remaining balance/i.test(error.message)) {
      const rest = error.message.match(/balance (\d+)/)?.[1];
      return { error: `That's more than what is owed${rest ? ` (${Number(rest).toLocaleString("en-US")} UZS)` : ""}.` };
    }
    return { error: friendly(error.message) };
  }
  revalidatePath("/payments");
  revalidatePath("/students", "layout");
  revalidatePath("/dashboard");
  return { ok: true, id: data?.[0]?.payment_id, link: data?.[0]?.receipt_no };
}

export async function runMonthlyInvoices(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase, workspace } = await getStaffContext();
  const period = str(form.get("period"));
  const { data, error } = await supabase.rpc("generate_invoices", { p_center: workspace.centerId, p_period: period });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/payments");
  return { ok: true, link: String(data ?? 0) };
}

// ---------------------------------------------------------------- language
export async function setLocale(locale: string) {
  const { supabase, userId, workspace } = await getStaffContext();
  if (workspace.role !== "owner" || !["en", "uz", "ru"].includes(locale)) return;
  await supabase.from("profiles").update({ locale }).eq("id", userId);
  revalidatePath("/", "layout");
}
