import "server-only";
import { AiUnavailable } from "./gemini";
import { defaultCast, MAX_SCRIPT_CHARS, splitScript, type Cast, type Voice } from "./script";

export { MAX_SCRIPT_CHARS, splitScript };

/**
 * Fish Audio text-to-speech (REST, no SDK). Server-only: the key never
 * reaches the browser.
 *
 *   FISH_AUDIO_API_KEY   required
 *   FISH_AUDIO_VOICES    comma-separated voice (model) ids; defaults below
 *   FISH_AUDIO_MODEL     TTS model header (default "s2.1-pro": s1 retires on 31 Dec 2026)
 *   FISH_AUDIO_PODCAST_MODEL  model for LinguABC library podcasts (default: FISH_AUDIO_MODEL)
 *   FISH_AUDIO_TEMPERATURE  sampling temperature, 0-1 (default 0.3)
 *   FISH_AUDIO_BASE_URL  only for local testing
 *
 * Each speaker in a "Name: words" script gets a voice (the mentor can pick),
 * turns are spoken one by one and the MP3 pieces are joined.
 */
export const fishConfigured = () => Boolean(process.env.FISH_AUDIO_API_KEY);

/** Fish retires s1 on 31 Dec 2026 and asks clients to switch to S2.1 Pro (same price). */
const DEFAULT_MODEL = "s2.1-pro";

/** Voices chosen by the owner on fish.audio (2026-11-20). Voice ids are public, not secrets. */
const DEFAULT_VOICES: Voice[] = [
  { id: "933563129e564b19a115bedd57b7406a", label: "Voice 1" },
  { id: "45e74f1d840842afaf3e0f50006fc9e7", label: "Voice 2 (Indian accent)" },
  { id: "1e632bc1503a411387360bfb100ccfc9", label: "Voice 3" },
  { id: "054d313a29aa48bca65275f73647e7c9", label: "Voice 4" },
  { id: "52f28d67f67543f7b8d8c875261d4643", label: "Voice 5" },
  { id: "531f90254e3d4810a047a90b9309fdd0", label: "Voice 6" },
];
const VOICE_ID = /^[0-9a-f]{32}$/;

function configuredVoices(): Voice[] {
  const ids = (process.env.FISH_AUDIO_VOICES ?? "").split(",").map((v) => v.trim()).filter((v) => VOICE_ID.test(v));
  return ids.length ? ids.map((id, i) => DEFAULT_VOICES.find((v) => v.id === id) ?? { id, label: `Voice ${i + 1}` }) : DEFAULT_VOICES;
}

/**
 * The voices mentors can choose from, named after their fish.audio titles
 * when those can be read (cached for a day), otherwise "Voice n".
 */
