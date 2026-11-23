import "server-only";
import { fishConfigured, voiceOptions as fishVoices } from "./fish";
import type { Voice } from "./script";
import { ENGINE_LABELS, isWorkerEngine, parseEngines, workerEnvName, type EngineId, type WorkerEngineId } from "./worker-protocol";

/**
 * Voice engines offered in the LinguABC Audio Studio (platform admins only).
 *
 *   AUDIO_ENGINES                 fish,chatterbox-turbo,chatterbox,qwen  (default: fish)
 *   CHATTERBOX_TURBO_WORKER_URL   base URL of a worker running TTS_ENGINE=chatterbox-turbo
 *   CHATTERBOX_TURBO_WORKER_SECRET  its shared secret (32+ characters)
 *   CHATTERBOX_WORKER_URL / _SECRET, QWEN_WORKER_URL / _SECRET   the same for the others
 *
 * An engine is offered only when it is listed AND configured; Fish also
 * needs its key. Centres' homework is not affected: it keeps
 * AUDIO_PROVIDER (voice.ts), Fish by default.
 */
export type StudioEngine = { id: EngineId; label: string; voices: Voice[]; async: boolean };

export function workerConfig(engine: WorkerEngineId): { url: string; secret: string } | null {
  const url = process.env[workerEnvName(engine, "URL")]?.replace(/\/+$/, "");
  const secret = process.env[workerEnvName(engine, "SECRET")] ?? "";
  if (!url || !/^https:\/\//.test(url) || secret.length < 32) return null;
  return { url, secret };
}

export const engineEnabled = (engine: EngineId) =>
  parseEngines(process.env.AUDIO_ENGINES).includes(engine) && (engine === "fish" ? fishConfigured() : workerConfig(engine) !== null);

/** The worker's approved voices (its registry), read from /health and cached for an hour. */
export async function workerVoicesFor(engine: WorkerEngineId): Promise<Voice[]> {
  const cfg = workerConfig(engine);
  if (!cfg) return [];
  try {
    // /health is public on the worker (voice ids and labels only), so the response can be cached.
    const res = await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(5000), next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { voices?: unknown; voice_labels?: Record<string, string> };
    const ids = Array.isArray(body.voices) ? body.voices.filter((v): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z0-9_-]{1,40}$/.test(v)) : [];
    return ids.map((id) => ({ id, label: body.voice_labels?.[id] ?? id }));
  } catch {
    return [];
  }
}

export async function studioEngines(): Promise<StudioEngine[]> {
  const out: StudioEngine[] = [];
  for (const id of parseEngines(process.env.AUDIO_ENGINES)) {
    if (!engineEnabled(id)) continue;
    const voices = id === "fish" ? await fishVoices() : await workerVoicesFor(id as WorkerEngineId);
    if (voices.length) out.push({ id, label: ENGINE_LABELS[id], voices, async: isWorkerEngine(id) });
  }
  return out;
}
