import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translator } from "@/i18n";
import { localeFor } from "@/lib/auth/current";
import { getWorkspaces, homePath, type Role } from "@/lib/auth/workspace";

export type PortalKind = "parent" | "student";

/**
 * The signed-in parent's or student's portal: their membership, the
 * children (or self) they may see — Row Level Security decides that —
 * and their language. Parents default to Uzbek, students use English.
 */
export const getPortalContext = cache(async (kind: PortalKind) => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const [workspaces, profile] = await Promise.all([
    getWorkspaces(supabase, userId),
    supabase.from("profiles").select("locale, full_name, phone").eq("id", userId).maybeSingle(),
  ]);
  const workspace = workspaces.find((w) => w.role === (kind as Role));
  if (!workspace) redirect(workspaces[0] ? homePath(workspaces[0].role) : "/");

  const { data: children } = await supabase
    .from("students")
    .select("id, full_name")
    .eq("center_id", workspace.centerId)
    .order("full_name");

  const locale = localeFor(workspace.role, profile.data?.locale);
  return {
    supabase,
    userId,
    workspace,
    children: children ?? [],
    locale,
    t: translator(locale),
    profile: profile.data,
  };
});

export type PortalContext = Awaited<ReturnType<typeof getPortalContext>>;

/** The child to show: ?child=… if it is one of theirs, else the first. */
export function pickChild(ctx: PortalContext, requested: unknown) {
  const id = typeof requested === "string" ? requested : "";
  return ctx.children.find((c) => c.id === id) ?? ctx.children[0] ?? null;
}
