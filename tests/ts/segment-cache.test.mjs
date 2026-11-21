// Segment cache logic (src/lib/ai/segment-cache.ts) with an in-memory store
// that follows the same rules as the 0029 RPCs. Run: npm run test:ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, renderSegments, segmentHash, SegmentFailed } from "../../src/lib/ai/segment-cache.ts";

/** Same answers as claim/finish/release_audio_segment (no stale take-over: claims are fresh). */
function memoryStore() {
  const rows = new Map();
  const files = new Map();
  const calls = { claim: 0, upload: 0, finish: 0, release: 0, download: 0 };
  return {
    rows, files, calls,
    async claim(hash) {
      calls.claim++;
      await Promise.resolve();
      const row = rows.get(hash);
      if (!row) { rows.set(hash, { status: "pending" }); return { state: "generate", path: `scope/${hash}.mp3` }; }
      if (row.status === "ready") { row.hits = (row.hits ?? 0) + 1; return { state: "ready", path: row.path }; }
      return { state: "wait" };
    },
    async download(path) { calls.download++; if (!files.has(path)) throw new Error("missing"); return files.get(path); },
    async upload(path, audio) { calls.upload++; files.set(path, audio); },
    async finish(hash) { calls.finish++; Object.assign(rows.get(hash), { status: "ready", path: `scope/${hash}.mp3` }); },
    async release(hash) { calls.release++; if (rows.get(hash)?.status === "pending") rows.delete(hash); },
  };
}

const base = { provider: "fish", model: "s2.1-pro", voice: "v1", expression: [], params: { format: "mp3", temperature: 0.3 }, scope: "centre-a" };
const key = (text, extra = {}) => ({ ...base, text, ...extra });

/** A fake voice API that counts what it is asked to say. */
function fakeVoice({ failOn = new Set() } = {}) {
  const spoken = [];
  const job = (text, extra) => ({
    key: key(text, extra),
    synth: async () => {
      spoken.push(text);
      await new Promise((r) => setTimeout(r, 5));
      if (failOn.has(text)) throw new Error(`voice failed on ${text}`);
      return Buffer.from(`mp3:${text}`);
    },
  });
  return { spoken, job };
}

const fast = { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), pollMs: 5, waitMs: 5_000 };

test("hash is deterministic and covers every field", () => {
  const h = segmentHash(key("Hello."));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(segmentHash(key("Hello.")), h);
  for (const change of [{ provider: "qwen" }, { model: "s1" }, { voice: "v2" }, { expression: ["excited"] }, { text: "Hello!" }, { params: { format: "mp3", temperature: 0.4 } }, { scope: "centre-b" }]) {
    assert.notEqual(segmentHash(key("Hello.", change)), h, JSON.stringify(change));
  }
  // key order never matters
  assert.equal(segmentHash({ ...key("Hello."), params: { temperature: 0.3, format: "mp3" } }), h);
});

test("shared test vector with the Python worker", () => {
  const vector = { provider: "qwen", model: "Qwen3-TTS-12Hz-1.7B-CustomVoice", voice: "Ryan", expression: ["excited"],
    text: "[excited] Welcome to LinguABC — café!", params: { language: "English", seed: 1234, temperature: 0.3, top_p: 0.8 }, scope: "platform" };
  assert.equal(canonicalJson({ b: 1, a: [true, "x"] }), '{"a":[true,"x"],"b":1}');
  assert.equal(segmentHash(vector), SHARED_VECTOR_HASH);
});

test("cache miss: speaks and keeps the segment", async () => {
  const store = memoryStore();
  const v = fakeVoice();
  const { audio, stats } = await renderSegments([v.job("One."), v.job("Two.")], store, fast);
  assert.deepEqual(v.spoken.sort(), ["One.", "Two."]);
  assert.deepEqual(audio.map(String), ["mp3:One.", "mp3:Two."]);
  assert.equal(store.calls.upload, 2);
  assert.equal(store.calls.finish, 2);
  assert.equal(stats.misses, 2);
  assert.equal(stats.hits, 0);
  assert.equal(stats.spokenBytes, 8);
});

test("cache hit: the voice API is not called", async () => {
  const store = memoryStore();
  await renderSegments([fakeVoice().job("One."), fakeVoice().job("Two.")], store, fast);
  const v = fakeVoice();
  const { audio, stats } = await renderSegments([v.job("One."), v.job("Two.")], store, fast);
  assert.deepEqual(v.spoken, []);
  assert.deepEqual(audio.map(String), ["mp3:One.", "mp3:Two."]);
  assert.equal(stats.hits, 2);
  assert.equal(stats.savedBytes, 8);
  assert.equal(stats.spokenBytes, 0);
});

