import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { AiUnavailable } from "./gemini";
import { fishConfigured, podcastModel, speakScript, voiceOptions as fishVoices, type Speech } from "./fish";
import { qwenConfigured, qwenVoices, speakWithQwen } from "./qwen";
import type { Cast, Voice } from "./script";
import { segmentCacheEnabled, supabaseSegmentStore } from "./segment-store";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Which text-to-speech provider records listening scripts and podcasts.
 *
 *   AUDIO_PROVIDER = fish (default, production) | qwen (pilot) | kokoro (not available yet)
 *
 * Anything else, or an unset variable, means Fish: a typo never switches
 * production to the pilot.
 */
export type ProviderId = "fish" | "qwen" | "kokoro";

export function audioProvider(): ProviderId {
  const v = (process.env.AUDIO_PROVIDER ?? "").trim().toLowerCase();
  return v === "qwen" || v === "kokoro" ? v : "fish";
}

export function audioConfigured(): boolean {
  const p = audioProvider();
  return p === "fish" ? fishConfigured() : p === "qwen" ? qwenConfigured() : false;
}

export function notConfiguredMessage(): string {
  const p = audioProvider();
  if (p === "qwen") return "Audio is not configured yet. Add the Qwen voice worker URL and secret in the hosting settings.";
  if (p === "kokoro") return "Kokoro voices are not available yet. Set AUDIO_PROVIDER to fish.";
  return "Audio is not configured yet. Add a Fish Audio key in the hosting settings.";
}

/** The voices mentors can choose from for the active provider. */
export async function voiceOptions(): Promise<Voice[]> {
  const p = audioProvider();
  return p === "qwen" ? qwenVoices() : p === "kokoro" ? [] : fishVoices();
}

export type AudioContext = {
  supabase: Client;
  /** The centre the recording is for; null for the LinguABC library (platform admins). */
  centerId: string | null;
  purpose: "homework" | "test" | "podcast";
};

/** Records a script with the active provider. */
export async function speak(script: string, cast: Cast, ctx: AudioContext): Promise<Speech> {
  const scope = ctx.centerId ?? "platform";
  switch (audioProvider()) {
    case "qwen":
      return speakWithQwen(script, cast, scope);
    case "kokoro":
      throw new AiUnavailable(notConfiguredMessage());
    default:
      return speakScript(script, cast, {
        model: ctx.purpose === "podcast" ? podcastModel() : undefined,
        cache: segmentCacheEnabled() ? { store: supabaseSegmentStore(ctx.supabase, ctx.centerId), scope } : undefined,
      });
  }
}
