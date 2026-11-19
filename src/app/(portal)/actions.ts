"use server";

import { revalidatePath } from "next/cache";
import { getPortalContext } from "@/lib/portal/context";
import type { Answers } from "@/lib/questions";

/** Parents choose their interface language (default Uzbek). */
export async function setParentLocale(locale: string) {
  if (!["uz", "ru", "en"].includes(locale)) return;
  const { supabase, userId } = await getPortalContext("parent");
  await supabase.from("profiles").update({ locale }).eq("id", userId);
  revalidatePath("/parent", "layout");
}

/** Students save progress or submit their homework answers ({question id: option index}). */
export async function saveHomework(homeworkId: string, answers: Answers, submit: boolean) {
  const index = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 20;
  const clean = Object.fromEntries(
    Object.entries(answers).filter(([k, v]) => /^[\w-]{1,40}$/.test(k)
      && (index(v) || (typeof v === "string" && v.length <= 20000) || (Array.isArray(v) && v.length <= 10 && v.every(index)))),
  );
  const { supabase } = await getPortalContext("student");
  const { error } = await supabase.rpc("save_submission", { p_homework: homeworkId, p_answers: clean, p_submit: submit });
  if (error) return { error: /already submitted/i.test(error.message) ? "This homework was already submitted." : /too long/i.test(error.message) ? "Your answers are too long." : "Could not save. Please try again." };
  revalidatePath("/student", "layout");
  return { ok: true };
}
