import "server-only";

/**
 * Minimal Gemini client (REST, no SDK). Server-only: GEMINI_API_KEY must
 * never reach the browser. The model is configurable so it can be moved
 * forward without a code change.
 */
const MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const ENDPOINT = (m: string) => `${BASE}/v1beta/models/${m}:generateContent`;

export const aiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

export class AiUnavailable extends Error {}

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export async function generateJson<T>(parts: Part[], schema: object, opts: { system?: string; temperature?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiUnavailable("AI is not configured yet. Add GEMINI_API_KEY in the hosting settings.");

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(ENDPOINT(MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({
        ...(opts.system && { systemInstruction: { parts: [{ text: opts.system }] } }),
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: opts.temperature ?? 0.4 },
      }),
    }).catch((e: unknown) => {
      throw new AiUnavailable(e instanceof Error && e.name === "TimeoutError" ? "The AI took too long. Try a shorter document or fewer questions." : "Could not reach the AI service.");
    });
    if (res.ok) {
      const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
      if (!text) throw new AiUnavailable("The AI returned nothing. Try again or rephrase.");
      try { return JSON.parse(text) as T; } catch { throw new AiUnavailable("The AI returned an unreadable answer. Try again."); }
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    if (res.status === 429) throw new AiUnavailable("The AI service is busy. Try again in a minute.");
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      console.error("Gemini error", res.status, (await res.text()).slice(0, 300));
      throw new AiUnavailable("The AI could not process this request. Check the file and try again.");
    }
    throw new AiUnavailable("The AI service had a problem. Try again shortly.");
  }
  throw new AiUnavailable("The AI service is busy. Try again in a minute.");
}
