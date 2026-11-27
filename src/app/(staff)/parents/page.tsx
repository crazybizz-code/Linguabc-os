import Link from "next/link";
import { redirect } from "next/navigation";
import { HeartHandshake } from "lucide-react";
import { getStaffContext } from "@/lib/auth/current";
import { siteUrl } from "@/lib/supabase/config";
import { Avatar, Badge, Card, EmptyState, formatUZS, PageHeader, cn } from "@/components/ui/primitives";
import { InviteLink } from "../staff/invite-staff";
import { LoginInvite } from "../students/[id]/login-invite";
import { inviteParentLogin } from "../actions";
import { telegramReadiness } from "@/lib/telegram/server";
import { READINESS_TEXT } from "@/lib/telegram/readiness";
import { attachCandidates, groupFamilies, type FamilyRow, type GuardianIn, type StudentIn } from "@/lib/families";
import { TelegramCell, type TelegramStatus } from "./telegram-cell";

export const metadata = { title: "Parents" };

/**
 * Parents and their children, portal access and money owed. Owner and admin only.
 * A row is one parent ACCOUNT (children linked to the same membership) or one
 * unlinked guardian record; names and phone numbers never merge rows.
 */
export default async function ParentsPage({ searchParams }: PageProps<"/parents">) {
  const { supabase, workspace, isAdmin, t } = await getStaffContext();
  if (!isAdmin) redirect("/dashboard");
  const { q, portal } = await searchParams;
  const center = workspace.centerId;
  const [guardians, students, links, healthRes] = await Promise.all([
    supabase.from("guardians").select("id, student_id, full_name, phone, relationship, is_primary, membership_id, memberships!guardians_membership_id_center_id_fkey(id, status, invite_code, invite_expires_at)")
      .eq("center_id", center).order("full_name"),
    supabase.from("student_overview").select("id, full_name, status, open_balance, overdue_count").eq("center_id", center),
    // Status only: chat ids are not read here.
    supabase.from("telegram_links").select("membership_id, linked_at, blocked_at").eq("center_id", center).is("revoked_at", null),
    supabase.rpc("telegram_queue_health", { p_center: center }),
  ]);
  // Delivery health (0039): counts only. Missing before the migration: hidden.
  const health = healthRes.error ? null : (healthRes.data as { sent: number; waiting: number; failed: number; blocked_parents: number; oldest_waiting_minutes: number | null } | null);
  const tg = new Map((links.data ?? []).map((l) => [l.membership_id, l]));
  // Server-side readiness: configuration, database functions and getMe. Only a reason reaches the page.
  const ready = await telegramReadiness();
  const guardianRows: GuardianIn[] = (guardians.data ?? []).map((g) => ({
    id: g.id, student_id: g.student_id, full_name: g.full_name, phone: g.phone, relationship: g.relationship,
    membership_id: g.membership_id, membership: (g.memberships as GuardianIn["membership"]) ?? null,
  }));
  const studentRows: StudentIn[] = (students.data ?? []).map((s) => ({ id: s.id!, full_name: s.full_name, open_balance: s.open_balance, overdue_count: s.overdue_count }));
  const all: FamilyRow[] = groupFamilies(guardianRows, studentRows);
  const query = typeof q === "string" ? q.trim().toLowerCase() : "";
  const status = (r: FamilyRow) => (r.membership?.status === "active" ? "active" : r.membership?.status === "invited" ? "invited" : "none");
  const shown = all.filter((r) => (!query || r.name.toLowerCase().includes(query) || (r.phone ?? "").includes(query) || r.children.some((c) => c.name.toLowerCase().includes(query)))
    && (typeof portal !== "string" || !portal || status(r) === portal));
  const count = (s: string) => all.filter((r) => status(r) === s).length;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Parent experience")} title={t("Parents")}
        description={t("One row per parent account, or per parent record that is not linked to an account yet. Names and phone numbers never merge rows.")} />
      <Card className="grid grid-cols-2 divide-border/60 md:grid-cols-4 md:divide-x">
        {[[t("Parents"), all.length], [t("Telegram connected"), all.filter((r) => r.membership && tg.has(r.membership.id)).length], [t("Portal active"), count("active")], [t("No portal access"), count("none")]].map(([k, v]) => (
          <div key={String(k)} className="p-5">
            <p className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{k}</p>
            <p className="mt-2 text-[24px] font-semibold tracking-[-0.03em]">{v}</p>
          </div>
        ))}
      </Card>
      {!ready.ready && (
        <p className="-mt-3 text-[12px] text-muted-foreground">{t(READINESS_TEXT[ready.reason])}</p>
      )}
      {health && (
        <p className={cn("-mt-3 text-[12px]", health.failed > 0 || (health.oldest_waiting_minutes ?? 0) > 15 ? "text-[#B4483D]" : "text-muted-foreground")}>
          {t("Telegram messages, last 7 days: {sent} sent, {waiting} waiting, {failed} failed; {blocked} parents blocked the bot.",
            { sent: health.sent, waiting: health.waiting, failed: health.failed, blocked: health.blocked_parents })}
        </p>
      )}
      <Card className="overflow-hidden">
        <form className="flex flex-wrap items-center gap-2 border-b border-border/60 p-4">
          <input name="q" defaultValue={query} placeholder={t("Search a parent, phone or child")} className="h-9 min-w-[240px] flex-1 rounded-[10px] border border-border/80 bg-[#FCF8F4] px-3 text-[12.5px]" />
          <select name="portal" defaultValue={typeof portal === "string" ? portal : ""} className="h-9 rounded-[10px] border border-border/80 bg-[#FCF8F4] px-3 text-[12.5px]">
            <option value="">{t("Portal: all")}</option>
            <option value="active">{t("Portal active")}</option>
            <option value="invited">{t("Invited")}</option>
            <option value="none">{t("No portal access")}</option>
          </select>
          <button className="h-9 rounded-[10px] bg-[#12392B] px-4 text-[12.5px] font-medium text-[#FAF5EF]">{t("Filter")}</button>
        </form>
        {shown.length === 0 ? (
          <EmptyState icon={HeartHandshake} title={t("No parents yet")} description={t("Parents are added with each student. Open a student to add a parent or guardian.")} />
        ) : (
          <ul className="divide-y divide-border/50">
            {shown.map((r) => {
              const owed = r.children.reduce((n, c) => n + c.balance, 0);
              const late = r.children.some((c) => c.overdue > 0);
              return (
                <li key={r.key} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="flex min-w-[240px] items-center gap-3">
                    <Avatar name={r.name} />
                    <div>
                      <p className="text-[13.5px] font-medium">{r.name}</p>
                      <p className="text-[12px] text-muted-foreground">{[r.relationship && t(r.relationship[0].toUpperCase() + r.relationship.slice(1)), r.phone].filter(Boolean).join(" · ") || "—"}</p>
                      <p className="mt-0.5 text-[12px]">
                        {r.children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/students/${c.id}`} className="text-[#12392B] hover:underline">{c.name}</Link></span>)}
                      </p>
                    </div>
                  </div>
                  <div className={cn("text-[12.5px]", late ? "font-medium text-[#B4483D]" : "text-muted-foreground")}>
                    {owed > 0 ? `${formatUZS(owed)} ${t(late ? "overdue" : "to pay")}` : t("Nothing owed")}
                  </div>
                  <div className="min-w-[260px]">
                    {r.membership?.status === "active" ? <Badge tone="green">{t("Parent portal active")}</Badge>
                      : r.membership?.status === "invited" && r.membership.invite_code
                        ? <InviteLink membershipId={r.membership.id} link={`${siteUrl()}/join?code=${r.membership.invite_code}`} expiresAt={r.membership.invite_expires_at} canReissue />
                        : r.membership
                          // Account made for Telegram, no web invite yet (the web portal is optional in the pilot).
                          ? <Badge tone="neutral">{t("No web portal (Telegram account)")}</Badge>
                          : <LoginInvite label={t("Invite to parent portal")} field="guardian_id" value={r.guardianId} action={inviteParentLogin} who={r.name} />}
                  </div>
                  <div className="min-w-[220px]">
                    {(() => {
                      const l = r.membership ? tg.get(r.membership.id) : undefined;
                      const st: TelegramStatus = !l ? "none" : l.blocked_at ? "blocked" : "linked";
                      return <TelegramCell guardianId={r.guardianId} membershipId={r.membership?.id ?? null} status={st} parentName={r.name}
                        linkedAt={l?.linked_at ?? null} candidates={attachCandidates(r, guardianRows, studentRows)} botReady={ready.ready} />;
                    })()}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
