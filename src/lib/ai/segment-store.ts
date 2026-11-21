import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { Claim, SegmentStore } from "./segment-cache";

type Client = Awaited<ReturnType<typeof createClient>>;

export const SEGMENT_BUCKET = "audio-segments";

/** The cache can be switched off without a deploy of new code: AUDIO_SEGMENT_CACHE=off. */
export const segmentCacheEnabled = () => !/^(off|false|0)$/i.test(process.env.AUDIO_SEGMENT_CACHE ?? "");

/**
 * The segment cache in Supabase (migration 0029), acting as the signed-in
 * user: the RPCs and storage policies decide which scope they may use.
 * centerId null is the LinguABC library (platform admins).
 */
export function supabaseSegmentStore(supabase: Client, centerId: string | null): SegmentStore {
  return {
    async claim(hash, meta): Promise<Claim> {
      const { data, error } = await supabase.rpc("claim_audio_segment", {
        p_center: centerId, p_hash: hash, p_provider: meta.provider, p_model: meta.model, p_voice: meta.voice, p_text_bytes: meta.textBytes,
      });
      if (error) throw new Error(`claim_audio_segment: ${error.message}`);
      const claim = data as { state?: string; path?: string } | null;
      if ((claim?.state === "ready" || claim?.state === "generate") && typeof claim.path === "string") return { state: claim.state, path: claim.path };
      if (claim?.state === "wait") return { state: "wait" };
      throw new Error("claim_audio_segment: unexpected answer");
    },
    async download(path) {
      const { data, error } = await supabase.storage.from(SEGMENT_BUCKET).download(path);
      if (error || !data) throw new Error(`segment download: ${error?.message ?? "no data"}`);
      return Buffer.from(await data.arrayBuffer());
    },
    async upload(path, audio) {
      const { error } = await supabase.storage.from(SEGMENT_BUCKET).upload(path, audio, { contentType: "audio/mpeg", upsert: false });
      // A take that crashed after uploading left the same file: that is fine to reuse.
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`segment upload: ${error.message}`);
    },
    async finish(hash, audioBytes) {
      const { error } = await supabase.rpc("finish_audio_segment", { p_center: centerId, p_hash: hash, p_audio_bytes: audioBytes });
      if (error) throw new Error(`finish_audio_segment: ${error.message}`);
    },
    async release(hash) {
      const { error } = await supabase.rpc("release_audio_segment", { p_center: centerId, p_hash: hash });
      if (error) throw new Error(`release_audio_segment: ${error.message}`);
    },
  };
}
