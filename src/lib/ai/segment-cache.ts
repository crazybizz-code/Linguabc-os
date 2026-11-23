import { createHash } from "node:crypto";

/**
 * Segment cache: every spoken turn of a script is kept, keyed by a hash of
 * everything that changes how it sounds, so the same words in the same voice
 * are paid for once. Pure logic with injected storage and speech, so it can
 * be tested without Supabase or a voice API (tests/ts/segment-cache.test.mjs).
 *
 * The Python worker (workers/tts/linguabc_tts/hashing.py) builds the same
 * hash; a shared test vector keeps the two in step.
 */

export type Scope = string; // a centre id, or "platform" for the LinguABC library

export type SegmentKey = {
  provider: string;
  model: string;
  voice: string;
  /** Expression tags in the text, in order, e.g. ["excited"]. */
  expression: string[];
  /** Exactly what the voice receives (after respelling and tag conversion). */
  text: string;
  /** Every generation setting sent with the text. */
  params: Record<string, string | number | boolean>;
  scope: Scope;
};

export const HASH_VERSION = "linguabc-audio-segment:v1";

/** JSON with keys sorted at every level and no spaces (same as Python's sort_keys, separators). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("segment key numbers must be finite");
  return JSON.stringify(value);
}

export function segmentHash(key: SegmentKey): string {
  const { provider, model, voice, expression, text, params, scope } = key;
  return createHash("sha256").update(`${HASH_VERSION}\n${canonicalJson({ provider, model, voice, expression, text, params, scope })}`, "utf8").digest("hex");
}

/** Expression tags written as "[tag]" in text the voice receives. */
export const expressionsIn = (text: string) => [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toLowerCase());

export type Claim = { state: "ready"; path: string } | { state: "generate"; path: string } | { state: "wait" };

/** Where segments are kept. The Supabase version is in segment-store.ts. */
export interface SegmentStore {
  claim(hash: string, meta: { provider: string; model: string; voice: string; textBytes: number }): Promise<Claim>;
  download(path: string): Promise<Buffer>;
  /** Uploads the file; an existing file at the path (a crashed earlier take) counts as uploaded. */
  upload(path: string, audio: Buffer): Promise<void>;
  finish(hash: string, audioBytes: number): Promise<void>;
  release(hash: string): Promise<void>;
}

export type SegmentJob = { key: SegmentKey; synth: () => Promise<Buffer> };

export type CacheStats = {
  hits: number;
  misses: number;
  /** Segments that appeared twice in one script and were spoken once. */
  repeats: number;
  failed: number;
  /** Text bytes that were not sent to the voice API thanks to the cache. */
  savedBytes: number;
  /** Text bytes that were sent (and billed). */
  spokenBytes: number;
};

export type RenderOptions = {
  parallel?: number;
  /** How long to wait for another request speaking the same segment. */
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class SegmentFailed extends Error {
  readonly causes: unknown[];
  readonly stats: CacheStats;
  constructor(causes: unknown[], stats: CacheStats) {
    super(`${causes.length} segment(s) could not be spoken`);
    this.causes = causes;
    this.stats = stats;
  }
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/**
 * Speaks (or reuses) every job and returns the audio in the same order.
 * Each finished segment is saved before the next result is needed, so a
 * failure later in the script loses nothing already paid for. When any
 * segment fails, the error lists them all and carries the stats.
 */
export async function renderSegments(jobs: SegmentJob[], store: SegmentStore | null, opts: RenderOptions = {}): Promise<{ audio: Buffer[]; stats: CacheStats }> {
  const stats: CacheStats = { hits: 0, misses: 0, repeats: 0, failed: 0, savedBytes: 0, spokenBytes: 0 };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = opts.waitMs ?? 120_000;
  const pollMs = opts.pollMs ?? 2_000;

  // One request per distinct segment, even when a line repeats in the script.
  const hashes = jobs.map((j) => segmentHash(j.key));
  const first = new Map<string, number>();
  hashes.forEach((h, i) => { if (first.has(h)) stats.repeats++; else first.set(h, i); });
  const unique = [...first.entries()];
  let warned = false;

  const one = async (hash: string, job: SegmentJob): Promise<Buffer> => {
    const textBytes = bytes(job.key.text);
    if (!store) {
      const audio = await job.synth();
      stats.misses++; stats.spokenBytes += textBytes;
      return audio;
    }
    const meta = { provider: job.key.provider, model: job.key.model, voice: job.key.voice, textBytes };
    const deadline = Date.now() + waitMs;
    for (;;) {
      let claim: Claim;
      try {
        claim = await store.claim(hash, meta);
      } catch (e) {
        // No cache (e.g. the migration is not applied yet): speak as before.
        if (!warned) { warned = true; console.warn("Audio segment cache unavailable; speaking without it", e instanceof Error ? e.message : e); }
        const audio = await job.synth();
        stats.misses++; stats.spokenBytes += textBytes;
        return audio;
      }
      if (claim.state === "ready") {
        const cached = await store.download(claim.path).catch((e: unknown) => {
          console.warn("Cached audio segment could not be read; speaking it again", e instanceof Error ? e.message : e);
          return null;
        });
        if (cached) { stats.hits++; stats.savedBytes += textBytes; return cached; }
        const audio = await job.synth();
        stats.misses++; stats.spokenBytes += textBytes;
        return audio;
      }
      if (claim.state === "generate") {
        let audio: Buffer;
        try {
          audio = await job.synth();
        } catch (e) {
          await store.release(hash).catch(() => {});
          throw e;
        }
        stats.misses++; stats.spokenBytes += textBytes;
        // Checkpoint: keep it before anything else can fail.
        try {
          await store.upload(claim.path, audio);
          await store.finish(hash, audio.length);
        } catch (e) {
          // The audio is good and paid for; use it for this recording even if it could not be kept.
          console.warn("Audio segment could not be cached", e instanceof Error ? e.message : e);
        }
        return audio;
      }
      if (Date.now() + pollMs > deadline) throw new Error("Another recording of this script is still running. Try again in a minute.");
      await sleep(pollMs);
    }
  };

  const results = new Map<string, Buffer>();
  const causes: unknown[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(opts.parallel ?? 4, unique.length)) }, async () => {
    while (next < unique.length) {
      const [hash, index] = unique[next++];
      try { results.set(hash, await one(hash, jobs[index])); }
      catch (e) { stats.failed++; causes.push(e); }
    }
  });
  await Promise.all(workers);
  if (causes.length) throw new SegmentFailed(causes, stats);
  stats.savedBytes += hashes.reduce((sum, h, i) => (first.get(h) === i ? sum : sum + bytes(jobs[i].key.text)), 0);
  return { audio: hashes.map((h) => results.get(h)!), stats };
}

/** One log line per recording: misses, hits and what the cache saved. */
export function describeStats(stats: CacheStats, pricePerMillionBytes: number): string {
  const saved = (stats.savedBytes / 1e6) * pricePerMillionBytes;
  return `audio cache: ${stats.hits} hit(s), ${stats.misses} miss(es), ${stats.repeats} repeat(s), ${stats.failed} failed; ` +
    `spoken ${stats.spokenBytes} B, saved ${stats.savedBytes} B (~$${saved.toFixed(4)})`;
}
