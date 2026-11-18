import { redirect } from "next/navigation";
import { LogOut, Ticket } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaces, homePath } from "@/lib/auth/workspace";
import { signOut } from "./(auth)/actions";

/** Sends each person to the workspace their role belongs to. */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { notice } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");

  const workspaces = await getWorkspaces(supabase, userId);
  if (workspaces.length > 0 && !notice) redirect(homePath(workspaces[0].role));

  return (
    <AuthShell
      title={workspaces.length ? "Almost there" : "No workspace yet"}
      subtitle={
        typeof notice === "string"
          ? notice
          : "Your account isn't linked to a centre yet. Open the invitation link your centre sent you."
      }
      footer={
        <form action={signOut}>
          <button className="inline-flex items-center gap-1.5 font-medium text-[#12392B] hover:underline">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </form>
      }
    >
      {workspaces.length ? (
        <a
          href={homePath(workspaces[0].role)}
          className="flex h-11 w-full items-center justify-center rounded-[11px] bg-[#12392B] text-[13px] font-medium text-[#FAF5EF] hover:bg-[#0D3024]"
        >
          Continue to {workspaces[0].centerName}
        </a>
      ) : (
        <div className="flex items-start gap-3 rounded-[12px] border border-border/70 bg-[#F5ECE8]/60 p-3.5 text-[12px] leading-relaxed text-muted-foreground">
          <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-[#8A5A26]" strokeWidth={1.8} />
          Centre owners create their centre at /register. Everyone else joins by invitation.
        </div>
      )}
    </AuthShell>
  );
}
