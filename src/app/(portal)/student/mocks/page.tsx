import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { getPortalContext } from "@/lib/portal/context";
import { PortalCard } from "@/components/portal/cards";
import { Badge } from "@/components/ui/primitives";
import { intlLocale } from "@/i18n";

export const metadata = { title: "Mocks" };
type Module = { skill: "reading" | "listening"; ready: boolean; state: "new" | "started" | "done" };
type Mock = { session_id: string; name: string; scheduled_at: string; status: string; released: boolean; modules: Module[] };

export default async function StudentMocks() {
  const ctx = await getPortalContext("student");
  const { supabase, t } = ctx;
  const { data } = await supabase.rpc("my_online_mocks");
  const mocks = (Array.isArray(data) ? data : []) as Mock[];
  const L = intlLocale(ctx.locale);
  const now = Date.parse(new Date().toISOString());
  const fmt = (iso: string) => new Date(iso).toLocaleString(L, { timeZone: "Asia/Tashkent", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <h1 className="px-1 text-[20px] font-semibold tracking-[-0.02em]">{t("Mocks")}</h1>
      {mocks.length === 0 && (
        <PortalCard icon={ClipboardList} title={t("Mocks")}>
          <p className="text-[13px] text-muted-foreground">{t("No online mock yet. Your mentor will set one up.")}</p>
        </PortalCard>
      )}
      {mocks.map((m) => {
        const opens = Date.parse(m.scheduled_at) - 15 * 60_000;
        const closes = Date.parse(m.scheduled_at) + 12 * 3600_000;
        const open = now >= opens && now <= closes;
        const order = [...m.modules].sort((a) => (a.skill === "listening" ? -1 : 1));
        return (
          <PortalCard key={m.session_id} title={m.name}
            action={m.released ? <Badge tone="green">{t("Results sent")}</Badge> : undefined}>
            <p className="text-[12.5px] text-muted-foreground">{fmt(m.scheduled_at)}</p>
            <ul className="mt-3 divide-y divide-border/60">
              {order.map((x) => (
                <li key={x.skill} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-[14px] font-medium">{t(x.skill === "listening" ? "Listening" : "Reading")}</span>
                  {x.state === "done" ? <Badge tone="blue">{t("Submitted")}</Badge>
                    : !x.ready ? <span className="text-[12px] text-muted-foreground">{t("Test not ready")}</span>
                    : x.state === "started" || open ? (
                      <Link href={`/exam/${m.session_id}/${x.skill}`} className="rounded-[10px] bg-[#12392B] px-3.5 py-2 text-[12.5px] font-medium text-white">
                        {t(x.state === "started" ? "Continue" : "Start")}
                      </Link>
                    ) : <span className="text-[12px] text-muted-foreground">{now < opens ? t("Opens {date}", { date: fmt(new Date(opens).toISOString()) }) : t("Closed")}</span>}
                </li>
              ))}
            </ul>
            {m.modules.every((x) => x.state === "done") && !m.released && (
              <p className="mt-2 text-[12px] text-muted-foreground">{t("Your mentor will send the full result after marking writing and speaking.")}</p>
            )}
          </PortalCard>
        );
      })}
    </>
  );
}
