import { processWebhook } from "@/lib/telegram/webhook";
import { telegramConfig } from "@/lib/telegram/server";

// Shorter than the 90-second claim timeout in tg_claim_update (0031), so a
// request that is still running is never overtaken by Telegram's retry.
export const maxDuration = 30;

/** Telegram webhook (parent bot). All decisions are in processWebhook. */
export async function POST(request: Request) {
  const status = await processWebhook(
    {
      secretHeader: request.headers.get("x-telegram-bot-api-secret-token"),
      contentLength: request.headers.get("content-length"),
      body: () => request.text(),
    },
    { webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET },
    telegramConfig(),
  );
  return new Response(null, { status });
}
