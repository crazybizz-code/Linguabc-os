# Parent Telegram bot

Ota-onalar uchun V1 interfeysi. Kod: `src/lib/telegram/` (mantiq, matnlar, jo‘natuvchi), `src/app/api/telegram/webhook` va `/dispatch`, admin UI: `src/app/(staff)/parents/telegram-cell.tsx`. Baza: migratsiyalar 0031, 0032, 0033.

## Ma’lumot oqimi
```
Telegram ──POST (secret header)──▶ /api/telegram/webhook
   1) X-Telegram-Bot-Api-Secret-Token == TELEGRAM_WEBHOOK_SECRET (constant time)
   2) tg_claim_update(update_id) → claimed | done (200) | busy (503, Telegram qayta yuboradi)
   3) handleUpdate: faqat private chat, from.id == chat.id
        tg_children / tg_child_* (service role, har birida tg_can_see_student)
   4) tg_finish_update(update_id, claim, ok) → true bo‘lsagina 200
      xato / yozilmadi / claim boshqaga o‘tgan → 500 → Telegram qayta yuboradi

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

**Bot tayyorligi (Parents sahifasi, serverda tekshiriladi):** havola faqat hammasi joyida bo‘lsa taklif qilinadi — token, username, webhook kaliti (32+ belgi), server kaliti (`SUPABASE_SECRET_KEY`), bazadagi bot funksiyalari (0031/0032) va Telegram `getMe` tokenni tan olib, username mos kelishi. Aks holda sahifada sabab ko‘rsatiladi (masalan “bot token is missing”, “database update is not applied yet”), maxfiy qiymat esa hech qachon brauzerga chiqmaydi. Natija server nusxasida 5 daqiqa (xato bo‘lsa 30 s) keshlanadi.

**Ota-ona qatorlari:** bitta qator = bitta ota-ona hisobi (membership) yoki hali hisobga bog‘lanmagan bitta guardian yozuvi. Ism yoki telefon bir xilligi qatorlarni birlashtirmaydi. Ikkinchi farzand faqat admin “Add another child” orqali yozuvni tanlab, “ota-ona bilan tasdiqladim” belgisini qo‘yganda qo‘shiladi; bir xil telefon faqat ishora sifatida belgilanadi.

`TELEGRAM_API_BASE` — faqat lokal QA uchun (soxta Telegram, `supabase/local/fake-telegram.mjs`); ilova uni faqat `http://127.0.0.1:<port>` yoki `http://localhost:<port>` bo‘lsa qabul qiladi, aks holda har doim `https://api.telegram.org`. Productionda qo‘ymang.

## Production sozlash checklisti
_Holat (2026-11-25): bot BotFather’da yaratilgan, guruhlarga qo‘shish o‘chirilgan (asoschi). **Webhook va rejali xabarlar hali YOQILMAYDI.** Token hech qachon chatga yozilmaydi; faqat Vercel va Supabase Vault’ga._

**A. Kod va baza (har biri alohida tasdiq bilan)**
- [ ] #35 ko‘rib chiqildi va merge qilindi
- [ ] 0031 → 0032 productionga qo‘llandi (`DEPLOY-TELEGRAM-MIGRATIONS.md`), har biridan keyin rollback’li SQL tekshiruv
- [ ] #36 `main` ga qayta yo‘naltirildi, diff va CI qayta tekshirildi, merge qilindi
- [ ] Vercel production deploy muvaffaqiyatli

**B. BotFather (asoschi)**
- [x] Bot yaratildi
- [x] `/setjoingroups` → Disable
- [ ] `/setprivacy` → Enable
- [ ] `/setdescription`, `/setabouttext` (o‘zbekcha: “LinguABC ota-onalar boti. Havola faqat markazdan olinadi.”)
- [ ] `/setcommands`: `start - Boshlash`, `stop - Botni uzish`

**C. Vercel → Settings → Environment Variables (Production, “Sensitive”)**
- [ ] `TELEGRAM_BOT_TOKEN`
- [ ] `TELEGRAM_BOT_USERNAME` (maxfiy emas)
- [ ] `TELEGRAM_WEBHOOK_SECRET` — 32+ belgi (`openssl rand -base64 36 | tr '+/' '-_' | tr -d '='`)
- [ ] `TELEGRAM_DISPATCH_SECRET` — boshqa 32+ belgi
- [ ] Qayta deploy; `/parents` da “Telegram link” tugmasi chiqadi (webhook hali o‘chiq — havola bot ochadi, lekin bot javob bermaydi)

**D. Yoqishdan oldingi tekshiruv (QA markazi `qa-*`, asoschi telefoni)**
- [ ] `getWebhookInfo` → `url` bo‘sh (hali yoqilmagan)
- [ ] Lokal testlar yashil: SQL (to‘liq va `PROD_SHAPE=1`), `test:ts`, `telegram.db.e2e.mjs`, lokal brauzer QA

