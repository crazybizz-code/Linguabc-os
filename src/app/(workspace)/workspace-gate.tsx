import { redirect } from "next/navigation";
import { LogOut, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaces, homePath, ROLE_LABEL, type Role } from "@/lib/auth/workspace";
import { signOut } from "../(auth)/actions";

/**
 * Temporary workspace frame: confirms the signed-in person reached the
 * right workspace for their role. The real dashboards replace the body.
 */
export async function WorkspaceGate({ allowed, area }: { allowed: Role[]; area: string }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const workspaces = await getWorkspaces(supabase, userId);
  const current = workspaces.find((w) => allowed.includes(w.role));
  if (!current) redirect(workspaces[0] ? homePath(workspaces[0].role) : "/");

  return (
    <div className="min-h-screen bg-[#F5ECE8]">
      <header className="flex items-center justify-between border-b border-border/70 bg-[#FCF8F4] px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[#12392B]">
            <Sparkles className="h-[14px] w-[14px] text-[#E8DCCB]" strokeWidth={1.9} />
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold tracking-[-0.02em] text-[#17211D]">{current.centerName}</div>
            <div className="text-[11px] text-muted-foreground">
              {current.fullName} · {ROLE_LABEL[current.role]}
            </div>
          </div>
        </div>
        <form action={signOut}>
          <button className="flex h-9 items-center gap-1.5 rounded-[10px] border border-border/80 bg-[#FCF8F4] px-3 text-[12px] font-medium text-[#17211D] hover:bg-white">
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.9} /> Sign out
          </button>
        </form>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#7A8F7F]">{area}</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-[#17211D]">
          Welcome, {current.fullName.split(" ")[0] || "there"}
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          You&apos;re signed in to {current.centerName}. This workspace is being built next.
        </p>
      </main>
    </div>
  );
}
