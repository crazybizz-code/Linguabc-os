// The app <-> voice worker contract (src/lib/ai/worker-protocol.ts). Run: npm run test:ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callbackSchema, idempotencyKey, isWorkerEngine, parseEngines, sha256, sign, signedHeaders, verify, workerEnvName,
} from "../../src/lib/ai/worker-protocol.ts";

const SECRET = "s".repeat(40);
const NOW = 1_700_000_000_000;

test("signatures match the Python worker (shared vector)", () => {
  // workers/tts: linguabc_tts.server.sign(b'{"job_id":"x","progress":40}', "s"*40, 1700000000)
  assert.equal(sign('{"job_id":"x","progress":40}', SECRET, 1_700_000_000), PY_VECTOR);
});

test("verify accepts a fresh signature and refuses everything else", () => {
  const body = '{"a":1}';
  const h = signedHeaders(body, SECRET, NOW);
  assert.ok(verify(body, h["X-LinguABC-Timestamp"], h["X-LinguABC-Signature"], SECRET, NOW));
  assert.ok(!verify('{"a":2}', h["X-LinguABC-Timestamp"], h["X-LinguABC-Signature"], SECRET, NOW), "tampered body");
  assert.ok(!verify(body, h["X-LinguABC-Timestamp"], h["X-LinguABC-Signature"], "t".repeat(40), NOW), "wrong secret");
  assert.ok(!verify(body, h["X-LinguABC-Timestamp"], h["X-LinguABC-Signature"], SECRET, NOW + 301_000), "replayed later");
  assert.ok(!verify(body, h["X-LinguABC-Timestamp"], "zz", SECRET, NOW), "malformed signature");
  assert.ok(!verify(body, null, h["X-LinguABC-Signature"], SECRET, NOW), "no timestamp");
  assert.ok(!verify(body, h["X-LinguABC-Timestamp"], sign(body, "short", 1_700_000_000), "short", NOW), "weak secret refused");
});

test("engine flags: Fish by default, unknown names ignored", () => {
  assert.deepEqual(parseEngines(undefined), ["fish"]);
  assert.deepEqual(parseEngines(""), ["fish"]);
  assert.deepEqual(parseEngines("chatterbox, Chatterbox-Turbo ,kokoro,fish"), ["fish", "chatterbox-turbo", "chatterbox"]);
  assert.deepEqual(parseEngines("nonsense"), ["fish"]);
  assert.ok(isWorkerEngine("qwen") && !isWorkerEngine("fish"));
  assert.equal(workerEnvName("chatterbox-turbo", "URL"), "CHATTERBOX_TURBO_WORKER_URL");
  assert.equal(workerEnvName("qwen", "SECRET"), "QWEN_WORKER_SECRET");
});

test("idempotency key: same recording, same key; any change, new key", () => {
  const a = idempotencyKey({ engine: "chatterbox", target: { purpose: "podcast" }, plan: [{ kind: "speech", text: "Hi" }] });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, idempotencyKey({ plan: [{ text: "Hi", kind: "speech" }], target: { purpose: "podcast" }, engine: "chatterbox" }));
  assert.notEqual(a, idempotencyKey({ engine: "chatterbox-turbo", target: { purpose: "podcast" }, plan: [{ kind: "speech", text: "Hi" }] }));
  assert.notEqual(a, idempotencyKey({ engine: "chatterbox", target: { purpose: "podcast" }, plan: [{ kind: "speech", text: "Hi!" }] }));
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("callback reports are validated strictly", () => {
  const ok = { job_id: "0b5b3c1e-2f1a-4c55-9d3e-1f2a3b4c5d6e", attempt: 1, token: "f".repeat(64), status: "completed", progress: 100,
    segments_done: 10, segments_total: 10, seconds: 412.5, qa: { status: "pass", wer: 0.004 } };
  assert.ok(callbackSchema.safeParse(ok).success);
  for (const bad of [
    { ...ok, token: "short" }, { ...ok, status: "queued" }, { ...ok, progress: 101 }, { ...ok, attempt: 0 },
    { ...ok, job_id: "not-a-uuid" }, { ...ok, error: "x".repeat(501) },
  ]) assert.ok(!callbackSchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80));
});

const PY_VECTOR = "76e14faa96c9a3d6c3cc067b1ee5e29e6af989fd18976836debc0d5c24777542";

test("answer key for the worker's check: validated, empty answers dropped, fingerprint only for the key", async () => {
  const { cleanAnswers, answersHash, MAX_ANSWER_CHECKS } = await import("../../src/lib/ai/worker-protocol.ts");
  assert.deepEqual(cleanAnswers(undefined), []);
  assert.deepEqual(cleanAnswers([{ id: "12", accepted: [" 185 ", "£185", "185"] }, { id: "13", accepted: ["", " "] }]),
    [{ id: "12", accepted: ["185", "£185"] }]);
  for (const bad of [
    "185", [{ id: "1 2", accepted: ["x"] }], [{ id: "1", accepted: "x" }], [{ id: "1", accepted: [5] }], [{ id: "1", accepted: ["x".repeat(101)] }],
    [{ id: "1", accepted: ["a"] }, { id: "1", accepted: ["b"] }], Array.from({ length: MAX_ANSWER_CHECKS + 1 }, (_, i) => ({ id: `q${i}`, accepted: ["a"] })),
  ]) assert.equal(cleanAnswers(bad), null, JSON.stringify(bad).slice(0, 60));
  const h = answersHash([{ id: "12", accepted: ["Thursday"] }]);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes("Thursday"));
  assert.notEqual(h, answersHash([{ id: "12", accepted: ["Tuesday"] }]), "a changed key is a new recording");
});