**E. Webhook’ni yoqish (alohida tasdiq)**
- [ ] `setWebhook` (`secret_token`, `allowed_updates=["message","callback_query","my_chat_member"]`, `drop_pending_updates=true`) — buyruq quyida
- [ ] `getWebhookInfo`: `pending_update_count = 0`, `last_error_message` yo‘q
- [ ] Kalitsiz so‘rov: `curl -X POST https://<domen>/api/telegram/webhook` → 401
- [ ] QA markazida: havola → `/start` → “ulandi”; ikki bola; boshqa telefon bilan o‘sha havola → rad; uzish; bloklash/ochish
- [ ] Davomatda “kelmadi” → ota-ona telefonida xabar (darhol, `after()` orqali)

**F. Rejali jo‘natish (0033, alohida tasdiq)**
- [ ] Supabase’da `pg_net` yoqish (0033 o‘zi yoqadi)
- [ ] Vault: `telegram_dispatch_url` = `https://<domen>/api/telegram/dispatch`, `telegram_dispatch_secret` = Vercel’dagi bilan bir xil
- [ ] 0033 qo‘llash → `cron.job` da `telegram-dispatch`, `telegram-prune`
- [ ] 1 soat kuzatish: `net._http_response` da 200 lar, `telegram_outbox` da `failed` yo‘q

**G. Haqiqiy Telegram API bilan tekshiruv (webhook yoqilgandan keyin, QA markazida, asoschi telefoni)**
Har birida natija va vaqtni yozing; ✅/❌. Tokenni hech qayerga yozmang.
| # | Qadam | Kutilgan natija |
|---|---|---|
| 1 | `getMe` | bot nomi to‘g‘ri, `can_join_groups=false` |
| 2 | `getWebhookInfo` | `url` = `/api/telegram/webhook`, `has_custom_certificate=false`, `pending_update_count=0`, `allowed_updates` = message, callback_query, my_chat_member |
| 3 | Kalitsiz POST `/api/telegram/webhook` | 401 |
| 4 | Parents → “Telegram link” → telefonda ochish → Start | “✅ Hisobingiz ulandi”, farzand menyusi |
| 5 | Xuddi shu havolani boshqa telefonda ochish | “⚠️ Havola yaroqsiz” |
| 6 | 8 ta menyu tugmasi | har biri to‘g‘ri bola ma’lumoti; kechikish < 3 s |
| 7 | Ikkinchi bolani biriktirish → /start | bola tanlash ro‘yxati |
| 8 | Davomatda “kelmadi” | 1 daqiqa ichida xabar; ikkinchi marta kelmaydi |
| 9 | Qisman to‘lov yozish | “To‘lov qabul qilindi” xabari, summa to‘g‘ri |
| 10 | Botni bloklash → davomat “kechikdi” | xabar yo‘q; Parents’da “Telegram: bot blocked” |
| 11 | Botni ochish (yozish) → yangi hodisa | xabar keladi; bloklangan paytdagisi kelmaydi |
| 12 | Botda “Botni uzish” | “🔌 Hisob uzildi”; menyular ishlamaydi |
| 13 | Admin “Disconnect” | botdan ma’lumot olinmaydi |
| 14 | Botni guruhga qo‘shishga urinish | BotFather sozlamasi tufayli mumkin emas |
| 15 | Parents sahifasidagi “Telegram messages, last 7 days” qatori | sent soni oshgan, failed = 0 |
| 16 | Vercel loglari | faqat “telegram webhook: …” kabi qat’iy matn; ism/telefon/token yo‘q |

**Navbat muammosi bo‘lsa:** Parents sahifasidagi qator (0039) faqat sonlarni va xato sinfini (HTTP status: 429, 403, 400, 0 = tarmoq) ko‘rsatadi — xabar matni, ism, chat id ko‘rsatilmaydi. 15 daqiqadan uzoq kutayotgan xabar bo‘lsa qator qizil bo‘ladi.

**Orqaga qaytarish:** `deleteWebhook` (darhol to‘xtaydi) → kerak bo‘lsa `cron.unschedule('telegram-dispatch')` → migratsiya rollback’lari.

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

## Webhook javob kodlari
| Kod | Qachon |
|---|---|
| 200 | update to‘liq ishlandi va bazada `done` deb yozildi (yoki avval yozilgan) |
| 503 | boshqa so‘rov shu update’ni hozir ishlayapti (`busy`) yoki bot sozlanmagan |
| 500 | claim/handler/finalize xatosi yoki claim 90 s dan keyin boshqa so‘rovga o‘tgan |
| 401 / 400 / 413 | kalit noto‘g‘ri / JSON emas / juda katta |

`maxDuration` 30 s < claim muddati 90 s: ishlayotgan so‘rov hech qachon o‘zib ketilmaydi. Finalize yozilmay qolsa, update 90 s dan keyin qayta ishlanadi — bot javobi ikki marta kelishi mumkin (at-least-once), lekin ma’lumot o‘zgarishlari idempotent (`/start` takrori bir xil javob, uzish takrori zararsiz).

Loglarda faqat qat’iy matn (`telegram webhook: handler failed` kabi): so‘rov tanasi, Telegram user, bola, telefon, baza yoki Telegram xato matni, URL (tokenli) yozilmaydi. Test: `tests/ts/telegram-webhook.test.mjs`.

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
