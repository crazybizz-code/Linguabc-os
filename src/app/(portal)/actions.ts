"use server";

import { revalidatePath } from "next/cache";
import { getPortalContext } from "@/lib/portal/context";

/** Parents choose their interface language (default Uzbek). */
export async function setParentLocale(locale: string) {
  if (!["uz", "ru", "en"].includes(locale)) return;
  const { supabase, userId } = await getPortalContext("parent");
  await supabase.from("profiles").update({ locale }).eq("id", userId);
  revalidatePath("/parent", "layout");
}
