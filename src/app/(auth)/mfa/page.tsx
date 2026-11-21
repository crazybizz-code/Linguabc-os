import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Two-step sign-in" };

export default async function MfaPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!(aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2")) redirect("/");
  return (
    <AuthShell title="Two-step sign-in" subtitle="Open your authenticator app and enter the 6-digit code for LinguABC."
      footer={<form action={signOut}><button className="font-medium text-[#12392B] hover:underline">Sign out</button></form>}>
      <MfaForm />
    </AuthShell>
  );
}
