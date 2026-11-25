// Minimal Telegram Bot API client. Pure (no "@/" imports) so tests can load it.
// The token is passed in by the server code; it never reaches the browser.

export type TgResult = {
  ok: boolean;
  status: number;            // HTTP status, 0 for a network error or timeout
  description?: string;
  retryAfter?: number;       // seconds (429)
  blocked?: boolean;         // 403: the user blocked the bot or never started it
  result?: unknown;
};

export type TgSend = (method: string, body: Record<string, unknown>) => Promise<TgResult>;

/** A sender bound to one bot token. 10-second timeout per call. */
export function telegramSender(token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): TgSend {
  return async (method, body) => {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown; parameters?: { retry_after?: number } };
      return {
        ok: res.ok && json.ok === true,
        status: res.status,
        description: json.description,
        retryAfter: json.parameters?.retry_after,
        blocked: res.status === 403,
        result: json.result,
      };
    } catch (e) {
      // Never include the URL: it carries the token.
      return { ok: false, status: 0, description: e instanceof Error ? e.name : "network error" };
    }
  };
}

/** Constant-time comparison of two secrets (no early exit on the first difference). */
export function sameSecret(given: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 16 || typeof given !== "string") return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
