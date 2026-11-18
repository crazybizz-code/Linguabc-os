import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isLocale, translator, type Locale } from "@/i18n";
import { getWorkspaces, homePath, type Role, type Workspace } from "./workspace";

export const STAFF_ROLES: Role[] = ["owner", "admin", "academic_manager", "mentor"];

/**
 * Interface language. Owners choose (uz / ru / en, default uz) and the
 * choice is stored on their profile; admins, mentors and students use
 * English; parents default to Uzbek.
 */
export function localeFor(role: Role, saved: string | null | undefined): Locale {
  if (role === "owner") return isLocale(saved) ? saved : "uz";
  if (role === "parent") return isLocale(saved) ? saved : "uz";
  return "en";
}

/**
 * The signed-in staff member's workspace, resolved once per request.
 * Redirects anyone who is not staff to their own home.
 */
export const getStaffContext = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const [workspaces, profile] = await Promise.all([
    getWorkspaces(supabase, userId),
    supabase.from("profiles").select("locale").eq("id", userId).maybeSingle(),
  ]);
  const workspace = workspaces.find((w) => STAFF_ROLES.includes(w.role));
  if (!workspace) redirect(workspaces[0] ? homePath(workspaces[0].role) : "/");

  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const isStaff = isAdmin || workspace.role === "academic_manager";
  const locale = localeFor(workspace.role, profile.data?.locale);
  return { supabase, userId, workspace: workspace as Workspace, isAdmin, isStaff, locale, t: translator(locale) };
});

export type StaffContext = Awaited<ReturnType<typeof getStaffContext>>;
