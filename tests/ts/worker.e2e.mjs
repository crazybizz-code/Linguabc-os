// End to end over real HTTP: this script plays the app (signed job, webhook, Storage upload)
// against the Python worker with its fake engine. Run: see workers/tts/tests/e2e_server.py
import http from "node:http";
import assert from "node:assert/strict";
import { callbackSchema, newToken, signedHeaders, verify } from "../../src/lib/ai/worker-protocol.ts";

const SECRET = process.env.LINGUABC_TTS_SECRET;
const WORKER = process.env.WORKER_URL ?? "http://127.0.0.1:8765";
const reports = [];
let upload = null;
const server = http.createServer((req, res) => {
  let chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (req.method === "PUT" && req.url.startsWith("/upload")) { upload = { bytes: body.length, type: req.headers["content-type"], first: body[0] }; res.end("{}"); return; }
    const ok = verify(body.toString("utf8"), req.headers["x-linguabc-timestamp"], req.headers["x-linguabc-signature"], SECRET);
    const parsed = callbackSchema.safeParse(JSON.parse(body.toString("utf8")));
    reports.push({ ok, engine: req.headers["x-linguabc-engine"], valid: parsed.success, data: parsed.data });
    res.writeHead(ok && parsed.success ? 200 : 401).end("{}");
  });
}).listen(8766);

const token = newToken();
const job = { version: 1, job_id: crypto.randomUUID(), attempt: 1, engine: "chatterbox-turbo", scope: "platform", language: "English",
  plan: [{ kind: "speech", speaker: "A", voice: "Ryan", text: "The coach leaves at 7:45 from platform 9." }, { kind: "pause", seconds: 0.4 },
         { kind: "speech", speaker: "B", voice: "Aiden", text: "Thank you, that is very helpful." }],
  checks: { answers: [{ id: "3", accepted: ["7:45"] }, { id: "4", accepted: ["platform 9", "9"] }] }, upload: { url: "http://127.0.0.1:8766/upload/x.mp3", content_type: "audio/mpeg" },
  callback: { url: "http://127.0.0.1:8766/callback", token } };
const body = JSON.stringify(job);
const res = await fetch(`${WORKER}/jobs`, { method: "POST", headers: signedHeaders(body, SECRET), body });
assert.equal(res.status, 202);
const forged = await fetch(`${WORKER}/jobs`, { method: "POST", headers: signedHeaders(body, "x".repeat(40)), body });
assert.equal(forged.status, 401);
for (let i = 0; i < 100 && !reports.some((r) => r.data?.status === "completed" || r.data?.status === "failed"); i++) await new Promise((r) => setTimeout(r, 100));
server.close();
const last = reports.at(-1);
assert.ok(reports.length >= 2 && reports.every((r) => r.ok && r.valid && r.engine === "chatterbox-turbo"), "every report signed and well formed");
assert.equal(last.data.status, "completed");
assert.equal(last.data.token, token);
assert.equal(last.data.qa.answers_checked, 2);
assert.deepEqual(last.data.qa.answers_missing, []);
assert.ok(!JSON.stringify(reports.map((r) => r.data)).includes("7:45"), "answers never come back");
assert.ok(upload && upload.bytes > 1000 && upload.type === "audio/mpeg" && upload.first === 0xff, "MP3 uploaded before the result");
console.log(JSON.stringify({ reports: reports.map((r) => [r.data.status, r.data.progress]), upload_bytes: upload.bytes, result_seconds: last.data.seconds }));
