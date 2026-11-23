import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The contract between the app and the LinguABC voice workers
 * (workers/tts: linguabc_tts/jobs.py, http_app.py). Pure: no Next.js or
 * Supabase imports, so it is unit-tested directly (tests/ts/worker-protocol.test.mjs).
 *
 * Every message either way is signed:
 *   X-LinguABC-Timestamp: unix seconds
 *   X-LinguABC-Signature: hex HMAC-SHA256(secret, `${timestamp}.${body}`)
 * and refused if the clock is more than 5 minutes off. Each job also has
 * its own random callback token; only its SHA-256 is stored (0030), so a
 * leaked worker secret alone cannot change another job.
 */

/** Voice engines. Fish records directly (fish.ts); the others run as jobs on a worker. */
export const ENGINES = ["fish", "chatterbox-turbo", "chatterbox", "qwen"] as const;
export type EngineId = (typeof ENGINES)[number];
export const WORKER_ENGINES = ["chatterbox-turbo", "chatterbox", "qwen"] as const;
export type WorkerEngineId = (typeof WORKER_ENGINES)[number];
export const isWorkerEngine = (e: string): e is WorkerEngineId => (WORKER_ENGINES as readonly string[]).includes(e);

export const ENGINE_LABELS: Record<EngineId, string> = {
  fish: "Fish Audio",
  "chatterbox-turbo": "Chatterbox Turbo (fast)",
  chatterbox: "Chatterbox 0.5B (expressive)",
  qwen: "Qwen3-TTS",
};

/**
 * AUDIO_ENGINES: the engines offered in the LinguABC Audio Studio, comma
 * separated, e.g. "fish,chatterbox-turbo,chatterbox". Unknown names are
 * ignored; Fish is always first when listed; unset means Fish only.
 */
export function parseEngines(raw: string | undefined): EngineId[] {
  const asked = (raw ?? "fish").split(",").map((s) => s.trim().toLowerCase());
  const known = ENGINES.filter((e) => asked.includes(e));
  return known.length ? known : ["fish"];
}

/** Per-engine worker settings in the environment, e.g. CHATTERBOX_TURBO_WORKER_URL / _SECRET. */
export const workerEnvName = (engine: WorkerEngineId, what: "URL" | "SECRET") =>
  `${engine.replace(/-/g, "_").toUpperCase()}_WORKER_${what}`;

export const MAX_SKEW_S = 300;

export function sign(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function signedHeaders(body: string, secret: string, now = Date.now()): Record<string, string> {
  const ts = Math.floor(now / 1000);
  return { "Content-Type": "application/json", "X-LinguABC-Timestamp": String(ts), "X-LinguABC-Signature": sign(body, secret, ts) };
}

export function verify(body: string, timestamp: string | null, signature: string | null, secret: string, now = Date.now()): boolean {
  if (!secret || secret.length < 32 || !timestamp || !signature || !/^\d{9,12}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_S) return false;
  const expected = Buffer.from(sign(body, secret, Number(timestamp)), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export const newToken = () => randomBytes(32).toString("hex");
export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** JSON with keys sorted at every level (same idea as segment-cache.ts). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The same recording asked for twice gives the same key, so it is one job. */
export const idempotencyKey = (parts: Record<string, unknown>) => sha256(`linguabc-audio-job:v1\n${canonical(parts)}`);

export const MAX_CALLBACK_BYTES = 64 * 1024;

/** What a worker may report about a job. */
export const callbackSchema = z.object({
  job_id: z.string().uuid(),
  attempt: z.number().int().min(1).max(10),
  token: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["processing", "completed", "needs_review", "failed"]),
  progress: z.number().int().min(0).max(100),
  segments_done: z.number().int().min(0).max(10_000).nullish(),
  segments_total: z.number().int().min(0).max(10_000).nullish(),
  seconds: z.number().min(0).max(36_000).nullish(),
  qa: z.record(z.string(), z.unknown()).nullish(),
  error: z.string().max(500).nullish(),
});
export type Callback = z.infer<typeof callbackSchema>;

/** One question's accepted answers (gap questions), checked against the recording. */
export type AnswerCheck = { id: string; accepted: string[] };

export const MAX_ANSWER_CHECKS = 60;
const ANSWER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Validates answers from the editor; null if anything is malformed. Empty answers are dropped. */
export function cleanAnswers(raw: unknown): AnswerCheck[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ANSWER_CHECKS) return null;
  const out: AnswerCheck[] = [];
  const ids = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a !== "object") return null;
    const { id, accepted } = a as { id?: unknown; accepted?: unknown };
    if (typeof id !== "string" || !ANSWER_ID.test(id) || ids.has(id) || !Array.isArray(accepted)) return null;
    if (accepted.length > 10 || accepted.some((v) => typeof v !== "string" || v.length > 100)) return null;
    const forms = [...new Set((accepted as string[]).map((v) => v.trim()).filter(Boolean))];
    if (!forms.length) continue;
    ids.add(id);
    out.push({ id, accepted: forms.slice(0, 5) });
  }
  return out;
}

/** A fingerprint of the answers for the idempotency key (the answers themselves are not stored). */
export const answersHash = (answers: AnswerCheck[]) => sha256(JSON.stringify(answers.map((a) => [a.id, a.accepted])));

export type JobRequest = {
  version: 1;
  job_id: string;
  attempt: number;
  engine: WorkerEngineId;
  scope: string;
  language: "English";
  plan: unknown[];
  /** The answer key, for the worker's ASR check only: it reports ids it did not hear, never the answers. */
  checks: { answers: AnswerCheck[] };
  upload: { url: string; content_type: "audio/mpeg" };
  callback: { url: string; token: string };
};
