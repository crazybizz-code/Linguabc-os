import Link from "next/link";
import type { ReactNode } from "react";
import { Ticket } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/auth/workspace";
import { AcceptSignedIn, JoinForm } from "./join-form";

export const metadata = { title: "Accept your invitation" };

const backToLogin = (
  <Link href="/login" className="font-medium text-[#12392B] hover:underline">
    Back to log in
  </Link>
);

export default async function JoinPage({ searchParams }: PageProps<"/join">) {
  const { code: raw } = await searchParams;
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";

  if (!code) {
    return (
      <AuthShell
        title="Invitation needed"
        subtitle="Accounts are created by a learning centre — there is no public sign-up for staff, students or parents."
        footer={backToLogin}
      >
        <InviteNote>Open the invitation link your centre shared with you, or ask them to resend it.</InviteNote>
      </AuthShell>
    );
  }

  const supabase = await createClient();
  const [{ data: preview }, { data: claims }] = await Promise.all([
    supabase.rpc("invite_preview", { p_code: code }),
    supabase.auth.getClaims(),
  ]);
  const invite = preview?.[0];

  if (!invite) {
    return (
      <AuthShell
        title="Invitation not valid"
        subtitle="This link has already been used or was withdrawn by the centre."
        footer={backToLogin}
      >
        <InviteNote>Ask your centre to send you a new invitation.</InviteNote>
      </AuthShell>
    );
  }

  const subtitle = (
    <>
      <span className="font-medium text-[#17211D]">{invite.center_name}</span> invited you as{" "}
      <span className="font-medium text-[#17211D]">{ROLE_LABEL[invite.role]}</span>. Create a password to open your
      account.
    </>
  );

  return (
    <AuthShell
      eyebrow="Invitation"
      title="Accept your invitation"
      subtitle={subtitle}
      footer={
        claims?.claims ? undefined : (
          <span>
            Already have an account?{" "}
            <Link href={`/login?next=${encodeURIComponent(`/join?code=${code}`)}`} className="font-medium text-[#12392B] hover:underline">
              Log in
            </Link>
          </span>
        )
      }
    >
      <div className="mb-4 flex items-center justify-between rounded-[11px] border border-border/70 bg-[#F5ECE8]/70 px-3.5 py-2.5">
        <span className="text-[11px] uppercase tracking-[0.06em] text-muted-foreground">Invitation code</span>
        <span className="font-mono text-[12px] font-medium tracking-[0.08em] text-[#12392B]">{code}</span>
      </div>
      {claims?.claims ? (
        <AcceptSignedIn code={code} />
      ) : (
        <JoinForm code={code} defaultName={invite.full_name} defaultEmail={invite.email ?? ""} />
      )}
      <p className="mt-3 text-center text-[10.5px] leading-relaxed text-muted-foreground">
        Your role is assigned by the centre — you cannot choose or change it here.
      </p>
    </AuthShell>
  );
}

function InviteNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-border/70 bg-[#F5ECE8]/60 p-3.5 text-[12px] leading-relaxed text-muted-foreground">
      <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-[#8A5A26]" strokeWidth={1.8} />
      {children}
    </div>
  );
}
