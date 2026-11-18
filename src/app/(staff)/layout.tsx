import { LogOut } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { ROLE_LABEL } from "@/lib/auth/workspace";
import { MobileNav, Sidebar } from "@/components/workspace/sidebar";
import { signOut } from "../(auth)/actions";

export default async function StaffLayout({ children }: LayoutProps<"/">) {
  const { workspace, isAdmin, isStaff } = await getStaffContext();
  const roleLabel = ROLE_LABEL[workspace.role];
  return (
    <div className="flex min-h-screen gap-6 bg-[#F5ECE8] p-4">
      <Sidebar name={workspace.fullName} roleLabel={roleLabel} isAdmin={isAdmin} isStaff={isStaff} />
      <div className="min-w-0 flex-1 pb-10 lg:pr-2">
        <header className="flex items-center justify-between gap-3 py-1 print:hidden">
          <div className="flex items-center gap-2 rounded-[12px] border border-border/70 bg-[#FCF8F4] px-3.5 py-2 text-[12.5px]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3F6B4A]" />
            <span className="text-[#3B4A42]">{workspace.centerName}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium text-[#17211D]">{roleLabel}</span>
          </div>
          <form action={signOut}>
            <button className="flex h-9 items-center gap-1.5 rounded-[10px] border border-border/80 bg-[#FCF8F4] px-3 text-[12px] font-medium text-[#17211D] hover:bg-white">
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.9} /> Sign out
            </button>
          </form>
        </header>
        <div className="mt-3 print:hidden">
          <MobileNav isStaff={isStaff} />
        </div>
        <main className="mt-5">{children}</main>
      </div>
    </div>
  );
}
