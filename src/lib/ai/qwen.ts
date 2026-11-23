import "server-only";
import { createHmac } from "node:crypto";
import { AiUnavailable } from "./gemini";
import { planScript, type Cast, type Voice } from "./script";
import type { Speech } from "./fish";

/**
 * Qwen3-TTS pilot: the LinguABC TTS worker (workers/tts, Python, Modal GPU)
 * speaks a whole script and returns one MP3. Off unless AUDIO_PROVIDER=qwen.
 *
 *   QWEN_TTS_URL      the worker's /render endpoint
 *   QWEN_TTS_SECRET   shared secret; requests are signed with HMAC-SHA256
 *   QWEN_TTS_VOICES   comma-separated Qwen speaker names (default below)
 *
 * The script is planned here, with the same rules as Fish (splitScript,
 * pauses, turn gaps), so both providers read a script the same way. The
 * worker keeps its own segment cache and checks each segment with ASR.
 */
export const qwenConfigured = () => Boolean(process.env.QWEN_TTS_URL && process.env.QWEN_TTS_SECRET);

/** Qwen3-TTS-12Hz-1.7B-CustomVoice speakers (github.com/QwenLM/Qwen3-TTS). Only Ryan and Aiden are native English. */
const QWEN_VOICES: Voice[] = [
  { id: "Ryan", label: "Ryan (male, English)" },
  { id: "Aiden", label: "Aiden (male, American English)" },
  { id: "Serena", label: "Serena (female, non-native English)" },
  { id: "Vivian", label: "Vivian (female, non-native English)" },
];
const SPEAKER = /^[A-Za-z_]{2,30}$/;

export function qwenVoices(): Voice[] {
  const names = (process.env.QWEN_TTS_VOICES ?? "").split(",").map((v) => v.trim()).filter((v) => SPEAKER.test(v));
  return names.length ? names.map((id) => QWEN_VOICES.find((v) => v.id === id) ?? { id, label: id }) : QWEN_VOICES;
}

export const signBody = (body: string, secret: string, timestamp: number) =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");

type WorkerReply = {
  audio_mp3_base64?: string;
  seconds?: number;
  model?: string;
  billed_text_bytes?: number;
  report?: { status?: string; failed_segments?: number; unsupported_expressions?: string[] };
  error?: string;
};

export async function speakWithQwen(script: string, chosen: Cast, scope: string): Promise<Speech> {
  if (!qwenConfigured()) throw new AiUnavailable("The Qwen voice worker is not configured.");
  const plan = planScript(script, chosen, qwenVoices());
  const speech = plan.filter((p) => p.kind === "speech");
  if (speech.length === 0) throw new AiUnavailable("Write the script first.");
  const body = JSON.stringify({ version: 1, scope, language: "English", plan });
  const timestamp = Math.floor(Date.now() / 1000);
  const res = await fetch(process.env.QWEN_TTS_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-LinguABC-Timestamp": String(timestamp), "X-LinguABC-Signature": signBody(body, process.env.QWEN_TTS_SECRET!, timestamp) },
    body,
    signal: AbortSignal.timeout(280_000),
  }).catch((e: unknown) => {
    throw new AiUnavailable(e instanceof Error && e.name === "TimeoutError" ? "The voice worker took too long. Try a shorter script." : "Could not reach the voice worker.");
  });
  const reply = (await res.json().catch(() => ({}))) as WorkerReply;
  if (!res.ok || !reply.audio_mp3_base64) {
    console.error("Qwen worker error", res.status, String(reply.error ?? "").slice(0, 300));
    throw new AiUnavailable(res.status === 422 ? "Some lines could not be spoken clearly. Check the script and try again." : "The voice worker had a problem. Try again shortly.");
  }
  if (reply.report?.unsupported_expressions?.length) console.info("Qwen worker ignored expressions", reply.report.unsupported_expressions.join(", "));
  const audio = Buffer.from(reply.audio_mp3_base64, "base64");
  return {
    audio,
    bytes: Math.max(0, Number(reply.billed_text_bytes) || 0),
    model: `qwen/${reply.model ?? "unknown"}`,
    segments: speech.length,
    seconds: Math.round(Number(reply.seconds) || 0),
  };
}
