import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The private "listening-audio" bucket. Only the server touches it, with
 * the service role, and only after a database function has checked the
 * caller (begin/finish_listening_audio for writes, listening_audio_path
 * for playback). Paths come from the database, never from the browser.
 */
const BUCKET = "listening-audio";
/** Long enough for a full listening test with pauses; never stored. */
export const SIGNED_URL_SECONDS = 60 * 60;

export const audioStorageConfigured = () => Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
const PATH = /^centres\/[0-9a-f-]{36}\/generated\/[0-9a-f-]{36}\/[0-9a-f]{64}\.mp3$/;

function bucket() {
  const admin = createAdminClient();
  if (!admin) throw new Error("Audio storage is not configured.");
  return admin.storage.from(BUCKET);
}

export async function uploadAudio(path: string, bytes: Buffer) {
  if (!PATH.test(path)) throw new Error("unexpected audio path");
  const { error } = await bucket().upload(path, bytes, { contentType: "audio/mpeg", upsert: false, cacheControl: "31536000" });
  // The same path always holds the same content, so a leftover from an interrupted run is fine.
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(`Audio upload failed: ${error.message}`);
}

export async function removeAudio(path: string) {
  if (!PATH.test(path)) return;
  const { error } = await bucket().remove([path]);
  if (error) console.error("Audio delete failed", path, error.message);
}

/** A short-lived link for one playback, or null if it can't be made. */
export async function signAudio(path: string | null | undefined): Promise<string | null> {
  if (!path || !PATH.test(path) || !audioStorageConfigured()) return null;
  const { data, error } = await bucket().createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) { console.error("Audio sign failed", error.message); return null; }
  return data.signedUrl;
}
