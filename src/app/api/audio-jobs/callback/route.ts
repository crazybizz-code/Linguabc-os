import { createAdminClient } from "@/lib/supabase/admin";
import { workerConfig } from "@/lib/ai/engines";
import { callbackSchema, isWorkerEngine, MAX_CALLBACK_BYTES, sha256, verify } from "@/lib/ai/worker-protocol";

/**
 * Progress and results from a voice worker (migration 0030).
 *
 * Checked in order: the engine named in X-LinguABC-Engine is configured;
 * the body is small; the HMAC signature with that engine's secret is valid
 * and recent (5 minutes); the body has the expected shape. Then the job's
 * own token is checked in the database (audio_job_update, service role
 * only), which also refuses a result whose file is not in Storage and
 * ignores repeats and older attempts. Nothing from the body is logged.
 */
export async function POST(request: Request) {
  const engine = request.headers.get("x-linguabc-engine") ?? "";
  const cfg = isWorkerEngine(engine) ? workerConfig(engine) : null;
  if (!cfg) return Response.json({ error: "unknown engine" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CALLBACK_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_CALLBACK_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  if (!verify(body, request.headers.get("x-linguabc-timestamp"), request.headers.get("x-linguabc-signature"), cfg.secret)) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  let parsed;
  try {
    parsed = callbackSchema.safeParse(JSON.parse(body));
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!parsed.success) return Response.json({ error: "bad report" }, { status: 400 });
  const r = parsed.data;

  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "not configured" }, { status: 503 });
  const { data, error } = await admin.rpc("audio_job_update", {
    p_job: r.job_id, p_token_hash: sha256(r.token), p_attempt: r.attempt, p_status: r.status, p_progress: r.progress,
    p_segments_done: r.segments_done ?? null, p_segments_total: r.segments_total ?? null, p_seconds: r.seconds ?? null,
    p_qa: (r.qa ?? null) as never, p_error: r.error ?? null,
  });
  if (error) {
    // The worker retries on 409 (e.g. the upload is not visible yet); 404 for a wrong job or token.
    if (/not in storage/.test(error.message)) return Response.json({ error: "recording not in storage" }, { status: 409 });
    if (/unknown job or token/.test(error.message)) return Response.json({ error: "unknown job" }, { status: 404 });
    console.error("audio job callback failed", error.code);
    return Response.json({ error: "could not record the report" }, { status: 500 });
  }
  return Response.json(data);
}
