import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaces, homePath, type Role, type Workspace } from "./workspace";

export const STAFF_ROLES: Role[] = ["owner", "admin", "academic_manager", "mentor"];

/**
 * The signed-in staff member's workspace, resolved once per request.
 * Redirects anyone who is not staff to their own home.
 */
export const getStaffContext = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const workspaces = await getWorkspaces(supabase, userId);
  const workspace = workspaces.find((w) => STAFF_ROLES.includes(w.role));
  if (!workspace) redirect(workspaces[0] ? homePath(workspaces[0].role) : "/");

  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const isStaff = isAdmin || workspace.role === "academic_manager";
  return { supabase, userId, workspace: workspace as Workspace, isAdmin, isStaff };
});

export type StaffContext = Awaited<ReturnType<typeof getStaffContext>>;
