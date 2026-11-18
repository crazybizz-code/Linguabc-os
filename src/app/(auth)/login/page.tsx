import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "/";
  return (
    <AuthShell
      title="Welcome back"
      subtitle="One account for owners, staff, students and parents. Your workspace is chosen for you."
      footer={
        <div className="space-y-1.5">
          <div>
            New here?{" "}
            <Link href="/register" className="font-medium text-[#12392B] hover:underline">
              Start your learning center
            </Link>
          </div>
          <div className="text-[11px] text-muted-foreground/80">
            Joined by invitation?{" "}
            <Link href="/join" className="underline-offset-2 hover:underline">
              Open your invitation link
            </Link>
          </div>
        </div>
      }
    >
      <LoginForm next={nextPath} />
    </AuthShell>
  );
}
