import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type DB = SupabaseClient<Database>;
export type Role = Database["public"]["Enums"]["member_role"];

export type Workspace = {
  membershipId: string;
  centerId: string;
  centerName: string;
  role: Role;
  fullName: string;
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Administrator",
  academic_manager: "Academic manager",
  mentor: "Mentor",
  student: "Student",
  parent: "Parent",
};

/** Where each role lands after signing in. */
export function homePath(role: Role): string {
  if (role === "student") return "/student";
  if (role === "parent") return "/parent";
  return "/dashboard";
}

const ROLE_ORDER: Role[] = ["owner", "admin", "academic_manager", "mentor", "student", "parent"];

/** Active memberships of the signed-in user, most privileged first. */
export async function getWorkspaces(supabase: DB, userId: string): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("id, role, full_name, center_id, centers(name)")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return (data ?? [])
    .map((m) => ({
      membershipId: m.id,
      centerId: m.center_id,
      centerName: m.centers?.name ?? "",
      role: m.role,
      fullName: m.full_name,
    }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base.length >= 2 ? base : "centre"}-${suffix}`;
}

/**
 * Completes whatever the person started before confirming their email:
 * a centre to create (owner sign-up) or an invitation to redeem (/join).
 * Safe to call on every sign-in — it does nothing once finished.
 * Returns an error message for the user, or null.
 */
export async function finishOnboarding(supabase: DB, user: User): Promise<string | null> {
  const meta = user.user_metadata ?? {};
  const pendingCenter: string | undefined = meta.pending_center;
  const inviteCode: string | undefined = meta.invite_code;
  if (!pendingCenter && !inviteCode) return null;

  let message: string | null = null;
  let centerDone = !pendingCenter;

  if (pendingCenter) {
    const existing = await getWorkspaces(supabase, user.id);
    if (!existing.some((w) => w.role === "owner")) {
      let lastError: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.rpc("create_center", {
          p_name: pendingCenter,
          p_slug: slugify(pendingCenter),
          p_owner_name: meta.full_name ?? "",
        });
        lastError = error?.message ?? null;
        if (!error || !/duplicate|unique/i.test(error.message)) break;
      }
      if (lastError) message = "We couldn't create your centre. Please try again or contact support.";
      else centerDone = true;
    } else {
      centerDone = true;
    }
  }

  if (inviteCode) {
    const { error } = await supabase.rpc("accept_invite", { p_code: inviteCode });
    if (error) message = "This invitation is no longer valid. Ask your centre to send a new one.";
  }

  // An invitation is tried once; a centre is retried on the next sign-in until it exists.
  await supabase.auth.updateUser({
    data: { invite_code: null, ...(centerDone ? { pending_center: null } : {}) },
  });
  return message;
}