export async function voiceOptions(): Promise<Voice[]> {
  const voices = configuredVoices();
  if (!fishConfigured()) return voices;
  const base = process.env.FISH_AUDIO_BASE_URL || "https://api.fish.audio";
  return Promise.all(voices.map(async (v) => {
    try {
      const res = await fetch(`${base}/model/${v.id}`, {
        headers: { Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}` },
        signal: AbortSignal.timeout(4000),
        next: { revalidate: 86400 },
      });
      if (!res.ok) return v;
      const title = String(((await res.json()) as { title?: unknown }).title ?? "").trim().slice(0, 60);
      const accent = v.label.match(/\(.*\)$/)?.[0];
      return title ? { id: v.id, label: accent && !title.toLowerCase().includes("indian") ? `${title} ${accent}` : title } : v;
    } catch { return v; }
  }));
}

/**
 * Keeps one listening section (an exam part is 6-8 minutes with its
 * instructions) to a bounded cost. Pauses are silence made here, not speech.
 */
const MAX_SEGMENTS = 140;
const PARALLEL = 4;

export type Speech = { audio: Buffer; bytes: number; model: string; segments: number; seconds: number };

/** Strips a leading ID3v2 tag so joined MP3 pieces play as one stream. */
function stripId3(buf: Buffer): Buffer {
  if (buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return buf;
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  return buf.subarray(10 + size + (buf[5] & 0x10 ? 10 : 0));
}

/** MPEG audio frame header facts needed to cut and pad Fish's MP3s. */
type Frame = { at: number; length: number; samples: number; rate: number; header: Buffer };
const BITRATES: Record<string, number[]> = {
  "1": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Reads the Layer III frame header at `at`, or null if there is none. */
function frameAt(buf: Buffer, at: number): Frame | null {
  if (at + 4 > buf.length || buf[at] !== 0xff || (buf[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (buf[at + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  if (version === 1 || ((buf[at + 1] >> 1) & 3) !== 1) return null; // Layer III only
  const kbps = BITRATES[version === 3 ? "1" : "2"][(buf[at + 2] >> 4) & 15];
  const rate = RATES[version]?.[(buf[at + 2] >> 2) & 3];
  if (!kbps || !rate) return null;
  const padding = (buf[at + 2] >> 1) & 1;
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * kbps * 1000) / rate) + padding;
  return { at, length, samples, rate, header: buf.subarray(at, at + 4) };
}

/** The first audio frame after any ID3 tag. */
function firstFrame(buf: Buffer): Frame | null {
  let at = 0;
  if (buf.length >= 10 && buf.toString("latin1", 0, 3) === "ID3") {
    at = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)) + (buf[5] & 0x10 ? 10 : 0);
  }
  for (let i = at; i < Math.min(buf.length - 4, at + 4096); i++) { const f = frameAt(buf, i); if (f && frameAt(buf, i + f.length)) return f; }
  return null;
}

/**
 * One piece's audio frames: the ID3 tag and any Xing/Info header frame are
 * dropped, so joined pieces play as one stream and players read the true
 * length of the whole recording, not of its first line.
 */
function audioFrames(buf: Buffer): Buffer {
  const f = firstFrame(buf);
  if (!f) return stripId3(buf);
  const head = buf.subarray(f.at, Math.min(buf.length, f.at + f.length)).toString("latin1");
  return buf.subarray(head.includes("Xing") || head.includes("Info") ? f.at + f.length : f.at);
}

/** Playing time of an MP3 made of whole frames (as speakScript builds them). */
function mp3Seconds(buf: Buffer): number {
  let at = firstFrame(buf)?.at ?? -1;
  let seconds = 0;
  while (at >= 0) {
    const f = frameAt(buf, at);
    if (!f) break;
    seconds += f.samples / f.rate;
    at += f.length;
  }
  return Math.round(seconds);
}

/**
 * Seconds of silence in the same MP3 format as `sample`: frames with an
 * all-zero body decode as silence. Built here, so pauses cost no voice credits.
 */
function silence(sample: Buffer, seconds: number): Buffer {
  const f = firstFrame(sample);
  if (!f) return Buffer.alloc(0);
  const header = Buffer.from(f.header);
  header[1] |= 1;     // no CRC
  header[2] &= ~0x02; // no padding, so every frame has the same length
  const length = frameAt(header, 0)!.length;
  const frame = Buffer.alloc(length);
  header.copy(frame, 0);
  const count = Math.ceil((seconds * f.rate) / f.samples);
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

/**
 * Low sampling keeps a voice steady from one line to the next: every turn
 * is a separate request, and at Fish's defaults (0.7) a speaker can sound
 * noticeably different between lines. FISH_AUDIO_TEMPERATURE overrides it.
 */
function sampling() {
  const t = Number(process.env.FISH_AUDIO_TEMPERATURE);
  const temperature = Number.isFinite(t) && t > 0 && t <= 1 ? t : 0.3;
  return { temperature, top_p: 0.5 };
}

async function tts(text: string, voice: string | undefined, model: string): Promise<Buffer> {
  const base = process.env.FISH_AUDIO_BASE_URL || "https://api.fish.audio";
  const plain = { text, format: "mp3", mp3_bitrate: 128, normalize: true, latency: "normal", ...(voice && { reference_id: voice }) };
  let body: Record<string, unknown> = { ...plain, ...sampling() };
  let tuned = true;
  for (let attempt = 0; attempt < 3; attempt++) {
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
    // If this model rejects the sampling fields, speak without them.
    if (tuned && (res.status === 400 || res.status === 422)) { console.warn("Fish Audio rejected sampling settings", detail); body = plain; tuned = false; continue; }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    if (res.status === 401 || res.status === 403) { console.error("Fish Audio auth error", res.status, detail); throw new AiUnavailable("The voice service key was rejected. Check the key in the hosting settings."); }
    if (res.status === 402) throw new AiUnavailable("Voice credits have run out. Top up the Fish Audio account and try again.");
    if (res.status === 429) throw new AiUnavailable("The voice service is busy. Try again in a minute.");
    console.error("Fish Audio error", res.status, detail);
    throw new AiUnavailable(res.status < 500 ? "The voice service could not read this script. Check the text and try again." : "The voice service had a problem. Try again shortly.");
  }
  throw new AiUnavailable("The voice service is busy. Try again in a minute.");
}

/** Turns a listening script into one MP3, each speaker read by their voice. */
export async function speakScript(script: string, chosen: Cast = {}, opts: { model?: string } = {}): Promise<Speech> {
  if (!fishConfigured()) throw new AiUnavailable("Audio is not configured yet. Add a Fish Audio key in the hosting settings.");
  const model = opts.model || process.env.FISH_AUDIO_MODEL || DEFAULT_MODEL;
  const segments = splitScript(script);
  const spoken = segments.filter((s) => !s.pause);
  if (spoken.length === 0) throw new AiUnavailable("Write the script first.");
  if (spoken.length > MAX_SEGMENTS) throw new AiUnavailable("The dialogue has too many turns. Merge some lines and try again.");

  // Only configured voices may be used, whatever the browser sent.
  const cast = defaultCast([...new Set(spoken.map((s) => s.speaker ?? ""))], configuredVoices(), chosen);

  const pieces: Buffer[] = new Array(segments.length);
  const todo = segments.map((s, i) => i).filter((i) => !segments[i].pause);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, async () => {
    while (next < todo.length) {
      const i = todo[next++];
      pieces[i] = await tts(segments[i].text, cast[segments[i].speaker ?? ""] || undefined, model);
    }
  }));

  // Pauses copy the format of the first spoken piece.
  const sample = pieces.find(Boolean)!;
  const audio = Buffer.concat(segments.map((s, i) => (s.pause ? silence(sample, s.pause) : audioFrames(pieces[i]))));
  return {
    audio,
    bytes: Buffer.byteLength(spoken.map((s) => s.text).join(""), "utf8"),
    model: `fish/${model}`,
    segments: spoken.length,
    seconds: mp3Seconds(audio),
  };
}

/** The model LinguABC podcasts are recorded with (the owner chose S2.1 Pro). */
export const podcastModel = () => process.env.FISH_AUDIO_PODCAST_MODEL || process.env.FISH_AUDIO_MODEL || DEFAULT_MODEL;
