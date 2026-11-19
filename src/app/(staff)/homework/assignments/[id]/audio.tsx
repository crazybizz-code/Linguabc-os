"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, Loader2, RotateCcw } from "lucide-react";
import { Badge, buttonPrimary, type Tone } from "@/components/ui/primitives";
import { ListeningPlayer } from "@/components/listening/player";
import { useT } from "@/i18n/client";
import { generateListeningAudio } from "./actions";

const TONE: Record<string, Tone> = { draft: "neutral", generating: "blue", ready: "green", failed: "red" };
const LABEL: Record<string, string> = { draft: "No audio yet", generating: "Generating audio", ready: "Audio ready", failed: "Audio failed" };

export function ListeningAudio({ setId, status, src, error, durationMs, canGenerate }: {
  setId: string; status: string; src: string | null; error: string | null; durationMs: number | null; canGenerate: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [message, setMessage] = useState<string>();
  const [pending, start] = useTransition();
  const run = (again: boolean) => start(async () => {
    setMessage(undefined);
    const r = await generateListeningAudio(setId, again);
    if (r.error) setMessage(t(r.error));
    router.refresh();
  });
  const minutes = durationMs ? `${Math.floor(durationMs / 60000)}:${String(Math.round((durationMs % 60000) / 1000)).padStart(2, "0")}` : null;

  return (
    <div className="mb-5 space-y-3 rounded-[12px] border border-border bg-white/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <AudioLines className="h-4 w-4" /> {t("Listening audio")}
          <Badge tone={TONE[pending ? "generating" : status] ?? "neutral"}>{t(LABEL[pending ? "generating" : status] ?? status)}</Badge>
          {minutes && <span className="text-[12px] font-normal text-muted-foreground">{minutes}</span>}
        </div>
        {canGenerate && (
          src ? (
            <button type="button" disabled={pending} onClick={() => run(true)} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground underline disabled:opacity-50">
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} {t("Generate again")}
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={() => run(false)} className={buttonPrimary}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />} {t("Generate audio")}
            </button>
          )
        )}
      </div>
      {pending && <p className="text-[12.5px] text-muted-foreground">{t("Recording the script with AI voices — this can take a minute or two.")}</p>}
      {src && <ListeningPlayer src={src} />}
      {(message || (!pending && error)) && <p className="text-[12.5px] text-[#B4483D]">{message ?? t(error!)}</p>}
      {!src && !pending && <p className="text-[12px] text-muted-foreground">{t("Students hear the audio; they see the script only after they submit. Generate the audio before setting the work.")}</p>}
    </div>
  );
}
