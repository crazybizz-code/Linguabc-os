"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Loader2, Send } from "lucide-react";
import { buttonPrimary, Card, inputClass } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";
import { releaseMockResults, setMockTests } from "../../actions";

type Option = { id: string; title: string; level: string | null };
type Pick = { value: string | null; options: Option[] } | null;

/** Which LinguABC test students take online for reading and listening. */
export function OnlineTests({ sessionId, canEdit, reading, listening, started }: {
  sessionId: string; canEdit: boolean; reading: Pick; listening: Pick; started: number;
}) {
  const t = useT();
  const router = useRouter();
  const [r, setR] = useState(reading?.value ?? "");
  const [l, setL] = useState(listening?.value ?? "");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const dirty = r !== (reading?.value ?? "") || l !== (listening?.value ?? "");

  const row = (label: string, pick: Pick, value: string, set: (v: string) => void) => pick && (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-[#3B4A42]">{t(label)}</p>
      <div className="flex gap-2">
        <select value={value} disabled={!canEdit || pending} onChange={(e) => set(e.target.value)} className={inputClass}>
          <option value="">{t("Entered by hand")}</option>
          {pick.options.map((o) => <option key={o.id} value={o.id}>{o.title}{o.level ? ` · ${o.level}` : ""}</option>)}
        </select>
        {value && (
          <Link href={`/mocks/tests/${value}`} target="_blank" title={t("Preview")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border/80 bg-[#FCF8F4] hover:bg-white"><Eye className="h-4 w-4" /></Link>
        )}
      </div>
    </div>
  );

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="text-[15px] font-semibold">{t("Online test")}</h2>
        <p className="text-[12px] text-muted-foreground">
          {started ? t("{n} students have started, so the tests are fixed.", { n: started })
            : t("Choose a LinguABC test and students take it in the app, timed like the real exam.")}
        </p>
      </div>
      {row("Listening", listening, l, setL)}
      {row("Reading", reading, r, setR)}
      {(reading?.options.length === 0 || listening?.options.length === 0) && (
        <p className="text-[11.5px] text-muted-foreground">{t("No published LinguABC test of this kind yet.")}</p>
      )}
      {error && <p className="text-[12.5px] text-[#B4483D]">{error}</p>}
      {canEdit && dirty && (
        <button type="button" disabled={pending} className={buttonPrimary}
          onClick={() => start(async () => {
            setError(undefined);
            const res = await setMockTests(sessionId, r || null, l || null);
            if (res?.error) setError(t(res.error)); else router.refresh();
          })}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save tests")}
        </button>
      )}
    </Card>
  );
}

/** Sends every finished result to students and parents. */
export function ReleaseBar({ sessionId, ready }: { sessionId: string; ready: number }) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border/60 px-5 py-3.5">
      <span className="mr-auto text-[12.5px] text-muted-foreground">{t("{n} results ready to send", { n: ready })}</span>
      {error && <span className="text-[12.5px] text-[#B4483D]">{error}</span>}
      <button type="button" disabled={pending || ready === 0} className={buttonPrimary}
        onClick={() => {
          if (!confirm(t("Send these results to students and parents? They can't be changed afterwards."))) return;
          start(async () => {
            setError(undefined);
            const res = await releaseMockResults(sessionId);
            if (res?.error) setError(t(res.error)); else router.refresh();
          });
        }}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("Send results")}
      </button>
    </div>
  );
}