test("one line changed: only that line is spoken again", async () => {
  const store = memoryStore();
  const lines = ["A: Hello there.", "B: Hi, how are you?", "A: Fine, thanks.", "B: Great."];
  await renderSegments(lines.map((l) => fakeVoice().job(l)), store, fast);
  const edited = [...lines];
  edited[2] = "A: Fine, thank you very much.";
  const v = fakeVoice();
  const { stats } = await renderSegments(edited.map((l) => v.job(l)), store, fast);
  assert.deepEqual(v.spoken, ["A: Fine, thank you very much."]);
  assert.equal(stats.hits, 3);
  assert.equal(stats.misses, 1);
});

test("a line repeated in one script is spoken once", async () => {
  const v = fakeVoice();
  const { audio, stats } = await renderSegments([v.job("Now turn to Part Two."), v.job("Middle."), v.job("Now turn to Part Two.")], memoryStore(), fast);
  assert.equal(v.spoken.filter((t) => t === "Now turn to Part Two.").length, 1);
  assert.equal(audio.length, 3);
  assert.equal(String(audio[2]), "mp3:Now turn to Part Two.");
  assert.equal(stats.repeats, 1);
});

test("parallel requests for the same script do not pay twice", async () => {
  const store = memoryStore();
  const v = fakeVoice();
  const lines = ["One.", "Two.", "Three.", "Four.", "Five."];
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => renderSegments(lines.map((l) => v.job(l)), store, fast)));
  assert.equal(v.spoken.length, lines.length, `spoken: ${v.spoken.join(" | ")}`);
  for (const r of [a, b, c]) assert.deepEqual(r.audio.map(String), lines.map((l) => `mp3:${l}`));
  assert.equal(a.stats.misses + b.stats.misses + c.stats.misses, lines.length);
});

test("a failed segment keeps the others; a retry speaks only the failed one", async () => {
  const store = memoryStore();
  const lines = ["One.", "Two.", "Three."];
  const broken = fakeVoice({ failOn: new Set(["Two."]) });
  await assert.rejects(renderSegments(lines.map((l) => broken.job(l)), store, fast), (e) => {
    assert.ok(e instanceof SegmentFailed);
    assert.equal(e.causes.length, 1);
    assert.equal(e.stats.misses, 2);
    return true;
  });
  assert.equal(store.calls.release, 1);
  assert.equal([...store.rows.values()].filter((r) => r.status === "ready").length, 2);
  const v = fakeVoice();
  const { audio } = await renderSegments(lines.map((l) => v.job(l)), store, fast);
  assert.deepEqual(v.spoken, ["Two."]);
  assert.deepEqual(audio.map(String), lines.map((l) => `mp3:${l}`));
});

test("another scope never reuses a segment", async () => {
  const store = memoryStore();
  await renderSegments([fakeVoice().job("Shared words.")], store, fast);
  const v = fakeVoice();
  await renderSegments([v.job("Shared words.", { scope: "centre-b" })], store, fast);
  assert.deepEqual(v.spoken, ["Shared words."]);
});

test("without the cache (migration not applied) it speaks as before", async () => {
  const store = { ...memoryStore(), claim: async () => { throw new Error("Could not find the function public.claim_audio_segment"); } };
  const v = fakeVoice();
  const { audio, stats } = await renderSegments([v.job("One."), v.job("Two.")], store, fast);
  assert.deepEqual(audio.map(String), ["mp3:One.", "mp3:Two."]);
  assert.equal(stats.misses, 2);
  const none = fakeVoice();
  await renderSegments([none.job("One.")], null, fast);
  assert.deepEqual(none.spoken, ["One."]);
});

test("a missing cached file is spoken again instead of failing", async () => {
  const store = memoryStore();
  await renderSegments([fakeVoice().job("One.")], store, fast);
  store.files.clear();
  const v = fakeVoice();
  const { audio } = await renderSegments([v.job("One.")], store, fast);
  assert.deepEqual(v.spoken, ["One."]);
  assert.equal(String(audio[0]), "mp3:One.");
});

// Also asserted in workers/tts/tests/test_hashing.py.
const SHARED_VECTOR_HASH = "8ace185465c90c767134610931259264de8a684f21561624ec98286a1c5866ff";
