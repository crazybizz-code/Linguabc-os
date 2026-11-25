# Parent Telegram bot

Ota-onalar uchun V1 interfeysi. Kod: `src/lib/telegram/` (mantiq, matnlar, jo‘natuvchi), `src/app/api/telegram/webhook` va `/dispatch`, admin UI: `src/app/(staff)/parents/telegram-cell.tsx`. Baza: migratsiyalar 0031, 0032, 0033.

## Ma’lumot oqimi
```
Telegram ──POST (secret header)──▶ /api/telegram/webhook
   1) X-Telegram-Bot-Api-Secret-Token == TELEGRAM_WEBHOOK_SECRET (constant time)
   2) tg_claim_update(update_id)  → takror bo‘lsa 200
   3) handleUpdate: faqat private chat, from.id == chat.id
        tg_children / tg_child_* (service role, har birida tg_can_see_student)
   4) tg_finish_update(ok)  | xato → release + 500 → Telegram qayta yuboradi

Staff action (davomat, to‘lov, mock release, eslatma)
   └─ DB trigger → notifications → telegram_outbox (faqat commit bo‘lsa)
        ├─ after(): darhol dispatchOutbox (25 tagacha)
        └─ pg_cron har daqiqa → app.tg_dispatch_tick → pg_net → /api/telegram/dispatch (Bearer)
```

## Maxfiy kalitlar (faqat Vercel env, Production)
| O‘zgaruvchi | Qayerdan | Izoh |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather | Hech qachon chatga, Git’ga yoki `NEXT_PUBLIC_` ga emas |
| `TELEGRAM_BOT_USERNAME` | BotFather | maxfiy emas; `t.me/<name>` havolalari uchun |
| `TELEGRAM_WEBHOOK_SECRET` | o‘zingiz yaratasiz: 32+ belgi `[A-Za-z0-9_-]` | `setWebhook` ning `secret_token` i |
| `TELEGRAM_DISPATCH_SECRET` | o‘zingiz yaratasiz: 32+ belgi | Supabase Vault’da `telegram_dispatch_secret` bilan bir xil |

Tasodifiy qiymat: `openssl rand -base64 36 | tr '+/' '-_' | tr -d '='`.

Bot tokeni o‘rnatilmasa: webhook 503, Parents sahifasida “Telegram bot sozlanmagan”, staff actions’dagi jo‘natish hech narsa qilmaydi.

## Yoqish tartibi (har bir qadam asoschi tasdig‘i bilan)
1. PR’lar ko‘rib chiqiladi; 0031 → 0032 qo‘llanadi (`DEPLOY-TELEGRAM-MIGRATIONS.md`).
2. BotFather: `/newbot`; `/setprivacy` → Enable; `/setjoingroups` → **Disable** (botni guruhga qo‘shib bo‘lmasin).
3. Vercel’ga 4 ta o‘zgaruvchi, keyin deploy.
4. **Webhook (faqat testlar o‘tgandan keyin):**
   ```
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url=https://<domen>/api/telegram/webhook \
     -d secret_token=$TELEGRAM_WEBHOOK_SECRET \
     -d 'allowed_updates=["message","callback_query","my_chat_member"]' \
     -d drop_pending_updates=true
   ```
   Tekshirish: `getWebhookInfo` (`pending_update_count`, `last_error_message`). O‘chirish: `deleteWebhook`.
5. 0033 (pg_net + cron) alohida tasdiq bilan; Vault’da `telegram_dispatch_url` va `telegram_dispatch_secret`.
6. QA markazida (`qa-*`): asoschi telefonida bog‘lash, ikki bola, uzish, bloklash/ochish, davomat xabari.

## Xavfsizlik qoidalari
- Bot faqat shaxsiy chatda javob beradi; guruh/kanal update’lari jim tashlanadi.
- Tugmadagi student id hech qachon yetarli emas: har bosishda baza Telegram user → link → parent → guardian → student zanjirini tekshiradi.
- Token: 24 soat, bir martalik, faqat xeshi saqlanadi; yangisi eskisini bekor qiladi.
- Xabar yetkazish: **kamida bir marta** (at-least-once). Telegram xabarni qabul qilib, server javobni yozishdan oldin o‘lsa, xabar ikkinchi marta borishi mumkin. Lease 2 daqiqa, so‘rov timeout 10 s.
- 24 soatdan eski xabarlar yuborilmaydi; bloklangan, uzilgan, suspended yoki bolasi ajratilgan ota-onaga xabar yuborilmaydi (navbatga qo‘yishda va jo‘natishdan oldin tekshiriladi).

## Testlar
- `npm run test:ts` — `tests/ts/telegram.test.mjs` (soxta DB va Telegram).
- `su postgres -c "bash supabase/tests/run.sh"` — SQL §31, §33, §34–37 va `tests/ts/telegram.db.e2e.mjs` (bot kodi + haqiqiy lokal funksiyalar).
- Sinovdan o‘tmagan: Vercel’dagi haqiqiy webhook, haqiqiy Telegram API, pg_net (lokalda stub).
