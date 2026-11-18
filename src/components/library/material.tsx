import { ExternalLink } from "lucide-react";
import { cleanArticleHtml } from "@/lib/library/render";
import type { T } from "@/i18n";

type Line = { text: string; speaker?: string };
export type Material = {
  kind: string; body_html: string | null; body_format: string; audio_url: string | null; transcript: unknown;
  author: string | null; source_name: string | null; licence: string | null; source_url: string | null;
};

/** A library article (sanitised HTML or plain text) or podcast (audio + transcript), with attribution. */
export function MaterialView({ item, t }: { item: Material; t: T }) {
  const transcript = (Array.isArray(item.transcript) ? item.transcript : []) as Line[];
  return (
    <>
      {item.kind === "podcast" && item.audio_url && <audio controls preload="none" src={item.audio_url} className="mb-5 w-full" />}
      {item.kind === "article" && item.body_html && (
        item.body_format === "html"
          ? <div className="library-prose" dangerouslySetInnerHTML={{ __html: cleanArticleHtml(item.body_html) }} />
          : <div className="library-prose whitespace-pre-line">{item.body_html}</div>
      )}
      {item.kind === "podcast" && transcript.length > 0 && (
        <details className="group" open={false}>
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.1em] text-[#5F6B66]">{t("Transcript")}</summary>
          <div className="mt-3 space-y-3">
            {transcript.map((l, i) => (
              <p key={i} className="text-[14px] leading-relaxed">{l.speaker && <span className="mr-1.5 font-semibold">{l.speaker}:</span>}{l.text}</p>
            ))}
          </div>
        </details>
      )}
      <p className="mt-6 border-t border-border/60 pt-4 text-[11.5px] text-muted-foreground">
        {[item.author, item.source_name, item.licence].filter(Boolean).join(" · ")}
        {item.source_url && <> · <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">{t("Original")} <ExternalLink className="h-3 w-3" /></a></>}
      </p>
    </>
  );
}
