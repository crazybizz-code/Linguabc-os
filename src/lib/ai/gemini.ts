import "server-only";

/**
 * Minimal LLM client for structured JSON (REST, no SDK). Server-only: keys
 * never reach the browser.
 *
 * Provider is chosen by which key is configured:
 *   OPENROUTER_API_KEY  → OpenRouter (model OPENROUTER_MODEL, default google/gemini-3.7-flash)
 *   GEMINI_API_KEY      → Google Gemini API (model GEMINI_MODEL, default gemini-3.7-flash)
 * OPENROUTER_BASE_URL / GEMINI_BASE_URL exist only for local testing.
 */
export class AiUnavailable extends Error {}

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
type Opts = { system?: string; temperature?: number };

const provider = () => (process.env.OPENROUTER_API_KEY ? "openrouter" : process.env.GEMINI_API_KEY ? "google" : null);
export const aiConfigured = () => provider() !== null;

/** Standard JSON Schema → Gemini's OpenAPI-style schema (upper-case type names). */
function toGoogleSchema(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties") continue;
    if (k === "type" && typeof v === "string") out.type = v.toUpperCase();
    else if (k === "properties" && v && typeof v === "object")
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGoogleSchema(pv as Record<string, unknown>)]));
    else if (k === "items" && v && typeof v === "object") out.items = toGoogleSchema(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

function parse<T>(text: string | undefined | null): T {
  if (!text) throw new AiUnavailable("The AI returned nothing. Try again or rephrase.");
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(clean) as T; } catch { throw new AiUnavailable("The AI returned an unreadable answer. Try again."); }
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, signal: AbortSignal.timeout(55_000), body: JSON.stringify(body) })
    .catch((e: unknown) => {
      throw new AiUnavailable(e instanceof Error && e.name === "TimeoutError" ? "The AI took too long. Try a shorter document or fewer questions." : "Could not reach the AI service.");
    });
}

async function failure(res: Response): Promise<never> {
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  if (res.status === 402) throw new AiUnavailable("AI credits have run out. Top up the AI account and try again.");
  if (res.status === 429) throw new AiUnavailable("The AI service is busy. Try again in a minute.");
  if (res.status === 401 || res.status === 403) { console.error("AI auth error", res.status, detail); throw new AiUnavailable("The AI key was rejected. Check the key in the hosting settings."); }
  if (res.status >= 400 && res.status < 500) { console.error("AI request error", res.status, detail); throw new AiUnavailable("The AI could not process this request. Check the file and try again."); }
  throw new AiUnavailable("The AI service had a problem. Try again shortly.");
}

async function viaOpenRouter<T>(parts: Part[], schema: Record<string, unknown>, opts: Opts): Promise<T> {
  const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai";
  const content = parts.map((p) => {
    if ("text" in p) return { type: "text", text: p.text };
    const url = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
    return p.inlineData.mimeType === "application/pdf"
      ? { type: "file", file: { filename: "worksheet.pdf", file_data: url } }
      : { type: "image_url", image_url: { url } };
  });
  const body = {
    model: process.env.OPENROUTER_MODEL || "google/gemini-3.7-flash",
    messages: [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content }],
    temperature: opts.temperature ?? 0.4,
    response_format: { type: "json_schema", json_schema: { name: "assignment", strict: false, schema } },
    reasoning: { effort: "low" },
    provider: { require_parameters: true },
  };
  const headers = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "HTTP-Referer": "https://app.linguabc.xyz", "X-Title": "LinguABC" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await post(`${base}/api/v1/chat/completions`, headers, body);
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) { console.error("OpenRouter error", data.error.message); throw new AiUnavailable("The AI service had a problem. Try again shortly."); }
      return parse<T>(data.choices?.[0]?.message?.content);
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    return failure(res);
  }
  throw new AiUnavailable("The AI service is busy. Try again in a minute.");
}

async function viaGoogle<T>(parts: Part[], schema: Record<string, unknown>, opts: Opts): Promise<T> {
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  const model = process.env.GEMINI_MODEL || "gemini-3.7-flash";
  const body = {
    ...(opts.system && { systemInstruction: { parts: [{ text: opts.system }] } }),
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: toGoogleSchema(schema), temperature: opts.temperature ?? 0.4 },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await post(`${base}/v1beta/models/${model}:generateContent`, { "x-goog-api-key": process.env.GEMINI_API_KEY! }, body);
    if (res.ok) {
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return parse<T>(data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(""));
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    return failure(res);
  }
  throw new AiUnavailable("The AI service is busy. Try again in a minute.");
}

/** Ask the configured model for JSON matching `schema` (standard JSON Schema). */
export async function generateJson<T>(parts: Part[], schema: Record<string, unknown>, opts: Opts = {}): Promise<T> {
  const p = provider();
  if (!p) throw new AiUnavailable("AI is not configured yet. Add an AI key in the hosting settings.");
  return p === "openrouter" ? viaOpenRouter<T>(parts, schema, opts) : viaGoogle<T>(parts, schema, opts);
}
