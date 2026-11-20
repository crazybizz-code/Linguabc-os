"use client";

import { useState, useTransition } from "react";
import { AudioLines, Loader2 } from "lucide-react";
import { FieldLabel } from "@/components/ui/dialog";
import { buttonPrimary, inputClass } from "@/components/ui/primitives";
import { useT } from "@/i18n/client";
import { defaultCast, speakersOf, type Cast, type Voice } from "@/lib/ai/script";

/** Generates the recording for a listening script and previews it. */
export function AudioPanel({ script, audioPath, initialUrl, voices, record, onChange }: {
  script: string; audioPath?: string; initialUrl?: string; voices: Voice[];
  record: (script: string, previous?: string, cast?: Cast) => Promise<{ path?: string; url?: string; error?: string }>;
  onChange: (path: string | undefined) => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<Cast>({});
  const speakers = speakersOf(script).slice(0, 8);
  const cast = defaultCast(speakers, voices, chosen);
  const [url, setUrl] = useState<string | undefined>(initialUrl);
  const [madeFrom, setMadeFrom] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const stale = audioPath && madeFrom !== undefined && madeFrom !== script;

  return (
    <div className="space-y-3 rounded-[12px] border border-border/70 bg-[#FCF8F4] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13.5px] font-medium">{t("Recording")}</p>
          <p className="text-[12px] text-muted-foreground">
            {pending ? t("Recording the script — this can take up to a minute.") : audioPath ? t("Listen before you save.") : t("No recording yet. Without one, students read the script instead.")}
          </p>
        </div>
        <button type="button" disabled={pending || script.trim().length < 20} className={buttonPrimary}
          onClick={() => start(async () => {
            setError(undefined);
            const r = await record(script, audioPath, cast);
            if (r.error || !r.path) { setError(t(r.error ?? "Something went wrong. Try again.")); return; }
            setUrl(r.url); setMadeFrom(script); onChange(r.path);
          })}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AudioLines className="h-4 w-4" />}
          {audioPath ? t("Record again") : t("Generate audio")}
        </button>
      </div>
      {speakers.length > 0 && voices.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {speakers.map((s) => (
            <FieldLabel key={s} label={s || t("Narrator")}>
              <select value={cast[s]} disabled={pending} onChange={(e) => setChosen({ ...chosen, [s]: e.target.value })} className={inputClass}>
                {voices.map((v) => <option key={v.id} value={v.id}>{t(v.label)}</option>)}
              </select>
            </FieldLabel>
          ))}
        </div>
      )}
      {url && <audio controls src={url} className="w-full" />}
      {stale && <p className="text-[12.5px] text-[#9A5B1E]">{t("The script changed after recording. Record again so they match.")}</p>}
      {error && <p className="text-[12.5px] text-[#B4483D]">{error}</p>}
    </div>
  );
}

