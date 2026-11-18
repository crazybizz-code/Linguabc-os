import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Start your learning center" };

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="For centre owners"
      title="Start your learning center"
      subtitle="Create the centre, and your owner account comes with it. Staff, students and parents join from inside."
      footer={
        <span>
          Already running a centre?{" "}
          <Link href="/login" className="font-medium text-[#12392B] hover:underline">
            Log in
          </Link>
        </span>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
