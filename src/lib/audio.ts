import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export const AUDIO_BUCKET = "listening-audio";
export const LIBRARY_AUDIO = "library-audio";
/** Long enough to finish a listening section with pauses; short enough not to be worth sharing. */
const SIGNED_FOR = 2 * 60 * 60;

/**
 * A short-lived link to a listening file. Storage policies decide whether
 * the signed-in user may hear it; when they may not, this returns null.
 */
export async function audioUrl(supabase: Client, path: string | null | undefined, bucket = AUDIO_BUCKET): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_FOR);
  if (error) return null;
  return data.signedUrl;
}
