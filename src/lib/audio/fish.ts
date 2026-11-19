import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { encode } from "@msgpack/msgpack";
import { InvalidAudio, joinMp3, parseMp3, type Mp3 } from "./mp3";
import { parseScript, speakersOf, wordCount, type Turn } from "./script";

/**
 * Fish Audio text-to-speech (REST, no SDK). Server-only: the key never
 * reaches the browser.
 *
 *   FISH_AUDIO_API_KEY   required
 *   FISH_AUDIO_MODEL     default "s2.1-pro-free"
 *   FISH_AUDIO_VOICES    comma-separated voice ids (reference_id); the
 *                        first speaker gets the first voice, and so on.
 *                        Without voices the model's default voice reads
 *                        every part.
 *   FISH_AUDIO_BASE_URL  only for local testing
 *
 * The request mirrors Fish Audio's official SDKs: POST /v1/tts, a bearer
 * key, the model in a "model" header, and a msgpack body.
 */
export class AudioUnavailable extends Error {}

/** Clear speech at a small size: 64 kbps MP3 is plenty for a voice. */
const SETTINGS = { format: "mp3", mp3_bitrate: 64, normalize: true, latency: "normal", chunk_length: 200 } as const;
const PAUSE_MS = 450;
const PARALLEL = 3;
const TIMEOUT_MS = 90_000;

export const fishConfigured = () => Boolean(process.env.FISH_AUDIO_API_KEY);
export const fishModel = () => process.env.FISH_AUDIO_MODEL?.trim() || "s2.1-pro-free";
export const fishVoices = () =>
  (process.env.FISH_AUDIO_VOICES ?? "").split(",").map((v) => v.trim()).filter((v) => /^[A-Za-z0-9_-]{8,64}$/.test(v));

export type AudioPlan = {
  pieces: (Turn & { voice: string | null })[];
  voices: string[];
  model: string;
  words: number;
  characters: number;
  /** Identifies exactly what would be generated. */
  hash: string;
};

export function planAudio(script: string, again = false): AudioPlan {
  const turns = parseScript(script);
  if (turns.length === 0) throw new AudioUnavailable("The audio script is empty.");
  const voices = fishVoices();
  const model = fishModel();
  const cast = new Map(speakersOf(turns).map((s, i) => [s.toLowerCase(), voices.length ? voices[i % voices.length] : null]));
  const pieces = turns.map((t) => ({ ...t, voice: t.speaker ? (cast.get(t.speaker.toLowerCase()) ?? null) : (voices[0] ?? null) }));
  const hash = createHash("sha256")
    .update(JSON.stringify({ v: 1, model, SETTINGS, PAUSE_MS, pieces: pieces.map((p) => [p.voice, p.text]), again: again ? randomUUID() : null }))
    .digest("hex");
  return {
    pieces, model, hash,
    voices: [...new Set(pieces.map((p) => p.voice).filter((v): v is string => Boolean(v)))],
    words: wordCount(turns),
    characters: turns.reduce((n, t) => n + t.text.length, 0),
  };
}

async function speak(text: string, voice: string | null, model: string, retry = true): Promise<Mp3> {
  const base = (process.env.FISH_AUDIO_BASE_URL || "https://api.fish.audio").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/tts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`, "Content-Type": "application/msgpack", model },
    body: Buffer.from(encode({ text, ...SETTINGS, ...(voice ? { reference_id: voice } : {}) })),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((e: unknown) => {
    throw new AudioUnavailable(e instanceof Error && e.name === "TimeoutError" ? "Fish Audio took too long. Try a shorter script." : "Could not reach Fish Audio.");
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 429 && retry) { await new Promise((r) => setTimeout(r, 2500)); return speak(text, voice, model, false); }
    if (res.status === 401 || res.status === 403) { console.error("Fish Audio auth error", res.status, detail); throw new AudioUnavailable("The Fish Audio key was rejected. Check the key in the hosting settings."); }
    if (res.status === 402) throw new AudioUnavailable("Fish Audio credits have run out. Top up the account and try again.");
    if (res.status === 429) throw new AudioUnavailable("Fish Audio is busy or the free limit was reached. Try again later.");
    console.error("Fish Audio error", res.status, detail);
    if (res.status >= 400 && res.status < 500) throw new AudioUnavailable("Fish Audio could not read this script. Check the voices and the text.");
    throw new AudioUnavailable("Fish Audio had a problem. Try again shortly.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (type && !/audio|octet-stream/i.test(type)) throw new AudioUnavailable("Fish Audio did not return audio.");
  try {
    return parseMp3(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    if (e instanceof InvalidAudio) throw new AudioUnavailable("Fish Audio returned audio we could not use. Try again.");
    throw e;
  }
}

/** Every piece in its speaker's voice, joined with short pauses, and checked. */
export async function synthesize(plan: AudioPlan): Promise<{ bytes: Buffer; durationMs: number }> {
  const clips: Mp3[] = new Array(plan.pieces.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, plan.pieces.length) }, async () => {
    while (next < plan.pieces.length) {
      const k = next++;
      clips[k] = await speak(plan.pieces[k].text, plan.pieces[k].voice, plan.model);
    }
  }));
  let audio: Mp3;
  try { audio = joinMp3(clips, PAUSE_MS); } catch { throw new AudioUnavailable("The voices returned different audio formats. Use voices of the same model."); }
  checkLength(audio.durationMs, plan.words);
  return { bytes: audio.frames, durationMs: audio.durationMs };
}

/** Speech runs at roughly 0.4 s a word; far outside that, something went wrong. */
export function checkLength(durationMs: number, words: number) {
  const s = durationMs / 1000;
  if (s < Math.max(1, words * 0.12)) throw new AudioUnavailable("The audio is much shorter than the script. Try again.");
  if (s > words * 1.5 + 10) throw new AudioUnavailable("The audio is much longer than the script. Try again.");
  if (s > 20 * 60) throw new AudioUnavailable("The audio is longer than 20 minutes.");
}
