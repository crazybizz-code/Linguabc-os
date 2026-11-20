import "server-only";
import { AiUnavailable } from "./gemini";

/**
 * Fish Audio text-to-speech (REST, no SDK). Server-only: the key never
 * reaches the browser.
 *
 *   FISH_AUDIO_API_KEY   required
 *   FISH_AUDIO_VOICE     voice (model) id for the first speaker; optional
 *   FISH_AUDIO_VOICE_2   voice for the second speaker in a dialogue; optional
 *   FISH_AUDIO_MODEL     TTS model header (default "s1")
 *   FISH_AUDIO_BASE_URL  only for local testing
 *
 * A script written as "Name: line" turns into a dialogue: each speaker gets
 * a voice (alternating between the two), lines are spoken one by one and the
 * MP3 pieces are joined. Without a second voice everything uses one voice.
 */
export const fishConfigured = () => Boolean(process.env.FISH_AUDIO_API_KEY);

/** Keeps one listening section to a few minutes of audio (and its cost bounded). */
export const MAX_SCRIPT_CHARS = 8000;
const MAX_SEGMENTS = 60;
const PARALLEL = 3;

export type Segment = { speaker: string | null; text: string };
export type Speech = { audio: Buffer; bytes: number; model: string; segments: number };

const LABEL = /^\s*([A-Z][A-Za-z0-9 .'-]{0,30}|[A-Z]):\s+(.+)$/;

/** Splits a script into spoken segments, merging consecutive lines of one speaker. */
export function splitScript(script: string): Segment[] {
  const out: Segment[] = [];
  let current: string | null = null;
  for (const raw of script.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = LABEL.exec(line);
    const speaker: string | null = m ? m[1].trim() : current;
    const text = (m ? m[2] : line).trim();
    // Stage directions like "[sound of a door]" are not read out.
    const spoken = text.replace(/\[[^\]]*\]/g, "").trim();
    current = speaker;
    if (!spoken) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text += `\n${spoken}`;
    else out.push({ speaker, text: spoken });
  }
  return out;
}

/** Strips a leading ID3v2 tag so joined MP3 pieces play as one stream. */
function stripId3(buf: Buffer): Buffer {
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return buf;
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  return buf.subarray(10 + size + (buf[5] & 0x10 ? 10 : 0));
}

async function tts(text: string, voice: string | undefined, model: string): Promise<Buffer> {
  const base = process.env.FISH_AUDIO_BASE_URL || "https://api.fish.audio";
  const body = { text, format: "mp3", mp3_bitrate: 128, normalize: true, latency: "normal", ...(voice && { reference_id: voice }) };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${base}/v1/tts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`, "Content-Type": "application/json", model },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    }).catch((e: unknown) => {
      throw new AiUnavailable(e instanceof Error && e.name === "TimeoutError" ? "The voice service took too long. Try a shorter script." : "Could not reach the voice service.");
    });
    if (res.ok) {
      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length < 100) throw new AiUnavailable("The voice service returned no audio. Try again.");
      return audio;
    }
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    if (res.status === 401 || res.status === 403) { console.error("Fish Audio auth error", res.status, detail); throw new AiUnavailable("The voice service key was rejected. Check the key in the hosting settings."); }
    if (res.status === 402) throw new AiUnavailable("Voice credits have run out. Top up the Fish Audio account and try again.");
    if (res.status === 429) throw new AiUnavailable("The voice service is busy. Try again in a minute.");
    console.error("Fish Audio error", res.status, detail);
    throw new AiUnavailable(res.status < 500 ? "The voice service could not read this script. Check the text and try again." : "The voice service had a problem. Try again shortly.");
  }
  throw new AiUnavailable("The voice service is busy. Try again in a minute.");
}

/** Turns a listening script into one MP3. */
export async function speakScript(script: string): Promise<Speech> {
  if (!fishConfigured()) throw new AiUnavailable("Audio is not configured yet. Add a Fish Audio key in the hosting settings.");
  const model = process.env.FISH_AUDIO_MODEL || "s1";
  const voices = [process.env.FISH_AUDIO_VOICE, process.env.FISH_AUDIO_VOICE_2].map((v) => v?.trim() || undefined);

  let segments = splitScript(script);
  if (segments.length === 0) throw new AiUnavailable("Write the script first.");
  // One voice only: read the whole script in one request.
  if (!voices[1]) segments = [{ speaker: null, text: segments.map((s) => s.text).join("\n") }];
  if (segments.length > MAX_SEGMENTS) throw new AiUnavailable("The dialogue has too many turns. Merge some lines and try again.");

  const order = [...new Set(segments.map((s) => s.speaker ?? ""))];
  const voiceOf = (s: Segment) => voices[order.indexOf(s.speaker ?? "") % 2] ?? voices[0];

  const pieces: Buffer[] = new Array(segments.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, segments.length) }, async () => {
    while (next < segments.length) {
      const i = next++;
      pieces[i] = await tts(segments[i].text, voiceOf(segments[i]), model);
    }
  }));

  return {
    audio: Buffer.concat(pieces.map((p, i) => (i === 0 ? p : stripId3(p)))),
    bytes: Buffer.byteLength(segments.map((s) => s.text).join(""), "utf8"),
    model: `fish/${model}`,
    segments: segments.length,
  };
}
