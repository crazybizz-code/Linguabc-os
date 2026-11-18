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
